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
    static let threshold: Float = 1            // amplitude below which audio is "silent"
    static let maxSilenceDuration: Double = 30 // seconds before the alarm fires

    /// The sensitivity slider steps through this ladder, spaced roughly
    /// logarithmically so the 10x-100x region keeps most of the travel. A
    /// ladder rather than a continuous curve because rounding a continuous
    /// mapping back to readable values makes the thumb snap backwards mid-drag.
    static let gainSteps: [Float] = [
        10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 140,
        160, 180, 200, 250, 300, 350, 400, 450, 500,
    ]

    static var gainRange: ClosedRange<Float> { gainSteps.first!...gainSteps.last! }

    static func gain(forStep index: Int) -> Float {
        gainSteps[min(max(index, 0), gainSteps.count - 1)]
    }

    static func step(forGain gain: Float) -> Int {
        var best = 0
        for i in 1..<gainSteps.count where abs(gainSteps[i] - gain) < abs(gainSteps[best] - gain) {
            best = i
        }
        return best
    }

    /// Calibration phase durations, in seconds.
    static let calibrationAmbientSeconds: Double = 3
    static let calibrationBreathSeconds: Double = 6

    // MARK: Published state

    /// Mic sensitivity, 10x-500x. Scales the displayed waveform only: silence
    /// detection runs at `defaultGain` (see `tick`), so moving this cannot
    /// change when the no-airflow alarm fires.
    /// Persisted so a clinician's setting survives relaunch.
    var gain: Float = AudioEngine.storedGain() {
        didSet {
            gain = min(max(gain, Self.gainRange.lowerBound), Self.gainRange.upperBound)
            UserDefaults.standard.set(gain, forKey: Self.gainDefaultsKey)
        }
    }

    // MARK: Breath calibration

    enum CalibrationPhase: Equatable {
        case idle, ambient, breathing, analyzing
    }

    private(set) var band: BreathBand? = AudioEngine.storedBand()
    private(set) var calibrationPhase: CalibrationPhase = .idle
    private(set) var calibrationProgress: Double = 0
    private(set) var calibrationError: String?
    private(set) var gateVerdict: GateVerdict = .noProfile

    /// Whether the learned band is actually applied to the signal.
    var filterEnabled: Bool = UserDefaults.standard.bool(forKey: "monitor.breathFilterEnabled") {
        didSet {
            UserDefaults.standard.set(filterEnabled, forKey: "monitor.breathFilterEnabled")
            applyBandToFilter()
        }
    }

    private static let gainDefaultsKey = "monitor.gain"
    private static let bandDefaultsKey = "monitor.breathBand"

    private static func storedBand() -> BreathBand? {
        guard let data = UserDefaults.standard.data(forKey: bandDefaultsKey) else { return nil }
        return try? JSONDecoder().decode(BreathBand.self, from: data)
    }

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
    private let eq = AVAudioUnitEQ(numberOfBands: 1)
    private let calibrationAnalyzer = SpectrumAnalyzer()
    private let calibrationActive = AtomicFlag()
    /// Runs continuously on the raw signal: the shape of what is *out* of band
    /// is exactly what separates speech from breath, and the filter removes it.
    private let gateAnalyzer = SpectrumAnalyzer()
    private let gateActive = AtomicFlag()
    private var calibrationTask: Task<BreathBand?, Never>?
    /// Set by `cancelCalibration()`/`stop()`. Task cancellation alone is not
    /// enough: the loop also has to refuse to apply a partially sampled band.
    private var calibrationCancelled = false
    private var displayTimer: Timer?
    private var startTime = CFAbsoluteTimeGetCurrent()
    /// When the current run of silence began, or nil while sound is present.
    private var silenceStartedAt: CFAbsoluteTime?
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

            // AVAudioEngine raises an Objective-C exception for an invalid
            // format, which Swift cannot catch — so this has to be checked
            // rather than left to the do/catch below. The input node reports a
            // 0 Hz format when another app holds the microphone, during a call,
            // or before the session is really active.
            guard format.sampleRate > 0, format.channelCount > 0 else {
                errorMessage = "The microphone is unavailable right now. It may be in use by a call or another app."
                stop()
                return
            }
            sampleRate = format.sampleRate

            let capacity = Int(sampleRate * Self.windowDuration)
            let buffer = WaveformBuffer(capacity: capacity)
            waveformBuffer = buffer
            let recording = recordingBuffer
            let recordingFlag = isRecordingFlag

            // Bandpass sits between the mic and everything the UI reads, so
            // when a calibration profile is active the trace and the silence
            // detector both see breath-band audio only.
            if eq.engine == nil { engine.attach(eq) }
            engine.connect(input, to: eq, format: format)
            engine.connect(eq, to: engine.mainMixerNode, format: format)
            engine.mainMixerNode.outputVolume = 0  // monitor silently, no feedback
            applyBandToFilter()

            let analyzer = calibrationAnalyzer
            let calibrating = calibrationActive
            let gate = gateAnalyzer
            let gating = gateActive

            // Display + detection tap: downstream of the filter.
            eq.removeTap(onBus: 0)
            eq.installTap(onBus: 0, bufferSize: 1024, format: format) { pcm, _ in
                guard let channel = pcm.floatChannelData?[0] else { return }
                let frames = Int(pcm.frameLength)
                channel.withMemoryRebound(to: Float.self, capacity: frames) { pointer in
                    buffer.append(UnsafeBufferPointer(start: pointer, count: frames))
                }
            }

            // Recording + calibration tap: the *raw* mic, deliberately upstream
            // of the filter. An exported WAV should be the real audio, and
            // calibration must not measure the previous calibration's passband.
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { pcm, _ in
                guard let channel = pcm.floatChannelData?[0] else { return }
                let frames = Int(pcm.frameLength)
                channel.withMemoryRebound(to: Float.self, capacity: frames) { pointer in
                    let samples = UnsafeBufferPointer(start: pointer, count: frames)
                    if recordingFlag.value { recording.append(samples) }
                    if calibrating.value { analyzer?.append(samples) }
                    if gating.value { gate?.append(samples) }
                }
            }

            engine.prepare()
            try engine.start()

            startTime = CFAbsoluteTimeGetCurrent()
            silenceStartedAt = nil
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
        if eq.engine != nil { eq.removeTap(onBus: 0) }
        calibrationActive.value = false
        calibrationCancelled = true
        calibrationTask?.cancel()
        calibrationTask = nil
        calibrationPhase = .idle
        calibrationProgress = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        isRecordingFlag.value = false
        hasRecordedData = hasRecordedData || !recordingBuffer.isEmpty
        isRunning = false
        isRecording = false
        isAlarm = false
        currentAmplitude = 0
        peakAmplitude = 0
        // Otherwise a "Room noise ignored" badge lingers over a stopped
        // monitor, implying analysis that is no longer running.
        gateActive.value = false
        gateVerdict = .noProfile
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

    // MARK: - Breath calibration

    /// Points the EQ band at the active profile, or bypasses it.
    private func applyBandToFilter() {
        guard let parametric = eq.bands.first else { return }
        if filterEnabled, let band {
            parametric.filterType = .bandPass
            parametric.frequency = Float(band.centerHz)
            parametric.bandwidth = band.bandwidthOctaves
            parametric.bypass = false
        } else {
            parametric.bypass = true
        }
        eq.bypass = !(filterEnabled && band != nil)
        gateActive.value = filterEnabled && band != nil
        if !gateActive.value { gateVerdict = .noProfile }
    }

    /// Starts calibration and retains the task, so `cancelCalibration()` and
    /// `stop()` can actually cancel it. Callers must go through this rather
    /// than spawning their own task: a task the engine does not hold cannot be
    /// cancelled, and the run would finish and apply a profile regardless.
    func startCalibration() {
        guard calibrationTask == nil else { return }
        calibrationTask = Task { [weak self] in
            guard let self else { return nil }
            let result = await self.calibrate()
            self.calibrationTask = nil
            return result
        }
    }

    /// Samples the room, then the patient, and derives a passband from the
    /// difference between the two averaged spectra.
    @discardableResult
    func calibrate() async -> BreathBand? {
        guard isRunning, let analyzer = calibrationAnalyzer else {
            calibrationError = "Start monitoring before calibrating."
            return nil
        }

        calibrationError = nil
        calibrationCancelled = false

        // Calibration reads the raw input tap, so the filter state does not
        // affect the measurement — no need to bypass it here.
        func collect(seconds: Double, phase: CalibrationPhase) async -> [Double]? {
            calibrationPhase = phase
            calibrationProgress = 0
            analyzer.reset()
            calibrationActive.value = true
            defer { calibrationActive.value = false }

            let start = CFAbsoluteTimeGetCurrent()
            while CFAbsoluteTimeGetCurrent() - start < seconds {
                if Task.isCancelled || calibrationCancelled || !isRunning { return nil }
                calibrationProgress = min((CFAbsoluteTimeGetCurrent() - start) / seconds, 1)
                try? await Task.sleep(for: .milliseconds(50))
            }

            let spectrum = analyzer.averageDb()
            return spectrum.isEmpty ? nil : spectrum
        }

        defer {
            calibrationPhase = .idle
            calibrationProgress = 0
        }

        guard let ambient = await collect(seconds: Self.calibrationAmbientSeconds, phase: .ambient) else {
            return nil
        }
        guard let breathing = await collect(seconds: Self.calibrationBreathSeconds, phase: .breathing) else {
            return nil
        }

        // A cancel landing during the final sleep must not still apply a band.
        guard !Task.isCancelled, !calibrationCancelled else { return nil }

        calibrationPhase = .analyzing
        let binHz = sampleRate / Double(analyzer.fftSize)

        guard let picked = BreathBandPicker.pick(ambientDb: ambient, breathDb: breathing, binHz: binHz) else {
            calibrationError = "Breathing never rose clearly above the room noise. Move the mic closer and try again."
            return nil
        }

        setBand(picked)
        filterEnabled = true
        return picked
    }

    func cancelCalibration() {
        calibrationCancelled = true
        calibrationTask?.cancel()
        calibrationTask = nil
        calibrationActive.value = false
        calibrationPhase = .idle
        calibrationProgress = 0
    }

    func clearCalibration() {
        setBand(nil)
        filterEnabled = false
        calibrationError = nil
    }

    private func setBand(_ next: BreathBand?) {
        band = next
        if let next, let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: Self.bandDefaultsKey)
        } else if next == nil {
            UserDefaults.standard.removeObject(forKey: Self.bandDefaultsKey)
        }
        applyBandToFilter()
    }

    func dismissAlarm() {
        isAlarm = false
        // Restart the clock, not just the counter: leaving the old timestamp
        // in place would re-trip the alarm on the very next tick.
        silenceStartedAt = nil
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
        let rawRms = recent.isEmpty ? 0 : (sumSquares / Float(recent.count)).squareRoot()
        let rms = rawRms * gain

        // Silence detection runs at the reference gain, not the user's, so
        // turning sensitivity up to see a faint trace cannot quietly
        // desensitise the alarm.
        var detectionRms = rawRms * Self.defaultGain

        // Breath gate: with a calibrated profile active, sound that does not
        // look like the calibrated breathing (room speech, alarms, knocks) is
        // not counted as airflow. Rejecting only ever makes the alarm fire
        // sooner, never later.
        if filterEnabled, let band, let analyzer = gateAnalyzer {
            let spectrum = analyzer.latestDb()
            if !spectrum.isEmpty {
                let binHz = sampleRate / Double(analyzer.fftSize)
                let verdict = BreathBandPicker.classify(
                    BreathBandPicker.stats(spectrumDb: spectrum, binHz: binHz, band: band),
                    profile: band
                )
                gateVerdict = verdict
                if verdict == .belowAmbient || verdict == .notBreathShaped {
                    detectionRms = 0
                }
            }
        }

        currentAmplitude = rms
        peakAmplitude = peak * gain
        elapsedTime = CFAbsoluteTimeGetCurrent() - startTime
        waveform = waveformBuffer.snapshot()

        // Silence is measured from a wall-clock timestamp rather than summing
        // the timer interval: Timer coalescing and missed fires would otherwise
        // make the apnea alarm late by however much the timer drifted.
        let now = CFAbsoluteTimeGetCurrent()
        if detectionRms < Self.threshold {
            if silenceStartedAt == nil { silenceStartedAt = now }
            silenceDuration = now - (silenceStartedAt ?? now)
            if silenceDuration > Self.maxSilenceDuration && !isAlarm {
                isAlarm = true
            }
        } else {
            silenceStartedAt = nil
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
