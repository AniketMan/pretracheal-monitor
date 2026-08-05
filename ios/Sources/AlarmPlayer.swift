import AVFoundation
import UIKit

/// Repeating 880 Hz beep plus haptics while the silence alarm is active —
/// the native equivalent of the Web Audio oscillator in `AlarmOverlay.tsx`.
@MainActor
final class AlarmPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var buffer: AVAudioPCMBuffer?
    private var timer: Timer?
    private let haptics = UINotificationFeedbackGenerator()

    func start() {
        guard timer == nil else { return }
        prepareEngineIfNeeded()
        pulse()
        let timer = Timer(timeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pulse() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player.stop()
        if engine.isRunning { engine.stop() }
    }

    private func pulse() {
        haptics.notificationOccurred(.warning)
        guard let buffer else { return }
        if !engine.isRunning { try? engine.start() }
        player.scheduleBuffer(buffer, at: nil, options: .interrupts)
        player.play()
    }

    private func prepareEngineIfNeeded() {
        guard buffer == nil else { return }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        buffer = Self.makeBeepPattern(format: format)
        try? engine.start()
    }

    /// 1.5 s of 120 ms-on / 80 ms-off beeps with short ramps, matching the web tone.
    private static func makeBeepPattern(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let sampleRate = format.sampleRate
        let total = AVAudioFrameCount(sampleRate * 1.5)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: total),
              let channel = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = total

        let beepOn = 0.12, beepOff = 0.08
        let cycle = beepOn + beepOff

        for frame in 0..<Int(total) {
            let t = Double(frame) / sampleRate
            let phaseInCycle = t.truncatingRemainder(dividingBy: cycle)
            var amplitude = 0.0
            if phaseInCycle < beepOn {
                let ramp = min(phaseInCycle / 0.01, (beepOn - phaseInCycle) / 0.01, 1.0)
                amplitude = 0.25 * max(ramp, 0)
            }
            channel[frame] = Float(amplitude * sin(2 * .pi * 880 * t))
        }
        return buffer
    }
}
