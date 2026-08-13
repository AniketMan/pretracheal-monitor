import Foundation
import Testing
@testable import PretrachealMonitor

/// Mirrors client/src/lib/breathBand.test.ts so both platforms are held to the
/// same behaviour.
struct BreathBandTests {
    static let fftSize = 2048
    static let sampleRate = 44_100.0
    static let binHz = sampleRate / Double(fftSize)
    static let bins = fftSize / 2

    /// Flat noise floor with optional gaussian bumps, in dB.
    static func spectrum(_ bumps: [(hz: Double, widthHz: Double, db: Double)],
                         floorDb: Double = -90) -> [Double] {
        (0..<bins).map { i in
            let hz = Double(i) * binHz
            return bumps.reduce(floorDb) { acc, bump in
                let d = (hz - bump.hz) / bump.widthHz
                return acc + bump.db * exp(-d * d)
            }
        }
    }

    @Test func findsBandWhereBreathingRisesAboveAmbient() {
        let ambient = Self.spectrum([])
        let breath = Self.spectrum([(hz: 400, widthHz: 120, db: 30)])

        let band = BreathBandPicker.pick(ambientDb: ambient, breathDb: breath, binHz: Self.binHz)

        #expect(band != nil)
        #expect(band!.centerHz > 250)
        #expect(band!.centerHz < 600)
        #expect(band!.lowHz < band!.highHz)
    }

    @Test func ignoresLoudSteadyTonePresentInBothPhases() {
        // A ventilator at 120 Hz, far louder than the breath, in both spectra.
        let vent = (hz: 120.0, widthHz: 25.0, db: 55.0)
        let ambient = Self.spectrum([vent])
        let breath = Self.spectrum([vent, (hz: 700, widthHz: 150, db: 20)])

        let band = BreathBandPicker.pick(ambientDb: ambient, breathDb: breath, binHz: Self.binHz)

        #expect(band != nil)
        #expect(band!.lowHz > 300)
        #expect(band!.centerHz > 450)
    }

    @Test func returnsNilWhenBreathingNeverRisesAboveAmbient() {
        let same = Self.spectrum([(hz: 400, widthHz: 120, db: 30)])

        #expect(BreathBandPicker.pick(ambientDb: same, breathDb: same, binHz: Self.binHz) == nil)
    }

    @Test func neverReturnsBandNarrowerThanMinimum() {
        let ambient = Self.spectrum([])
        let breath = Self.spectrum([(hz: 500, widthHz: 5, db: 40)])

        let band = BreathBandPicker.pick(ambientDb: ambient, breathDb: breath, binHz: Self.binHz)

        #expect(band != nil)
        #expect(band!.highHz - band!.lowHz >= BreathBandPicker.minWidthHz - 1)
        #expect(band!.bandwidthOctaves > 0)
    }

    @Test func clampsToTheAudibleRangeUsedForBreathSounds() {
        let ambient = Self.spectrum([])
        let breath = Self.spectrum([(hz: 30, widthHz: 20, db: 40)])

        if let band = BreathBandPicker.pick(ambientDb: ambient, breathDb: breath, binHz: Self.binHz) {
            #expect(band.lowHz >= BreathBandPicker.floorHz)
            #expect(band.highHz <= BreathBandPicker.ceilingHz)
        }
    }

    @Test func handlesDegenerateInput() {
        #expect(BreathBandPicker.pick(ambientDb: [], breathDb: [], binHz: Self.binHz) == nil)
        #expect(BreathBandPicker.pick(ambientDb: [Double](repeating: 0, count: Self.bins),
                                      breathDb: [Double](repeating: 0, count: Self.bins),
                                      binHz: 0) == nil)
    }

    // MARK: - Room-noise gate

    static func calibrated() -> (band: BreathBand, ambient: [Double], breath: [Double]) {
        let ambient = spectrum([])
        let breath = spectrum([(hz: 400, widthHz: 120, db: 30)])
        let band = BreathBandPicker.pick(ambientDb: ambient, breathDb: breath, binHz: binHz)!
        return (band, ambient, breath)
    }

    @Test func recordsGateReferenceLevelsDuringCalibration() {
        let (band, _, _) = Self.calibrated()
        #expect(band.ambientInBandDb != nil)
        #expect((band.dominanceDb ?? 0) > 0)
    }

    @Test func acceptsTheBreathingItWasCalibratedOn() {
        let (band, _, breath) = Self.calibrated()
        let stats = BreathBandPicker.stats(spectrumDb: breath, binHz: Self.binHz, band: band)
        #expect(BreathBandPicker.classify(stats, profile: band) == .breath)
    }

    @Test func rejectsRoomSpeechLouderThanTheBreath() {
        let (band, _, _) = Self.calibrated()
        // Speech: fundamental plus formants spread across the spectrum,
        // overlapping the band but not confined to it, and louder overall.
        let speech = Self.spectrum([
            (hz: 150, widthHz: 60, db: 38),
            (hz: 500, widthHz: 200, db: 40),
            (hz: 1500, widthHz: 400, db: 36),
            (hz: 2500, widthHz: 500, db: 32),
        ])
        let stats = BreathBandPicker.stats(spectrumDb: speech, binHz: Self.binHz, band: band)
        #expect(BreathBandPicker.classify(stats, profile: band) == .notBreathShaped)
    }

    @Test func rejectsQuietRoomTone() {
        let (band, ambient, _) = Self.calibrated()
        let stats = BreathBandPicker.stats(spectrumDb: ambient, binHz: Self.binHz, band: band)
        #expect(BreathBandPicker.classify(stats, profile: band) == .belowAmbient)
    }

    @Test func reportsNoProfileForBandsSavedBeforeTheGateExisted() {
        var (band, _, breath) = Self.calibrated()
        let stats = BreathBandPicker.stats(spectrumDb: breath, binHz: Self.binHz, band: band)
        band.ambientInBandDb = nil
        band.dominanceDb = nil
        #expect(BreathBandPicker.classify(stats, profile: band) == .noProfile)
    }

    // MARK: - Gain ladder

    @MainActor
    @Test func gainLadderRoundTripsWithoutSnapBack() {
        for index in AudioEngine.gainSteps.indices {
            let gain = AudioEngine.gain(forStep: index)
            #expect(AudioEngine.step(forGain: gain) == index)
        }
    }

    @MainActor
    @Test func gainLadderCoversTheAdvertisedRange() {
        #expect(AudioEngine.gainSteps.first == 10)
        #expect(AudioEngine.gainSteps.last == 500)
        #expect(AudioEngine.gainSteps.contains(AudioEngine.defaultGain))
        // Monotonically increasing.
        #expect(zip(AudioEngine.gainSteps, AudioEngine.gainSteps.dropFirst()).allSatisfy { $0 < $1 })
    }
}
