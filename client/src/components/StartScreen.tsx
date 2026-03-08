/**
 * StartScreen - Initial landing screen before microphone access.
 *
 * Design: Clinical Instrument Panel
 *   - Clean dark screen with project title and start button
 *   - User gesture required to start AudioContext (iOS requirement)
 *   - Brief instructions for setup
 */

import { Activity, Mic, Wifi, WifiOff } from 'lucide-react';

interface StartScreenProps {
  onStart: () => void;
  isOnline: boolean;
}

export default function StartScreen({ onStart, isOnline }: StartScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-monitor-bg)] px-6">
      {/* Logo / Title */}
      <div className="flex items-center gap-3 mb-2">
        <Activity className="w-8 h-8 text-[var(--color-monitor-green)]" />
        <h1 className="font-data text-2xl md:text-3xl font-bold text-[var(--color-monitor-text)] tracking-tight">
          Pretracheal Air Flow Monitor
        </h1>
      </div>

      <p className="text-sm text-[var(--color-monitor-text-dim)] mb-8">
        USC Anesthesiology Scholarly Project
      </p>

      {/* Start button - large touch target */}
      <button
        onClick={onStart}
        className="
          flex items-center gap-3 px-8 py-4 rounded-lg
          bg-[var(--color-monitor-green)] text-[var(--color-monitor-bg)]
          font-semibold text-lg
          shadow-[0_6px_24px_rgba(0,230,118,0.35),0_3px_8px_rgba(0,0,0,0.5)]
          hover:shadow-[0_8px_32px_rgba(0,230,118,0.45),0_4px_12px_rgba(0,0,0,0.6)]
          active:translate-y-[2px] active:shadow-[0_2px_8px_rgba(0,230,118,0.2)]
          transition-all duration-150
        "
      >
        <Mic className="w-5 h-5" />
        <span>Start Monitoring</span>
      </button>

      {/* Instructions */}
      <div className="mt-10 max-w-md space-y-3 text-center">
        <p className="text-xs text-[var(--color-monitor-text-dim)] leading-relaxed">
          Place the stethoscope over the pretracheal area. Connect the lavalier
          microphone via USB-C. Tap Start to begin real-time waveform monitoring.
        </p>
        <p className="text-xs text-[var(--color-monitor-text-dim)] leading-relaxed">
          An audible alarm will sound if no breathing is detected for 30 seconds.
          Adjust sensitivity in Settings.
        </p>
      </div>

      {/* Online/Offline indicator */}
      <div className="mt-8 flex items-center gap-2">
        {isOnline ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-[var(--color-monitor-green)]" />
            <span className="text-[10px] text-[var(--color-monitor-text-dim)]">
              Online - App cached for offline use
            </span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-[var(--color-monitor-amber)]" />
            <span className="text-[10px] text-[var(--color-monitor-amber)]">
              Offline mode
            </span>
          </>
        )}
      </div>

      {/* Credits */}
      <div className="mt-6 text-[10px] text-[var(--color-monitor-text-dim)] text-center space-y-0.5">
        <p>Phillip Zhang, MD | Mark Bui, MD | Jim Nguyen, MD</p>
      </div>
    </div>
  );
}
