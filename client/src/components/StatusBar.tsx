/**
 * StatusBar - Top status strip for the monitor.
 *
 * Design: Clinical Instrument Panel
 *   - Horizontal strip with key status indicators
 *   - Monospaced data values for alignment
 *   - Color-coded status badges (green=active, red=alarm, amber=recording)
 *   - Clock display matching the original Python script
 */

import { Mic, MicOff, Circle } from 'lucide-react';

interface StatusBarProps {
  isRunning: boolean;
  isRecording: boolean;
  isAlarm: boolean;
  elapsedTime: number;
  currentAmplitude: number;
  peakAmplitude: number;
  silenceDuration: number;
  maxSilenceDuration: number;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatClock(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

export default function StatusBar({
  isRunning,
  isRecording,
  isAlarm,
  elapsedTime,
  currentAmplitude,
  peakAmplitude,
  silenceDuration,
  maxSilenceDuration,
}: StatusBarProps) {
  return (
    <div
      className={`
        flex items-center justify-between px-3 py-2 border-b
        transition-colors duration-300
        ${isAlarm ? 'border-red-500/40 bg-red-950/30' : 'border-[var(--color-monitor-border)] bg-[var(--color-monitor-panel)]'}
      `}
    >
      {/* Left: Connection status + elapsed */}
      <div className="flex items-center gap-4">
        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <>
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-[var(--color-monitor-green)]" />
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-[var(--color-monitor-green)] live-pulse" />
              </div>
              <span className="font-data text-xs text-[var(--color-monitor-green)] glow-green">
                LIVE
              </span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-[var(--color-monitor-text-dim)]" />
              <span className="font-data text-xs text-[var(--color-monitor-text-dim)]">
                IDLE
              </span>
            </>
          )}
        </div>

        {/* Mic icon */}
        <div className="flex items-center gap-1">
          {isRunning ? (
            <Mic className="w-3.5 h-3.5 text-[var(--color-monitor-green)]" />
          ) : (
            <MicOff className="w-3.5 h-3.5 text-[var(--color-monitor-text-dim)]" />
          )}
        </div>

        {/* Recording indicator */}
        {isRecording && (
          <div className="flex items-center gap-1.5">
            <Circle className="w-2.5 h-2.5 fill-red-500 text-red-500 rec-blink" />
            <span className="font-data text-xs text-red-400">REC</span>
          </div>
        )}

        {/* Elapsed time */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
            Elapsed
          </span>
          <span className="font-data text-xs text-[var(--color-monitor-text)]">
            {formatTime(elapsedTime)}
          </span>
        </div>
      </div>

      {/* Center: Amplitude readout */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
            Amp
          </span>
          <span
            className={`font-data text-sm font-semibold ${
              isAlarm
                ? 'text-red-400 glow-red'
                : currentAmplitude > 1
                  ? 'text-[var(--color-monitor-green)] glow-green'
                  : 'text-[var(--color-monitor-text-dim)]'
            }`}
          >
            {currentAmplitude.toFixed(1)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
            Peak
          </span>
          <span className="font-data text-xs text-[var(--color-monitor-text)]">
            {peakAmplitude.toFixed(1)}
          </span>
        </div>

        {/* Silence counter */}
        {silenceDuration > 2 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-monitor-amber)] uppercase tracking-wider">
              Silence
            </span>
            <span
              className={`font-data text-xs font-semibold ${
                silenceDuration > maxSilenceDuration * 0.7
                  ? 'text-red-400 glow-red'
                  : 'text-[var(--color-monitor-amber)]'
              }`}
            >
              {silenceDuration.toFixed(0)}s / {maxSilenceDuration}s
            </span>
          </div>
        )}
      </div>

      {/* Right: Clock */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
          Time
        </span>
        <span className="font-data text-sm text-[var(--color-monitor-text)]">
          {formatClock()}
        </span>
      </div>
    </div>
  );
}
