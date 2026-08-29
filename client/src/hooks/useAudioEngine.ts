/**
 * useAudioEngine - Core audio processing hook for Pneuma Sense.
 *
 * Responsibilities:
 *   1. Enumerate available audio input devices (mic selector for iOS 26+ input switching)
 *   2. Capture microphone audio via Web Audio API (getUserMedia + AudioContext)
 *   3. Maintain a rolling buffer of amplitude data for waveform rendering
 *   4. Detect silence duration and trigger alarm state
 *   5. Optionally pass audio through to speakers
 *   6. Record all audio chunks for WAV export
 *
 * Architecture:
 *   getUserMedia -> MediaStreamSource -> AnalyserNode -> ScriptProcessorNode
 *                                                     -> (optional) destination (speakers)
 *
 * iOS Compatibility Notes:
 *   - AudioContext must be created/resumed after a user gesture (tap)
 *   - getUserMedia requires HTTPS or localhost
 *   - iOS 26+ supports audio input device switching natively in Safari
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  bandStats,
  classifyBreath,
  pickBreathBand,
  type BreathBand,
  type GateVerdict,
} from '@/lib/breathBand';

// -- Configuration constants --
// These mirror the original Python script parameters
const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const WINDOW_DURATION = 3.0; // seconds of visible waveform
const GAIN = 50; // default display amplification
const GAIN_MIN = 10;
const GAIN_MAX = 500;
const GAIN_STORAGE_KEY = 'monitor.gain';

/**
 * The slider steps through a fixed ladder of gain values spaced roughly
 * logarithmically, so the 10x-100x region where useful adjustments live keeps
 * most of the travel instead of being squeezed into the first fifth of the
 * track. A ladder rather than a continuous curve because rounding a continuous
 * mapping back to readable values makes the thumb snap backwards mid-drag.
 */
export const GAIN_STEPS = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 140, 160,
  180, 200, 250, 300, 350, 400, 450, 500,
];

const GAIN_SLIDER_MAX = GAIN_STEPS.length - 1;

/** Slider index -> gain. */
export function gainForSliderPosition(position: number): number {
  const index = Math.min(Math.max(Math.round(position), 0), GAIN_SLIDER_MAX);
  return GAIN_STEPS[index];
}

/** Gain -> nearest slider index. Stable round-trip with the above. */
export function sliderPositionForGain(gain: number): number {
  let best = 0;
  for (let i = 1; i < GAIN_STEPS.length; i++) {
    if (Math.abs(GAIN_STEPS[i] - gain) < Math.abs(GAIN_STEPS[best] - gain)) {
      best = i;
    }
  }
  return best;
}

const THRESHOLD = 1; // amplitude below which audio is "silent"
const MAX_SILENCE_DURATION = 30; // seconds before alarm fires (matches PDF spec)
const BUFFER_LENGTH = Math.floor(SAMPLE_RATE * WINDOW_DURATION);

const BAND_STORAGE_KEY = 'monitor.breathBand';
const FILTER_STORAGE_KEY = 'monitor.breathFilterEnabled';

/** How long each calibration phase listens, in seconds. */
export const CALIBRATION_AMBIENT_SECONDS = 3;
export const CALIBRATION_BREATH_SECONDS = 6;

export type CalibrationPhase = 'idle' | 'ambient' | 'breathing' | 'analyzing';

