/**
 * SettingsPanel - Slide-in panel for tuning monitor parameters.
 *
 * Design: Clinical Instrument Panel
 *   - Dark panel sliding from the right
 *   - Monospaced value readouts
 *   - Minimal controls: sliders for gain, threshold, silence duration
 */

import { X } from 'lucide-react';

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  gain: number;
  threshold: number;
  maxSilenceDuration: number;
  onGainChange: (v: number) => void;
  onThresholdChange: (v: number) => void;
  onSilenceDurationChange: (v: number) => void;
}

export default function SettingsPanel({
  visible,
  onClose,
  gain,
  threshold,
  maxSilenceDuration,
  onGainChange,
  onThresholdChange,
  onSilenceDurationChange,
}: SettingsPanelProps) {
  if (!visible) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-[var(--color-monitor-panel)] border-l border-[var(--color-monitor-border)] z-50 flex flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-monitor-border)]">
        <span className="font-data text-sm text-[var(--color-monitor-text)] tracking-wide">
          SETTINGS
        </span>
        <button
          onClick={onClose}
          className="p-1 text-[var(--color-monitor-text-dim)] hover:text-[var(--color-monitor-text)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Settings list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Gain */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
              Display Gain
            </label>
            <span className="font-data text-sm text-[var(--color-monitor-green)]">
              {gain}x
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="200"
            step="1"
            value={gain}
            onChange={(e) => onGainChange(Number(e.target.value))}
            className="w-full h-1.5 bg-[var(--color-monitor-bg)] rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-monitor-green)]
              [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,230,118,0.4)]"
          />
          <p className="text-[10px] text-[var(--color-monitor-text-dim)]">
            Amplification multiplier for waveform display. Higher values make quiet sounds more visible.
          </p>
        </div>

        {/* Threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
              Silence Threshold
            </label>
            <span className="font-data text-sm text-[var(--color-monitor-cyan)]">
              {threshold.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={threshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
            className="w-full h-1.5 bg-[var(--color-monitor-bg)] rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-monitor-cyan)]
              [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(6,182,212,0.4)]"
          />
          <p className="text-[10px] text-[var(--color-monitor-text-dim)]">
            Amplitude below which audio is considered silent. Increase to ignore background noise.
          </p>
        </div>

        {/* Max silence duration */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
              Alarm Delay
            </label>
            <span className="font-data text-sm text-[var(--color-monitor-amber)]">
              {maxSilenceDuration}s
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="120"
            step="5"
            value={maxSilenceDuration}
            onChange={(e) => onSilenceDurationChange(Number(e.target.value))}
            className="w-full h-1.5 bg-[var(--color-monitor-bg)] rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-monitor-amber)]
              [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(245,158,11,0.4)]"
          />
          <p className="text-[10px] text-[var(--color-monitor-text-dim)]">
            Seconds of continuous silence before the warning alarm activates.
          </p>
        </div>

        {/* Info section */}
        <div className="pt-4 border-t border-[var(--color-monitor-border)] space-y-3">
          <h3 className="text-xs text-[var(--color-monitor-text-dim)] uppercase tracking-wider">
            About
          </h3>
          <p className="text-[11px] text-[var(--color-monitor-text-dim)] leading-relaxed">
            Pretracheal Air Flow Monitor - USC Anesthesiology Scholarly Project.
            Monitors pretracheal air flow via microphone input with real-time
            waveform display and configurable silence alarm.
          </p>
          <p className="text-[11px] text-[var(--color-monitor-text-dim)] leading-relaxed">
            Works offline as a Progressive Web App. On iOS 26+, use the system
            audio input switcher to select your USB-C microphone.
          </p>
          <div className="text-[10px] text-[var(--color-monitor-text-dim)] space-y-1">
            <p>Phillip Zhang, MD</p>
            <p>Mark Bui, MD</p>
            <p>Jim Nguyen, MD</p>
          </div>
        </div>
      </div>
    </div>
  );
}
