import Foundation

/// Deriving a breath passband from two averaged FFT spectra.
///
/// Port of `client/src/lib/breathBand.ts`. Calibration records ambient noise
/// first, then the patient breathing. The band we want is where breathing
/// stands *above ambient* by the widest margin — not simply where the
/// breathing spectrum is loudest, which on a ward would often just be the
/// ventilator, mains hum, or the loudest room tone.
///
/// Pure and free of AVFoundation so it can be exercised with synthetic spectra.
struct BreathBand: Codable, Equatable, Sendable {
    var lowHz: Double
    var highHz: Double
    /// Geometric centre — the right centre for a log-spaced filter.
    var centerHz: Double
    /// Bandwidth in octaves, which is what AVAudioUnitEQ wants.
    var bandwidthOctaves: Float
    /// Peak breath-over-ambient margin, in dB.
    var peakSnrDb: Double

    // Gate reference levels, measured during the same calibration. Optional so
    // profiles saved by earlier builds still decode; the gate stays off until
    // the patient is recalibrated.

    /// Mean in-band level of the room, dB.
    var ambientInBandDb: Double?
    /// How far in-band level sat above out-of-band level while the patient
    /// breathed, dB. Speech and other room sound spill across the spectrum, so
    /// they score far lower on this than breath does.
    var dominanceDb: Double?
}

struct BandStats: Equatable {
    /// Mean level inside the passband, dB.
    var inBandDb: Double
    /// Mean level outside the passband but within the analysed range, dB.
    var outBandDb: Double
}

enum GateVerdict: Equatable {
    case breath
    case belowAmbient
    case notBreathShaped
    case noProfile
}

enum BreathBandPicker {
    /// Lowest/highest frequency the passband is ever allowed to reach (Hz).
    static let floorHz: Double = 60
    static let ceilingHz: Double = 4000

    /// Narrower than this and the filter rings; wider and it stops isolating.
    static let minWidthHz: Double = 80

    /// How far below the peak SNR a bin can be and still count as in-band (dB).
    private static let edgeDropDb: Double = 6

    /// Breathing must beat ambient by at least this much to be usable.
    static let minUsableSnrDb: Double = 3

    /// In-band level must clear the calibrated room level by this much (dB).
    static let gateLevelMarginDb: Double = 6

    /// Allowed shortfall against the calibrated breath dominance (dB).
    static let gateDominanceToleranceDb: Double = 6

    /// Mean in-band and out-of-band level for one spectrum.
    static func stats(spectrumDb: [Double], binHz: Double, band: BreathBand) -> BandStats {
        guard binHz > 0, !spectrumDb.isEmpty else {
            return BandStats(inBandDb: -140, outBandDb: -140)
        }

        var inSum = 0.0, outSum = 0.0
        var inCount = 0, outCount = 0

        let firstBin = max(1, Int(floorHz / binHz))
        let lastBin = min(spectrumDb.count - 1, Int((ceilingHz / binHz).rounded(.up)))
        guard lastBin > firstBin else { return BandStats(inBandDb: -140, outBandDb: -140) }

        for i in firstBin...lastBin {
            let value = spectrumDb[i]
            guard value.isFinite else { continue }
            let hz = Double(i) * binHz
            if hz >= band.lowHz && hz <= band.highHz {
                inSum += value
                inCount += 1
            } else {
                outSum += value
                outCount += 1
            }
        }

        return BandStats(
            inBandDb: inCount > 0 ? inSum / Double(inCount) : -140,
            outBandDb: outCount > 0 ? outSum / Double(outCount) : -140
        )
    }

    /// Decides whether what the mic hears right now looks like the calibrated
    /// breathing, or like something else in the room.
    ///
    /// Rejecting a sound means it is *not* treated as airflow, so the gate can
    /// only ever make the no-airflow alarm fire sooner. It cannot mask apnea.
    static func classify(_ stats: BandStats, profile: BreathBand) -> GateVerdict {
        guard let ambient = profile.ambientInBandDb, let dominance = profile.dominanceDb else {
            return .noProfile
        }
        if stats.inBandDb < ambient + gateLevelMarginDb { return .belowAmbient }
        if stats.inBandDb - stats.outBandDb < dominance - gateDominanceToleranceDb {
            return .notBreathShaped
        }
        return .breath
    }

    /// - Parameters:
    ///   - ambientDb: Averaged magnitude spectrum of the room, dB per bin.
    ///   - breathDb: Averaged magnitude spectrum while breathing, dB per bin.
    ///   - binHz: Width of one FFT bin in Hz (sampleRate / fftSize).
    /// - Returns: The passband, or nil if breathing never rose meaningfully
    ///   above ambient — in which case the caller should keep the raw signal
    ///   rather than filter against noise.
    static func pick(ambientDb: [Double], breathDb: [Double], binHz: Double) -> BreathBand? {
        let bins = min(ambientDb.count, breathDb.count)
        guard bins > 0, binHz > 0 else { return nil }

        let firstBin = max(1, Int(floorHz / binHz))
        let lastBin = min(bins - 1, Int((ceilingHz / binHz).rounded(.up)))
        guard lastBin > firstBin else { return nil }

        var snr = [Double](repeating: -.infinity, count: bins)
        var peakBin = -1
        var peakSnr = -Double.infinity

        for i in firstBin...lastBin {
            let a = ambientDb[i]
            let b = breathDb[i]
            guard a.isFinite, b.isFinite else { continue }
            let margin = b - a
            snr[i] = margin
            if margin > peakSnr {
                peakSnr = margin
                peakBin = i
            }
        }

        guard peakBin >= 0, peakSnr >= minUsableSnrDb else { return nil }

        // Walk outwards while bins stay within edgeDropDb of the peak.
        let edge = peakSnr - edgeDropDb
        var lo = peakBin
        var hi = peakBin
        while lo > firstBin, snr[lo - 1] >= edge { lo -= 1 }
        while hi < lastBin, snr[hi + 1] >= edge { hi += 1 }

        var lowHz = max(Double(lo) * binHz, floorHz)
        var highHz = min(Double(hi + 1) * binHz, ceilingHz)

        if highHz - lowHz < minWidthHz {
            let centre = (lowHz + highHz) / 2
            lowHz = max(centre - minWidthHz / 2, floorHz)
            highHz = min(lowHz + minWidthHz, ceilingHz)
            lowHz = max(highHz - minWidthHz, floorHz)
        }

        let centerHz = (lowHz * highHz).squareRoot()
        // AVAudioUnitEQ expresses bandwidth in octaves, not Q.
        let octaves = Float(log2(max(highHz, 1) / max(lowHz, 1)))

        var band = BreathBand(
            lowHz: lowHz.rounded(),
            highHz: highHz.rounded(),
            centerHz: centerHz.rounded(),
            bandwidthOctaves: min(max(octaves, 0.05), 5.0),
            peakSnrDb: (peakSnr * 10).rounded() / 10
        )

        // Reference levels for the runtime gate, from the same two spectra.
        let ambientStats = stats(spectrumDb: ambientDb, binHz: binHz, band: band)
        let breathStats = stats(spectrumDb: breathDb, binHz: binHz, band: band)
        band.ambientInBandDb = (ambientStats.inBandDb * 10).rounded() / 10
        band.dominanceDb = ((breathStats.inBandDb - breathStats.outBandDb) * 10).rounded() / 10
        return band
    }
}
