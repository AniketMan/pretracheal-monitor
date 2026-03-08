/**
 * AlarmOverlay - HIG-compliant critical alert overlay.
 *
 * HIG Feedback: "Critical alerts should be interruptive and require acknowledgment."
 * HIG Accessibility: "Complement audio cues with haptic feedback."
 *
 * Uses Web Audio API for alarm tone (works even in silent mode per HIG audio rules).
 * Triggers navigator.vibrate for haptic feedback on supported devices.
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

  osc.type = 'sine'; // Sine wave is less harsh than square
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);

  const now = audioCtx.currentTime;
  const beepOn = 0.12;
  const beepOff = 0.08;
  const cycle = beepOn + beepOff;
  const duration = 1.5;
  const repeats = Math.floor(duration / cycle);

  gainNode.gain.setValueAtTime(0, now);
  for (let i = 0; i < repeats; i++) {
    const start = now + i * cycle;
    gainNode.gain.linearRampToValueAtTime(0.25, start + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, start + beepOn);
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

      // Haptic feedback (HIG: complement audio with haptics)
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }

      intervalRef.current = setInterval(() => {
        if (alarmCtxRef.current && alarmCtxRef.current.state !== 'closed') {
          createAlarmBeep(alarmCtxRef.current);
          if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
          }
        }
      }, 2500);
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
    if ('vibrate' in navigator) {
      navigator.vibrate(0); // Cancel vibration
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
      role="alertdialog"
      aria-label={`Warning: No sound detected for ${Math.floor(silenceDuration)} seconds. Tap to dismiss.`}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center cursor-pointer"
      style={{
        background: 'rgba(255, 59, 48, 0.08)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {/* HIG: Critical alert card with Liquid Glass material */}
      <div
        className="mx-6 px-8 py-6 text-center ios-rounded-lg max-w-sm w-full"
        style={{
          background: 'rgba(255, 59, 48, 0.12)',
          backdropFilter: 'blur(40px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
          border: '0.5px solid rgba(255, 59, 48, 0.3)',
        }}
      >
        {/* SF Symbol-style warning icon */}
        <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center alarm-pulse"
          style={{ background: 'rgba(255, 59, 48, 0.2)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#ff453a]">
            <path d="M12 2L2 20h20L12 2z" fill="currentColor" opacity="0.2" />
            <path d="M12 4.5L3.5 19h17L12 4.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
            <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1" fill="currentColor" />
          </svg>
        </div>

        <p className="type-headline text-[#ff453a]">
          No Sound Detected
        </p>
        <p className="type-subhead mt-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Silent for {Math.floor(silenceDuration)}s
        </p>
        <p className="type-caption1 mt-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Tap anywhere to dismiss
        </p>
      </div>
    </div>
  );
}
