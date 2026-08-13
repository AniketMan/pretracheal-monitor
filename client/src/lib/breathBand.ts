/**
 * Deriving a breath passband from two averaged FFT spectra.
 *
 * Calibration records ambient noise first, then the patient breathing. The
 * band we want is where breathing stands *above ambient* by the widest margin
 * -- not simply where the breathing spectrum is loudest, which on a ward would
 * often just be the ventilator, mains hum, or the loudest room tone.
 *
 * Kept free of Web Audio types so it can be exercised with synthetic spectra.
 */

/** Lowest/highest frequency the passband is ever allowed to reach (Hz). */
export const BAND_FLOOR_HZ = 60;
export const BAND_CEILING_HZ = 4000;

/** Narrower than this and the filter rings; wider and it stops isolating. */
export const MIN_BAND_WIDTH_HZ = 80;

/** How far below the peak SNR a bin can be and still count as in-band (dB). */
const BAND_EDGE_DROP_DB = 6;

/** Breathing must beat ambient by at least this much to be a usable signal. */
export const MIN_USABLE_SNR_DB = 3;

export interface BreathBand {
  lowHz: number;
  highHz: number;
  /** Geometric centre -- the right centre for a log-spaced filter. */
  centerHz: number;
  /** Q for a bandpass covering lowHz..highHz. */
  q: number;
  /** Peak breath-over-ambient margin, in dB. */
  peakSnrDb: number;

  // -- Gate reference levels, measured during the same calibration. --
  // Optional so profiles saved by earlier builds still load; the gate stays
  // off until the patient is recalibrated.

  /** Mean in-band level of the room, dB. */
  ambientInBandDb?: number;
  /**
   * How far in-band level sat above out-of-band level while the patient
   * breathed, dB. Speech and other room sound spill across the spectrum, so
   * they score far lower on this than breath does.
   */
  dominanceDb?: number;
}

export interface BandStats {
  /** Mean level inside the passband, dB. */
  inBandDb: number;
  /** Mean level outside the passband but within the analysed range, dB. */
  outBandDb: number;
}

/** Mean in-band and out-of-band level for one spectrum. */
export function bandStats(
  spectrumDb: ArrayLike<number>,
  binHz: number,
  band: Pick<BreathBand, 'lowHz' | 'highHz'>
): BandStats {
  let inSum = 0;
  let inCount = 0;
  let outSum = 0;
  let outCount = 0;

  const firstBin = Math.max(1, Math.floor(BAND_FLOOR_HZ / binHz));
  const lastBin = Math.min(spectrumDb.length - 1, Math.ceil(BAND_CEILING_HZ / binHz));

  for (let i = firstBin; i <= lastBin; i++) {
    const value = spectrumDb[i];
    if (!Number.isFinite(value)) continue;
    const hz = i * binHz;
    if (hz >= band.lowHz && hz <= band.highHz) {
      inSum += value;
      inCount++;
    } else {
      outSum += value;
      outCount++;
    }
  }

  return {
    inBandDb: inCount ? inSum / inCount : -140,
    outBandDb: outCount ? outSum / outCount : -140,
  };
}

/** In-band level must clear the calibrated room level by this much (dB). */
export const GATE_LEVEL_MARGIN_DB = 6;

/** Allowed shortfall against the calibrated breath dominance (dB). */
export const GATE_DOMINANCE_TOLERANCE_DB = 6;

export type GateVerdict = 'breath' | 'below-ambient' | 'not-breath-shaped' | 'no-profile';

/**
 * Decides whether what the mic is hearing right now looks like the calibrated
 * breathing, or like something else in the room.
 *
 * Two independent conditions, both derived from the calibration:
 *   1. in-band level has to clear the calibrated room level by a margin;
 *   2. in-band level has to dominate out-of-band level nearly as much as it
 *      did while the patient was breathing. Speech, alarms and dropped trays
 *      put comparable energy outside the band, so they fail this even when
 *      they are loud enough to pass (1).
 *
 * Rejecting a sound means it is *not* treated as airflow, so the gate can only
 * ever make the no-airflow alarm fire sooner. It cannot mask apnea.
 */
