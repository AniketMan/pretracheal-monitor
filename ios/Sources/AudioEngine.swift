import AVFoundation
import Observation
import SwiftUI

/// Native port of the web app's `useAudioEngine` hook.
///
/// Pipeline: AVAudioSession input -> AVAudioEngine input node tap -> rolling
/// waveform buffer (+ optional recording buffer). The tap runs on the audio
/// thread; the UI reads snapshots on a display-rate timer.
///
/// Constants mirror the original Python script and the web build so the
/// clinical behaviour is unchanged.
@MainActor
@Observable
final class AudioEngine {
    // MARK: Configuration (mirrors client/src/hooks/useAudioEngine.ts)
    static let windowDuration: Double = 3.0    // seconds of visible waveform
    static let defaultGain: Float = 50         // display amplification (web build's fixed value)
    static let gainRange: ClosedRange<Float> = 10...150
    static let threshold: Float = 1            // amplitude below which audio is "silent"
    static let maxSilenceDuration: Double = 30 // seconds before the alarm fires

    // MARK: Published state

    /// Mic sensitivity — scales the displayed waveform and, with it, the
    /// silence threshold, so raising it makes the alarm harder to trigger.
    /// Persisted so a clinician's setting survives relaunch.
    var gain: Float = AudioEngine.storedGain() {
        didSet {
            gain = min(max(gain, Self.gainRange.lowerBound), Self.gainRange.upperBound)
            UserDefaults.standard.set(gain, forKey: Self.gainDefaultsKey)
        }
    }

    private static let gainDefaultsKey = "monitor.gain"

    private static func storedGain() -> Float {
        guard UserDefaults.standard.object(forKey: gainDefaultsKey) != nil else { return defaultGain }
        let stored = UserDefaults.standard.float(forKey: gainDefaultsKey)
        return min(max(stored, gainRange.lowerBound), gainRange.upperBound)
    }

    private(set) var isRunning = false
    private(set) var isRecording = false
    private(set) var isAlarm = false
    private(set) var silenceDuration: Double = 0
    private(set) var currentAmplitude: Float = 0
    private(set) var peakAmplitude: Float = 0
    private(set) var elapsedTime: Double = 0
    private(set) var hasRecordedData = false
    private(set) var waveform: [Float] = []
    private(set) var inputs: [AVAudioSessionPortDescription] = []
    private(set) var selectedInputUID: String?
    private(set) var errorMessage: String?

    // MARK: Private
    private let engine = AVAudioEngine()
    private var waveformBuffer = WaveformBuffer(capacity: 1)
    private let recordingBuffer = RecordingBuffer()
    private let isRecordingFlag = AtomicFlag()
    private var displayTimer: Timer?
    private var startTime = CFAbsoluteTimeGetCurrent()
    private var sampleRate: Double = 44_100

    init() {
        refreshInputs()
    }

    // MARK: - Devices

    func refreshInputs() {
        let session = AVAudioSession.sharedInstance()
        inputs = session.availableInputs ?? []
        if selectedInputUID == nil {
            selectedInputUID = session.currentRoute.inputs.first?.uid ?? inputs.first?.uid
        }
    }

    func selectInput(_ port: AVAudioSessionPortDescription) {
        selectedInputUID = port.uid
        do {
            try AVAudioSession.sharedInstance().setPreferredInput(port)
        } catch {
            errorMessage = "Could not switch to \(port.portName)."
        }
    }

    // MARK: - Transport

    func start() {
        guard !isRunning else { return }
        errorMessage = nil

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else {
                    self.errorMessage = "Microphone access is required. Enable it in Settings › Privacy › Microphone."
                    return
                }
                self.beginCapture()
            }
        }
    }

    private func beginCapture() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord,
                                    mode: .measurement,
                                    options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setPreferredSampleRate(44_100)
            try session.setActive(true)

            if let uid = selectedInputUID,
               let port = (session.availableInputs ?? []).first(where: { $0.uid == uid }) {
                try? session.setPreferredInput(port)
            }
            refreshInputs()

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            sampleRate = format.sampleRate > 0 ? format.sampleRate : 44_100

            let capacity = Int(sampleRate * Self.windowDuration)
            let buffer = WaveformBuffer(capacity: capacity)
            waveformBuffer = buffer
            let recording = recordingBuffer
            let recordingFlag = isRecordingFlag

            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { pcm, _ in
                guard let channel = pcm.floatChannelData?[0] else { return }
                let frames = Int(pcm.frameLength)
                channel.withMemoryRebound(to: Float.self, capacity: frames) { pointer in
                    let samples = UnsafeBufferPointer(start: pointer, count: frames)
                    buffer.append(samples)
                    if recordingFlag.value {
                        recording.append(samples)
                    }
                }
            }

            engine.prepare()
            try engine.start()

            startTime = CFAbsoluteTimeGetCurrent()
            silenceDuration = 0
            elapsedTime = 0
            isAlarm = false
            isRunning = true
            startDisplayTimer()
        } catch {
            errorMessage = "Could not start audio: \(error.localizedDescription)"
            stop()
        }
    }

    func stop() {
        displayTimer?.invalidate()
        displayTimer = nil

        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        isRecordingFlag.value = false
        hasRecordedData = hasRecordedData || !recordingBuffer.isEmpty
        isRunning = false
        isRecording = false
        isAlarm = false
        currentAmplitude = 0
        peakAmplitude = 0
    }

    func toggleRecording() {
        if isRecording {
            isRecordingFlag.value = false
            isRecording = false
            hasRecordedData = !recordingBuffer.isEmpty
        } else {
            recordingBuffer.clear()
            hasRecordedData = false
            isRecordingFlag.value = true
            isRecording = true
        }
    }

    func clearError() {
        errorMessage = nil
    }

    func dismissAlarm() {
        isAlarm = false
        silenceDuration = 0
    }

    /// Encodes everything captured since the last recording start.
    func exportWAV() -> URL? {
        let samples = recordingBuffer.drainCopy()
        guard !samples.isEmpty else { return nil }
        do {
            return try WAVEncoder.writeTemporaryFile(samples: samples, sampleRate: sampleRate)
        } catch {
            errorMessage = "Export failed: \(error.localizedDescription)"
            return nil
        }
    }

    // MARK: - Display loop

    private func startDisplayTimer() {
        displayTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(interval: 1.0 / 30.0) }
        }
        RunLoop.main.add(timer, forMode: .common)
        displayTimer = timer
    }

    private func tick(interval: Double) {
        guard isRunning else { return }

        let recent = waveformBuffer.recent(1024)
        var sumSquares: Float = 0
        var peak: Float = 0
        for sample in recent {
            sumSquares += sample * sample
            peak = max(peak, abs(sample))
        }
        let rms = (recent.isEmpty ? 0 : (sumSquares / Float(recent.count)).squareRoot()) * gain

        currentAmplitude = rms
        peakAmplitude = peak * gain
        elapsedTime = CFAbsoluteTimeGetCurrent() - startTime
        waveform = waveformBuffer.snapshot()

        if rms < Self.threshold {
            silenceDuration += interval
            if silenceDuration > Self.maxSilenceDuration && !isAlarm {
                isAlarm = true
            }
        } else {
            silenceDuration = 0
            if isAlarm { isAlarm = false }
        }
    }
}

/// Tiny lock-guarded flag shared between the main actor and the audio thread.
final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = false

    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return storage }
        set { lock.lock(); storage = newValue; lock.unlock() }
    }
}
