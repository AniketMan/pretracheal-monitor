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