export function classifyBreath(stats: BandStats, profile: BreathBand): GateVerdict {
  if (profile.ambientInBandDb === undefined || profile.dominanceDb === undefined) {
    return 'no-profile';
  }
  if (stats.inBandDb < profile.ambientInBandDb + GATE_LEVEL_MARGIN_DB) {
    return 'below-ambient';
  }
  const dominance = stats.inBandDb - stats.outBandDb;
  if (dominance < profile.dominanceDb - GATE_DOMINANCE_TOLERANCE_DB) {
    return 'not-breath-shaped';
  }
  return 'breath';
}

/**
 * @param ambientDb  Averaged magnitude spectrum of the room, in dB per bin.
 * @param breathDb   Averaged magnitude spectrum while breathing, in dB per bin.
 * @param binHz      Width of one FFT bin in Hz (sampleRate / fftSize).
 * @returns The passband, or null if breathing never rose meaningfully above
 *          ambient -- in which case the caller should keep the raw signal
 *          rather than filter against noise.
 */
export function pickBreathBand(
  ambientDb: ArrayLike<number>,
  breathDb: ArrayLike<number>,
  binHz: number
): BreathBand | null {
  const bins = Math.min(ambientDb.length, breathDb.length);
  if (bins === 0 || binHz <= 0) return null;

  const firstBin = Math.max(1, Math.floor(BAND_FLOOR_HZ / binHz));
  const lastBin = Math.min(bins - 1, Math.ceil(BAND_CEILING_HZ / binHz));
  if (lastBin <= firstBin) return null;

  // Per-bin margin of breathing over ambient.
  const snr: number[] = new Array(bins).fill(-Infinity);
  let peakBin = -1;
  let peakSnr = -Infinity;
  for (let i = firstBin; i <= lastBin; i++) {
    const a = ambientDb[i];
    const b = breathDb[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const margin = b - a;
    snr[i] = margin;
    if (margin > peakSnr) {
      peakSnr = margin;
      peakBin = i;
    }
  }

  if (peakBin < 0 || peakSnr < MIN_USABLE_SNR_DB) return null;

  // Walk outwards while bins stay within BAND_EDGE_DROP_DB of the peak.
  const edge = peakSnr - BAND_EDGE_DROP_DB;
  let lo = peakBin;
  let hi = peakBin;
  while (lo > firstBin && snr[lo - 1] >= edge) lo--;
  while (hi < lastBin && snr[hi + 1] >= edge) hi++;

  let lowHz = Math.max(lo * binHz, BAND_FLOOR_HZ);
  let highHz = Math.min((hi + 1) * binHz, BAND_CEILING_HZ);

  // Widen symmetrically (in log space) if the band came out too narrow.
  if (highHz - lowHz < MIN_BAND_WIDTH_HZ) {
    const centre = (lowHz + highHz) / 2;
    lowHz = Math.max(centre - MIN_BAND_WIDTH_HZ / 2, BAND_FLOOR_HZ);
    highHz = Math.min(lowHz + MIN_BAND_WIDTH_HZ, BAND_CEILING_HZ);
    lowHz = Math.max(highHz - MIN_BAND_WIDTH_HZ, BAND_FLOOR_HZ);
  }

  const centerHz = Math.sqrt(lowHz * highHz);
  const q = centerHz / Math.max(highHz - lowHz, 1);

  const rounded = { lowHz: Math.round(lowHz), highHz: Math.round(highHz) };
  // Reference levels for the runtime gate, measured from the same two spectra.
  const ambientStats = bandStats(ambientDb, binHz, rounded);
  const breathStats = bandStats(breathDb, binHz, rounded);

  return {
    ...rounded,
    centerHz: Math.round(centerHz),
    q: Number(q.toFixed(3)),
    peakSnrDb: Number(peakSnr.toFixed(1)),
    ambientInBandDb: Number(ambientStats.inBandDb.toFixed(1)),
    dominanceDb: Number((breathStats.inBandDb - breathStats.outBandDb).toFixed(1)),
  };
}
