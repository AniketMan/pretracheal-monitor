import Accelerate
import Foundation

/// Accumulates an averaged magnitude spectrum (dB) across many audio buffers.
///
/// The web build gets this free from `AnalyserNode.getFloatFrequencyData`.
/// On iOS we do it ourselves with vDSP: Hann window, real FFT, magnitude in dB,
/// running mean per bin.
///
/// Lock-guarded because frames arrive on the audio thread while calibration
/// reads the result from the main actor.
final class SpectrumAnalyzer: @unchecked Sendable {
    let fftSize: Int
    var binCount: Int { fftSize / 2 }

    private let log2n: vDSP_Length
    private let fftSetup: FFTSetup
    private let window: [Float]
    private let lock = NSLock()

    private var sum: [Double]
    private var frames = 0
    private var pending: [Float] = []
    /// Exponentially smoothed most-recent spectrum, for the runtime gate.
    /// Mirrors AnalyserNode's default smoothingTimeConstant of 0.8.
    private var smoothed: [Double]
    private var hasSmoothed = false
    private let smoothing = 0.8

    init?(fftSize: Int = 2048) {
        guard fftSize > 0, (fftSize & (fftSize - 1)) == 0 else { return nil }
        self.fftSize = fftSize
        self.log2n = vDSP_Length(log2(Double(fftSize)))
        guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return nil }
        self.fftSetup = setup
        self.sum = [Double](repeating: 0, count: fftSize / 2)
        self.smoothed = [Double](repeating: -140, count: fftSize / 2)

        var hann = [Float](repeating: 0, count: fftSize)
        vDSP_hann_window(&hann, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
        self.window = hann
    }

    deinit {
        vDSP_destroy_fftsetup(fftSetup)
    }

    func reset() {
        lock.lock()
        defer { lock.unlock() }
        for i in sum.indices { sum[i] = 0 }
        frames = 0
        pending.removeAll(keepingCapacity: true)
    }

    /// Latest smoothed spectrum in dB. Empty until at least one frame landed.
    func latestDb() -> [Double] {
        lock.lock()
        defer { lock.unlock() }
        return hasSmoothed ? smoothed : []
    }

    /// Feeds samples, consuming them in fftSize-sized hops.
    func append(_ samples: UnsafeBufferPointer<Float>) {
        lock.lock()
        defer { lock.unlock() }
        pending.append(contentsOf: samples)

        while pending.count >= fftSize {
            let frame = Array(pending[0..<fftSize])
            pending.removeFirst(fftSize)
            accumulateLocked(frame)
        }
    }

    /// Averaged spectrum in dB, oldest-to-highest bin. Empty if nothing seen.
    func averageDb() -> [Double] {
        lock.lock()
        defer { lock.unlock() }
        guard frames > 0 else { return [] }
        return sum.map { $0 / Double(frames) }
    }

    var frameCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return frames
    }

    // Caller holds the lock.
    private func accumulateLocked(_ frame: [Float]) {
        var windowed = [Float](repeating: 0, count: fftSize)
        vDSP_vmul(frame, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))

        var real = [Float](repeating: 0, count: fftSize / 2)
        var imag = [Float](repeating: 0, count: fftSize / 2)
        var magnitudes = [Float](repeating: 0, count: fftSize / 2)

        real.withUnsafeMutableBufferPointer { realPtr in
            imag.withUnsafeMutableBufferPointer { imagPtr in
                var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)

                windowed.withUnsafeBufferPointer { srcPtr in
                    srcPtr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: fftSize / 2) { typed in
                        vDSP_ctoz(typed, 2, &split, 1, vDSP_Length(fftSize / 2))
                    }
                }

                vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&split, 1, &magnitudes, 1, vDSP_Length(fftSize / 2))
            }
        }

        // Power -> dB. Floor matches the web build's treatment of silent bins.
        let scale = 1.0 / Double(fftSize * fftSize)
        for i in 0..<(fftSize / 2) {
            let power = Double(magnitudes[i]) * scale
            let db = power > 0 ? max(10 * log10(power), -140) : -140
            sum[i] += db
            smoothed[i] = hasSmoothed ? smoothed[i] * smoothing + db * (1 - smoothing) : db
        }
        hasSmoothed = true
        frames += 1
    }
}
