/**
 * useAudioEngine - Core audio processing hook for the Pretracheal Air Flow Monitor.
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

// -- Configuration constants --
// These mirror the original Python script parameters
const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const WINDOW_DURATION = 3.0; // seconds of visible waveform
const GAIN = 50; // display amplification
const THRESHOLD = 1; // amplitude below which audio is "silent"
const MAX_SILENCE_DURATION = 30; // seconds before alarm fires (matches PDF spec)
const BUFFER_LENGTH = Math.floor(SAMPLE_RATE * WINDOW_DURATION);

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

  // -- Refs for audio pipeline (not in React state to avoid re-renders) --
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const waveformBufferRef = useRef<Float32Array>(new Float32Array(BUFFER_LENGTH));
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const silenceDurationRef = useRef(0);
  const isAlarmRef = useRef(false);
  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const passThoughRef = useRef(false);

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

          // Record if active
          if (isRecording) {
            recordedChunksRef.current.push(new Float32Array(input));
          }
        };

        source.connect(analyser);
        analyser.connect(processor);
        // Connect processor to destination to keep it alive (required by spec)
        // Output is silence since we copy input but don't modify output
        processor.connect(ctx.destination);

        // Reset state
        waveformBufferRef.current = new Float32Array(BUFFER_LENGTH);
        silenceDurationRef.current = 0;
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
          rms = Math.sqrt(rms / recentSamples.length) * GAIN;

          // Peak amplitude (max absolute value in recent window)
          let peak = 0;
          for (let i = 0; i < recentSamples.length; i++) {
            const abs = Math.abs(recentSamples[i]) * GAIN;
            if (abs > peak) peak = abs;
          }

          // Silence detection
          if (rms < THRESHOLD) {
            silenceDurationRef.current += 1 / 60; // approximate frame time
          } else {
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
    [isRecording, refreshDevices]
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
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsRunning(false);
    setIsAlarm(false);
    isAlarmRef.current = false;
  }, []);

  // -- Toggle recording --
  const toggleRecording = useCallback(() => {
    if (!isRecording) {
      recordedChunksRef.current = [];
    }
    setIsRecording((prev) => !prev);
  }, [isRecording]);

  // -- Export recorded audio as WAV --
  const exportWAV = useCallback(() => {
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return null;

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

  // -- Dismiss alarm --
  const dismissAlarm = useCallback(() => {
    isAlarmRef.current = false;
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
    // Actions
    start,
    stop,
    toggleRecording,
    exportWAV,
    switchDevice,
    dismissAlarm,
    refreshDevices,
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