function loadStoredBand(): BreathBand | null {
  try {
    const raw = window.localStorage.getItem(BAND_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BreathBand;
    // Guard against a hand-edited or half-written entry.
    if (
      typeof parsed?.lowHz !== 'number' ||
      typeof parsed?.highHz !== 'number' ||
      typeof parsed?.centerHz !== 'number' ||
      typeof parsed?.q !== 'number' ||
      !(parsed.highHz > parsed.lowHz)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadStoredFilterEnabled(): boolean {
  try {
    return window.localStorage.getItem(FILTER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Reads the persisted mic sensitivity, falling back to the default. */
function loadStoredGain(): number {
  try {
    const raw = window.localStorage.getItem(GAIN_STORAGE_KEY);
    if (raw === null) return GAIN;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return GAIN;
    return Math.min(Math.max(parsed, GAIN_MIN), GAIN_MAX);
  } catch {
    // Private browsing / storage disabled -- fall back to the default.
    return GAIN;
  }
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface AudioEngineState {
  isRunning: boolean;
  isRecording: boolean;
  isAlarm: boolean;
  silenceDuration: number;
  currentAmplitude: number;
  elapsedTime: number;
  devices: AudioDevice[];
  selectedDeviceId: string | null;
  waveformData: Float32Array;
  peakAmplitude: number;
}

export function useAudioEngine() {
  // -- State --
  const [isRunning, setIsRunning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAlarm, setIsAlarm] = useState(false);
  const [silenceDuration, setSilenceDuration] = useState(0);
  const [currentAmplitude, setCurrentAmplitude] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [peakAmplitude, setPeakAmplitude] = useState(0);

  // Mic sensitivity. The render loop reads it through a ref so changes take
  // effect immediately instead of waiting for the loop to be re-created.
  const [gain, setGainState] = useState<number>(loadStoredGain);
  const gainRef = useRef(gain);

  const setGain = useCallback((value: number) => {
    const clamped = Math.min(Math.max(value, GAIN_MIN), GAIN_MAX);
    gainRef.current = clamped;
    setGainState(clamped);
    try {
      window.localStorage.setItem(GAIN_STORAGE_KEY, String(clamped));
    } catch {
      // Storage unavailable -- the setting just won't persist.
    }
  }, []);

  // -- Breath calibration --
  const [band, setBandState] = useState<BreathBand | null>(loadStoredBand);
  const [filterEnabled, setFilterEnabledState] = useState<boolean>(loadStoredFilterEnabled);
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationPhase>('idle');
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const recorderRef = useRef<ScriptProcessorNode | null>(null);
  const bandRef = useRef<BreathBand | null>(band);
  const filterEnabledRef = useRef(filterEnabled);
  const calibrationAbortRef = useRef(false);
  // Gate analysis needs the *raw* spectrum: the shape of what is out of band is
  // exactly what distinguishes speech from breath, and the filter removes it.
  const rawAnalyserRef = useRef<AnalyserNode | null>(null);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict>('no-profile');
  const gateVerdictRef = useRef<GateVerdict>('no-profile');
  const gateSpectrumRef = useRef<Float32Array>(new Float32Array(FFT_SIZE / 2));

  /** Points the biquad at the active band, or makes it a no-op pass-through. */
  const applyBandToFilter = useCallback((filter: BiquadFilterNode | null) => {
    if (!filter) return;
    const active = filterEnabledRef.current ? bandRef.current : null;
    if (active) {
      filter.type = 'bandpass';
      filter.frequency.value = active.centerHz;
      filter.Q.value = active.q;
    } else {
      // allpass at Q=0.0001 is flat across the spectrum -- simpler and
      // glitch-free compared with rewiring the graph on every toggle.
      filter.type = 'allpass';
      filter.frequency.value = 1000;
      filter.Q.value = 0.0001;
    }
  }, []);

  const setBand = useCallback(
    (next: BreathBand | null) => {
      bandRef.current = next;
      setBandState(next);
      try {
        if (next) window.localStorage.setItem(BAND_STORAGE_KEY, JSON.stringify(next));
        else window.localStorage.removeItem(BAND_STORAGE_KEY);
      } catch {
        // Storage unavailable -- the profile just won't persist.
      }
      applyBandToFilter(filterRef.current);
    },
    [applyBandToFilter]
  );

  const setFilterEnabled = useCallback(
    (next: boolean) => {
      filterEnabledRef.current = next;
      setFilterEnabledState(next);
      try {
        window.localStorage.setItem(FILTER_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable -- the setting just won't persist.
      }
      applyBandToFilter(filterRef.current);
    },
    [applyBandToFilter]
  );

  // -- Refs for audio pipeline (not in React state to avoid re-renders) --
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const waveformBufferRef = useRef<Float32Array>(new Float32Array(BUFFER_LENGTH));
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const silenceDurationRef = useRef(0);
  /** When the current run of silence began, or null while sound is present. */
  const silenceStartRef = useRef<number | null>(null);
  const isAlarmRef = useRef(false);
  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const passThoughRef = useRef(false);
  const isRecordingRef = useRef(false);
  const [hasRecordedData, setHasRecordedData] = useState(false);

  // Waveform data exposed for canvas rendering
  const [waveformData, setWaveformData] = useState<Float32Array>(
    () => new Float32Array(BUFFER_LENGTH)
  );

  // -- Enumerate audio input devices --
  const refreshDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      setDevices(audioInputs);
      // Auto-select first device if none selected
      if (!selectedDeviceId && audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, [selectedDeviceId]);

  // Listen for device changes (hot-plug, iOS input switching)
  useEffect(() => {
    refreshDevices();
    const handler = () => refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  // -- Start monitoring --
  const start = useCallback(
    async (deviceId?: string) => {
      if (isRunningRef.current) return;

      try {
        // Request microphone access
        // On iOS, this prompts the user for permission on first call
        const constraints: MediaStreamConstraints = {
          audio: deviceId
            ? { deviceId: { exact: deviceId }, sampleRate: SAMPLE_RATE }
            : { sampleRate: SAMPLE_RATE },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        // After getting permission, refresh device labels (they become available)
        await refreshDevices();

        // Create AudioContext (must happen after user gesture on iOS)
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        // iOS requires explicit resume
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        audioContextRef.current = ctx;

        // Build audio graph
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyserRef.current = analyser;

        // ScriptProcessorNode for raw sample access
        // (AudioWorklet is preferred but ScriptProcessor has wider iOS support)
        const processor = ctx.createScriptProcessor(1024, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const buffer = waveformBufferRef.current;

          // Shift buffer left and append new samples
          buffer.copyWithin(0, input.length);
          buffer.set(input, buffer.length - input.length);

        };

        // Bandpass sits between the mic and everything the UI reads, so when a
        // calibration profile is active the trace and the silence detector both
        // see breath-band audio only. Bypassed (all-pass) until calibrated.
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filterRef.current = filter;
        applyBandToFilter(filter);

        const rawAnalyser = ctx.createAnalyser();
        rawAnalyser.fftSize = FFT_SIZE;
        rawAnalyserRef.current = rawAnalyser;
        source.connect(rawAnalyser);

        source.connect(filter);
        filter.connect(analyser);
        analyser.connect(processor);
        // Connect processor to destination to keep it alive (required by spec)
        // Output is silence since we copy input but don't modify output
        processor.connect(ctx.destination);

        // Recording taps the *raw* source, deliberately upstream of the filter:
        // an exported WAV should be the real audio, not a filtered derivative.
        const recorder = ctx.createScriptProcessor(1024, 1, 1);
        recorderRef.current = recorder;
        recorder.onaudioprocess = (e) => {
          if (!isRecordingRef.current) return;
          recordedChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(recorder);
        recorder.connect(ctx.destination);

        // Reset state
        waveformBufferRef.current = new Float32Array(BUFFER_LENGTH);
        silenceDurationRef.current = 0;
        silenceStartRef.current = null;
        isAlarmRef.current = false;
        startTimeRef.current = performance.now();
        isRunningRef.current = true;

        setIsRunning(true);
        setIsAlarm(false);
        setSilenceDuration(0);
        setElapsedTime(0);

        // Start animation loop for UI updates
        const updateLoop = () => {
          if (!isRunningRef.current) return;

          const buffer = waveformBufferRef.current;
          const now = performance.now();
          const elapsed = (now - startTimeRef.current) / 1000;

          // Calculate current amplitude (RMS of recent samples)
          const recentSamples = buffer.slice(-1024);
          let rms = 0;
          for (let i = 0; i < recentSamples.length; i++) {
            rms += recentSamples[i] * recentSamples[i];
          }
          const rawRms = Math.sqrt(rms / recentSamples.length);
          rms = rawRms * gainRef.current;

          // Silence detection runs at the reference gain, not the user's, so
          // turning sensitivity up to see a faint trace cannot quietly
          // desensitise the alarm.
          let detectionRms = rawRms * GAIN;

          // Breath gate: with a calibrated profile active, sound that does not
          // look like the calibrated breathing (room speech, alarms, knocks)
          // is not counted as airflow. Rejecting only ever makes the alarm
          // fire sooner, never later.
          const activeBand = filterEnabledRef.current ? bandRef.current : null;
          const rawAnalyserNode = rawAnalyserRef.current;
          if (activeBand && rawAnalyserNode) {
            const spectrum = gateSpectrumRef.current;
            rawAnalyserNode.getFloatFrequencyData(spectrum);
            const binHz = ctx.sampleRate / rawAnalyserNode.fftSize;
            const verdict = classifyBreath(bandStats(spectrum, binHz, activeBand), activeBand);
            if (verdict !== gateVerdictRef.current) {
              gateVerdictRef.current = verdict;
              setGateVerdict(verdict);
            }
            if (verdict === 'below-ambient' || verdict === 'not-breath-shaped') {
              detectionRms = 0;
            }
          } else if (gateVerdictRef.current !== 'no-profile') {
            gateVerdictRef.current = 'no-profile';
            setGateVerdict('no-profile');
          }

          // Peak amplitude (max absolute value in recent window)
          let peak = 0;
          for (let i = 0; i < recentSamples.length; i++) {
            const abs = Math.abs(recentSamples[i]) * gainRef.current;
            if (abs > peak) peak = abs;
          }

          // Silence detection
          // Silence is measured from a wall-clock timestamp rather than
          // accumulated per frame. Per-frame accumulation assumed 60fps, so on
          // a 30Hz display -- or a throttled/background tab, where rAF drops to
          // a few frames per second -- the 30s apnea alarm took two to three
          // times longer than MAX_SILENCE_DURATION to fire. A timestamp is
          // exact regardless of frame rate.
          if (detectionRms < THRESHOLD) {
            if (silenceStartRef.current === null) silenceStartRef.current = now;
            silenceDurationRef.current = (now - silenceStartRef.current) / 1000;
          } else {
            silenceStartRef.current = null;
            silenceDurationRef.current = 0;
            if (isAlarmRef.current) {
              isAlarmRef.current = false;
              setIsAlarm(false);
            }
          }

          // Trigger alarm
          if (
            silenceDurationRef.current > MAX_SILENCE_DURATION &&
            !isAlarmRef.current
          ) {
            isAlarmRef.current = true;
            setIsAlarm(true);
          }

          // Update React state (throttled to ~20fps for performance)
          setCurrentAmplitude(rms);
          setPeakAmplitude(peak);
          setElapsedTime(elapsed);
          setSilenceDuration(silenceDurationRef.current);
          setWaveformData(new Float32Array(buffer));

          animFrameRef.current = requestAnimationFrame(updateLoop);
        };

        animFrameRef.current = requestAnimationFrame(updateLoop);
      } catch (err) {
        console.error('Failed to start audio engine:', err);
        throw err;
      }
    },
    [refreshDevices]
  );

  // -- Stop monitoring --
  const stop = useCallback(() => {
    isRunningRef.current = false;
    cancelAnimationFrame(animFrameRef.current);

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.disconnect();
      recorderRef.current.onaudioprocess = null;
      recorderRef.current = null;
    }
    if (filterRef.current) {
      filterRef.current.disconnect();
      filterRef.current = null;
    }
    calibrationAbortRef.current = true;
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (rawAnalyserRef.current) {
      rawAnalyserRef.current.disconnect();
      rawAnalyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    isRecordingRef.current = false;
    setIsRunning(false);
    setIsRecording(false);
    setIsAlarm(false);
    isAlarmRef.current = false;
    if (recordedChunksRef.current.length > 0) {
      setHasRecordedData(true);
    }
  }, []);

  // -- Toggle recording --
  const toggleRecording = useCallback(() => {
    if (!isRecordingRef.current) {
      // Starting a new recording -- clear previous chunks
      recordedChunksRef.current = [];
      setHasRecordedData(false);
      isRecordingRef.current = true;
      setIsRecording(true);
    } else {
      // Stopping recording
      isRecordingRef.current = false;
      setIsRecording(false);
      setHasRecordedData(recordedChunksRef.current.length > 0);
    }
  }, []);

  // -- Export recorded audio as WAV --
  const exportWAV = useCallback(() => {
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) {
      console.warn('No recorded data to export');
      return null;
    }

    // Calculate total length
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }

    // Merge chunks
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Encode WAV
    const wavBuffer = encodeWAV(merged, SAMPLE_RATE);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `recorded_audio_${timestamp}.wav`;
    a.click();
    URL.revokeObjectURL(url);

    return blob;
  }, []);

  // -- Switch audio input device --
  const switchDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (isRunningRef.current) {
        // Restart with new device
        stop();
        // Small delay to ensure cleanup
        setTimeout(() => start(deviceId), 100);
      }
    },
    [start, stop]
  );

  // -- Breath calibration --
  //
  // Averages the FFT magnitude spectrum over two phases (room, then patient)
  // and hands both to pickBreathBand. Runs off the analyser, which sits behind
  // the filter -- so the filter is forced flat for the duration, otherwise each
  // calibration would be measuring the previous one's passband.
  const calibrate = useCallback(async () => {
    if (!isRunningRef.current || !analyserRef.current || !audioContextRef.current) {
      setCalibrationError('Start monitoring before calibrating.');
      return null;
    }

    const analyser = analyserRef.current;
    const ctx = audioContextRef.current;
    const filter = filterRef.current;

    const wasEnabled = filterEnabledRef.current;
    filterEnabledRef.current = false;
    applyBandToFilter(filter);

    calibrationAbortRef.current = false;
    setCalibrationError(null);

    const bins = analyser.frequencyBinCount;
    const binHz = ctx.sampleRate / analyser.fftSize;
    const frame = new Float32Array(bins);

    /** Averages dB spectra over `seconds`, reporting 0..1 progress. */
    const collect = (seconds: number, onProgress: (fraction: number) => void) =>
      new Promise<Float32Array | null>((resolve) => {
        const sum = new Float64Array(bins);
        let frames = 0;
        const started = performance.now();

        const tick = () => {
          if (calibrationAbortRef.current || !isRunningRef.current) {
            resolve(null);
            return;
          }
          analyser.getFloatFrequencyData(frame);
          for (let i = 0; i < bins; i++) {
            // Silent bins report -Infinity; floor them so the average stays finite.
            sum[i] += Number.isFinite(frame[i]) ? frame[i] : -140;
          }
          frames++;

          const elapsed = (performance.now() - started) / 1000;
          onProgress(Math.min(elapsed / seconds, 1));

          if (elapsed >= seconds) {
            const avg = new Float32Array(bins);
            for (let i = 0; i < bins; i++) avg[i] = sum[i] / Math.max(frames, 1);
            resolve(avg);
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      });

    try {
      setCalibrationPhase('ambient');
      setCalibrationProgress(0);
      const ambient = await collect(CALIBRATION_AMBIENT_SECONDS, setCalibrationProgress);
      if (!ambient) return null;

      setCalibrationPhase('breathing');
      setCalibrationProgress(0);
      const breathing = await collect(CALIBRATION_BREATH_SECONDS, setCalibrationProgress);
      if (!breathing) return null;

      setCalibrationPhase('analyzing');
      const picked = pickBreathBand(ambient, breathing, binHz);

      if (!picked) {
        setCalibrationError(
          'Breathing never rose clearly above the room noise. Move the mic closer and try again.'
        );
        filterEnabledRef.current = wasEnabled;
        applyBandToFilter(filter);
        return null;
      }

      setBand(picked);
      setFilterEnabled(true);
      return picked;
    } finally {
      setCalibrationPhase('idle');
      setCalibrationProgress(0);
      // setBand/setFilterEnabled already re-applied the filter on success; this
      // covers the aborted paths.
      applyBandToFilter(filterRef.current);
    }
  }, [applyBandToFilter, setBand, setFilterEnabled]);

  const cancelCalibration = useCallback(() => {
    calibrationAbortRef.current = true;
  }, []);

  const clearCalibration = useCallback(() => {
    setBand(null);
    setFilterEnabled(false);
    setCalibrationError(null);
  }, [setBand, setFilterEnabled]);

  // -- Dismiss alarm --
  const dismissAlarm = useCallback(() => {
    isAlarmRef.current = false;
    // Restart the clock, not just the counter: leaving the old timestamp in
    // place would re-trip the alarm on the very next frame.
    silenceStartRef.current = null;
    silenceDurationRef.current = 0;
    setIsAlarm(false);
    setSilenceDuration(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRunningRef.current) {
        stop();
      }
    };
  }, [stop]);

  return {
    // State
    isRunning,
    isRecording,
    isAlarm,
    silenceDuration,
    currentAmplitude,
    peakAmplitude,
    elapsedTime,
    devices,
    selectedDeviceId,
    waveformData,
    hasRecordedData,
    // Actions
    start,
    stop,
    toggleRecording,
    exportWAV,
    switchDevice,
    dismissAlarm,
    refreshDevices,
    // Breath calibration
    band,
    gateVerdict,
    filterEnabled,
    setFilterEnabled,
    calibrate,
    cancelCalibration,
    clearCalibration,
    calibrationPhase,
    calibrationProgress,
    calibrationError,
    // Sensitivity
    gain,
    setGain,
    GAIN_MIN,
    GAIN_MAX,
    GAIN_SLIDER_MAX,
    // Constants (exposed for UI display)
    GAIN,
    THRESHOLD,
    MAX_SILENCE_DURATION,
    WINDOW_DURATION,
    BUFFER_LENGTH,
  };
}

/**
 * Encode raw Float32 PCM samples into a WAV file ArrayBuffer.
 * Standard RIFF/WAVE format with 16-bit PCM encoding.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
