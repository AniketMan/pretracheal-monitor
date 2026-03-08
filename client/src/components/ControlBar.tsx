/**
 * ControlBar - Bottom control strip for the monitor.
 *
 * Design: Clinical Instrument Panel
 *   - Large touch-friendly buttons for mobile/tablet use
 *   - Device selector dropdown for iOS 26 input switching
 *   - 3D-style buttons with long shadows (per user brand preference)
 *   - Color-coded actions: green=start, red=stop, amber=record, cyan=export
 */

import { Play, Square, Circle, Download, Settings, Mic } from 'lucide-react';
import type { AudioDevice } from '@/hooks/useAudioEngine';

interface ControlBarProps {
  isRunning: boolean;
  isRecording: boolean;
  devices: AudioDevice[];
  selectedDeviceId: string | null;
  onStart: () => void;
  onStop: () => void;
  onToggleRecording: () => void;
  onExport: () => void;
  onDeviceChange: (deviceId: string) => void;
  showSettings: boolean;
  onToggleSettings: () => void;
}

export default function ControlBar({
  isRunning,
  isRecording,
  devices,
  selectedDeviceId,
  onStart,
  onStop,
  onToggleRecording,
  onExport,
  onDeviceChange,
  showSettings,
  onToggleSettings,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--color-monitor-border)] bg-[var(--color-monitor-panel)]">
      {/* Left: Main controls */}
      <div className="flex items-center gap-2">
        {/* Start / Stop */}
        {!isRunning ? (
          <button
            onClick={onStart}
            className="
              flex items-center gap-2 px-4 py-2 rounded-md
              bg-[var(--color-monitor-green)] text-[var(--color-monitor-bg)]
              font-semibold text-sm
              shadow-[0_4px_12px_rgba(0,230,118,0.3),0_2px_4px_rgba(0,0,0,0.4)]
              hover:shadow-[0_6px_20px_rgba(0,230,118,0.4),0_3px_6px_rgba(0,0,0,0.5)]
              active:translate-y-[1px] active:shadow-[0_2px_6px_rgba(0,230,118,0.2)]
              transition-all duration-150
            "
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Start</span>
          </button>
        ) : (
          <button
            onClick={onStop}
            className="
              flex items-center gap-2 px-4 py-2 rounded-md
              bg-red-600 text-white
              font-semibold text-sm
              shadow-[0_4px_12px_rgba(255,23,68,0.3),0_2px_4px_rgba(0,0,0,0.4)]
              hover:shadow-[0_6px_20px_rgba(255,23,68,0.4),0_3px_6px_rgba(0,0,0,0.5)]
              active:translate-y-[1px] active:shadow-[0_2px_6px_rgba(255,23,68,0.2)]
              transition-all duration-150
            "
          >
            <Square className="w-4 h-4 fill-current" />
            <span>Stop</span>
          </button>
        )}

        {/* Record toggle */}
        <button
          onClick={onToggleRecording}
          disabled={!isRunning}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-md
            font-medium text-sm transition-all duration-150
            disabled:opacity-30 disabled:cursor-not-allowed
            ${
              isRecording
                ? 'bg-red-600/20 text-red-400 border border-red-500/40 shadow-[0_0_12px_rgba(255,23,68,0.2)]'
                : 'bg-[var(--color-monitor-bg)] text-[var(--color-monitor-text-dim)] border border-[var(--color-monitor-border)] hover:border-[var(--color-monitor-amber)] hover:text-[var(--color-monitor-amber)]'
            }
          `}
        >
          <Circle
            className={`w-3.5 h-3.5 ${isRecording ? 'fill-red-500 text-red-500 rec-blink' : ''}`}
          />
          <span>{isRecording ? 'Stop Rec' : 'Record'}</span>
        </button>

        {/* Export WAV */}
        <button
          onClick={onExport}
          disabled={!isRecording && !isRunning}
          className="
            flex items-center gap-2 px-3 py-2 rounded-md
            bg-[var(--color-monitor-bg)] text-[var(--color-monitor-cyan)]
            border border-[var(--color-monitor-border)]
            font-medium text-sm
            hover:border-[var(--color-monitor-cyan)] hover:shadow-[0_0_8px_rgba(6,182,212,0.15)]
            active:translate-y-[1px]
            transition-all duration-150
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export WAV</span>
        </button>
      </div>

      {/* Center: Device selector */}
      <div className="flex items-center gap-2">
        <Mic className="w-3.5 h-3.5 text-[var(--color-monitor-text-dim)]" />
        <select
          value={selectedDeviceId || ''}
          onChange={(e) => onDeviceChange(e.target.value)}
          className="
            bg-[var(--color-monitor-bg)] text-[var(--color-monitor-text)] text-xs
            border border-[var(--color-monitor-border)] rounded-md
            px-2 py-1.5 font-data
            focus:border-[var(--color-monitor-green)] focus:outline-none
            max-w-[200px] truncate
          "
        >
          {devices.length === 0 && (
            <option value="">No devices found</option>
          )}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Right: Settings toggle */}
      <button
        onClick={onToggleSettings}
        className={`
          p-2 rounded-md transition-all duration-150
          ${
            showSettings
              ? 'bg-[var(--color-monitor-green)]/10 text-[var(--color-monitor-green)] border border-[var(--color-monitor-green)]/30'
              : 'text-[var(--color-monitor-text-dim)] hover:text-[var(--color-monitor-text)] border border-transparent'
          }
        `}
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}
