import { describe, expect, it } from 'vitest';
import { MIN_BAND_WIDTH_HZ, pickBreathBand } from './breathBand';

const FFT_SIZE = 2048;
const SAMPLE_RATE = 44100;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE; // ~21.5 Hz
const BINS = FFT_SIZE / 2;

/** Flat noise floor with optional gaussian bumps, in dB. */
function spectrum(bumps: Array<{ hz: number; widthHz: number; db: number }>, floorDb = -90) {
  const out = new Float32Array(BINS).fill(floorDb);
  for (let i = 0; i < BINS; i++) {
    const hz = i * BIN_HZ;
    for (const b of bumps) {
      const d = (hz - b.hz) / b.widthHz;
      out[i] += b.db * Math.exp(-d * d);
    }
  }
  return out;
}

describe('pickBreathBand', () => {
  it('finds the band where breathing rises above ambient', () => {
    const ambient = spectrum([]);
    const breath = spectrum([{ hz: 400, widthHz: 120, db: 30 }]);

    const band = pickBreathBand(ambient, breath, BIN_HZ);

    expect(band).not.toBeNull();
    expect(band!.centerHz).toBeGreaterThan(250);
    expect(band!.centerHz).toBeLessThan(600);
    expect(band!.lowHz).toBeLessThan(band!.highHz);
  });

  it('ignores a loud steady tone present in both phases', () => {
    // A ventilator at 120 Hz, far louder than the breath, in both spectra.
    const vent = { hz: 120, widthHz: 25, db: 55 };
    const ambient = spectrum([vent]);
    const breath = spectrum([vent, { hz: 700, widthHz: 150, db: 20 }]);

    const band = pickBreathBand(ambient, breath, BIN_HZ);

    expect(band).not.toBeNull();
    // The band must sit on the breath, not on the much louder vent tone.
    expect(band!.lowHz).toBeGreaterThan(300);
    expect(band!.centerHz).toBeGreaterThan(450);
  });

  it('returns null when breathing never rises above ambient', () => {
    const ambient = spectrum([{ hz: 400, widthHz: 120, db: 30 }]);
    const breath = spectrum([{ hz: 400, widthHz: 120, db: 30 }]);

    expect(pickBreathBand(ambient, breath, BIN_HZ)).toBeNull();
  });

  it('never returns a band narrower than the minimum width', () => {
    const ambient = spectrum([]);
    // Single-bin spike -- edges would otherwise collapse onto one bin.
    const breath = spectrum([{ hz: 500, widthHz: 5, db: 40 }]);

    const band = pickBreathBand(ambient, breath, BIN_HZ);

    expect(band).not.toBeNull();
    expect(band!.highHz - band!.lowHz).toBeGreaterThanOrEqual(MIN_BAND_WIDTH_HZ - 1);
    expect(band!.q).toBeGreaterThan(0);
  });

  it('clamps to the audible range used for breath sounds', () => {
    const ambient = spectrum([]);
    const breath = spectrum([{ hz: 30, widthHz: 20, db: 40 }]);

    const band = pickBreathBand(ambient, breath, BIN_HZ);

    if (band) {
      expect(band.lowHz).toBeGreaterThanOrEqual(60);
      expect(band.highHz).toBeLessThanOrEqual(4000);
    }
  });

  it('handles degenerate input without throwing', () => {
    expect(pickBreathBand(new Float32Array(0), new Float32Array(0), BIN_HZ)).toBeNull();
    expect(pickBreathBand(new Float32Array(BINS), new Float32Array(BINS), 0)).toBeNull();
  });
});
