/**
 * AlarmOverlay - Full-screen alarm overlay when silence exceeds threshold.
 *
 * Design: Clinical Instrument Panel
 *   - Slow red pulse (not strobing - clinical environments avoid seizure triggers)
 *   - Large centered warning text visible from across the room
 *   - Tap/click anywhere to dismiss
 *   - Plays an audible alarm tone using Web Audio API (no external files needed)
 */

import { useEffect, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

interface AlarmOverlayProps {
  isAlarm: boolean;
  silenceDuration: number;
  onDismiss: () => void;
}

/**
 * Generate an alarm beep pattern using Web Audio API.
 * Creates a repeating 880Hz tone pattern (0.15s on, 0.1s off).
 * No external audio files needed - works fully offline.
 */
function createAlarmOscillator(audioCtx: AudioContext): OscillatorNode {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);

  // Create beep pattern via gain modulation
  const now = audioCtx.currentTime;
  const beepOn = 0.15;
  const beepOff = 0.1;
  const cycle = beepOn + beepOff;
  const duration = 2.0;
  const repeats = Math.floor(duration / cycle);

  gainNode.gain.setValueAtTime(0, now);
  for (let i = 0; i < repeats; i++) {
    const start = now + i * cycle;
    gainNode.gain.setValueAtTime(0.3, start);
    gainNode.gain.setValueAtTime(0, start + beepOn);
  }

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);

  return osc;
}

export default function AlarmOverlay({
  isAlarm,
  silenceDuration,
  onDismiss,
}: AlarmOverlayProps) {
  const alarmCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Play alarm sound when alarm activates
  const playAlarm = useCallback(() => {
    try {
      const ctx = new AudioContext();
      alarmCtxRef.current = ctx;
      createAlarmOscillator(ctx);

      // Repeat every 3 seconds
      intervalRef.current = setInterval(() => {
        if (alarmCtxRef.current && alarmCtxRef.current.state !== 'closed') {
          createAlarmOscillator(alarmCtxRef.current);
        }
      }, 3000);
    } catch (err) {
      console.error('Failed to play alarm:', err);
    }
  }, []);

  // Stop alarm sound
  const stopAlarm = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (alarmCtxRef.current) {
      alarmCtxRef.current.close();
      alarmCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isAlarm) {
      playAlarm();
    } else {
      stopAlarm();
    }
    return () => stopAlarm();
  }, [isAlarm, playAlarm, stopAlarm]);

  if (!isAlarm) return null;

  return (
    <div
      onClick={onDismiss}
      className="absolute inset-0 z-40 flex items-center justify-center cursor-pointer alarm-pulse"
      style={{
        background: 'rgba(74, 10, 10, 0.6)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-[var(--color-monitor-bg)]/90 border-2 border-red-500/50 shadow-[0_0_60px_rgba(255,23,68,0.3)] max-w-md mx-4">
        <AlertTriangle className="w-12 h-12 text-red-500" />
        <h2 className="font-data text-xl md:text-2xl font-bold text-red-400 glow-red text-center tracking-wide">
          WARNING: NO SOUND DETECTED
        </h2>
        <p className="font-data text-sm text-red-300/80 text-center">
          No audio detected for {silenceDuration.toFixed(0)} seconds
        </p>
        <p className="text-xs text-[var(--color-monitor-text-dim)] mt-2">
          Tap anywhere to dismiss
        </p>
      </div>
    </div>
  );
}
