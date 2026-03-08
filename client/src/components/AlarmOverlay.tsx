/**
 * AlarmOverlay - Simple alarm overlay matching Figure 5 from the PDF.
 *
 * Plays an audible alarm tone using Web Audio API (no external files).
 * Tap/click to dismiss.
 */

import { useEffect, useRef, useCallback } from 'react';

interface AlarmOverlayProps {
  isAlarm: boolean;
  silenceDuration: number;
  onDismiss: () => void;
}

function createAlarmBeep(audioCtx: AudioContext): OscillatorNode {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);

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

  const playAlarm = useCallback(() => {
    try {
      const ctx = new AudioContext();
      alarmCtxRef.current = ctx;
      createAlarmBeep(ctx);
      intervalRef.current = setInterval(() => {
        if (alarmCtxRef.current && alarmCtxRef.current.state !== 'closed') {
          createAlarmBeep(alarmCtxRef.current);
        }
      }, 3000);
    } catch (err) {
      console.error('Failed to play alarm:', err);
    }
  }, []);

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
      className="absolute inset-0 z-40 flex items-center justify-center cursor-pointer"
      style={{ background: 'rgba(255, 50, 50, 0.25)' }}
    >
      <div className="bg-white border-2 border-black px-8 py-5 text-center shadow-lg">
        <p className="text-lg font-bold text-black">
          WARNING: NO SOUND DETECTED
        </p>
        <p className="text-sm text-gray-600 mt-2">
          No audio for {silenceDuration.toFixed(0)} seconds
        </p>
        <p className="text-xs text-gray-400 mt-3">
          Tap to dismiss
        </p>
      </div>
    </div>
  );
}
