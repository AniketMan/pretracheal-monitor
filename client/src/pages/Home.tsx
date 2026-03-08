/**
 * Home - HIG-compliant monitor page.
 *
 * Layout (per Apple HIG):
 *   - Edge-to-edge chart (Layout: "extend backgrounds to edges")
 *   - Controls at bottom (Designing for iOS: "one-handed reach")
 *   - Liquid Glass control bar (Materials: "controls use Liquid Glass")
 *   - 44pt minimum touch targets (Accessibility: "default tappable area")
 *   - Safe area insets (Layout: "always respect safe areas")
 *   - Status integrated into UI (Feedback: "integrate status directly")
 *
 * Typography: HIG type scale (SF Pro system font)
 * Colors: iOS semantic system colors
 */

import { useState, useCallback, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { useTheme } from '@/contexts/ThemeContext';
import WaveformCanvas from '@/components/WaveformCanvas';
import AlarmOverlay from '@/components/AlarmOverlay';
import {
  Play,
  Square,
  Circle,
  Download,
  Mic,
  Maximize,
  Minimize,
  Sun,
  Moon,
} from 'lucide-react';

export default function Home() {
  const engine = useAudioEngine();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [gain] = useState(engine.GAIN);
  const [showDevices, setShowDevices] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Register service worker for offline capability
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const base = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker.register(`${base}sw.js`).catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }
  }, []);

  // Clock tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen toggle (HIG: Going Full Screen)
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleStart = useCallback(async () => {
    try {
      await engine.start(engine.selectedDeviceId || undefined);
    } catch (err) {
      console.error('Failed to start:', err);
      alert('Microphone access is required. Please allow microphone permissions and try again.');
    }
  }, [engine]);

  // Format elapsed time as MM:SS
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden bg-background text-foreground">

      {/* Header bar - minimal, HIG Headline weight */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2">
          <h1 className="type-headline text-foreground">
            Pretracheal Monitor
          </h1>
          {engine.isRunning && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#32d74b] live-pulse" />
              <span className="type-caption2 text-muted-foreground">LIVE</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Theme toggle (HIG: Dark Mode support) */}
          <button
            onClick={toggleTheme}
            className="w-[44px] h-[44px] flex items-center justify-center rounded-full active:bg-accent transition-colors"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="w-5 h-5 text-muted-foreground" /> : <Moon className="w-5 h-5 text-muted-foreground" />}
          </button>

          {/* Fullscreen toggle (HIG: Going Full Screen) */}
          <button
            onClick={toggleFullscreen}
            className="w-[44px] h-[44px] flex items-center justify-center rounded-full active:bg-accent transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen
              ? <Minimize className="w-5 h-5 text-muted-foreground" />
              : <Maximize className="w-5 h-5 text-muted-foreground" />
            }
          </button>
        </div>
      </div>

      {/* Chart area - edge-to-edge, takes all remaining space */}
      <div className="flex-1 px-2 pb-1 min-h-0">
        <WaveformCanvas
          waveformData={engine.waveformData}
          gain={gain}
          isAlarm={engine.isAlarm}
          elapsedTime={engine.elapsedTime}
          windowDuration={engine.WINDOW_DURATION}
          isDark={isDark}
        />
      </div>

      {/* Status strip - only when running (HIG: integrate status into UI) */}
      {engine.isRunning && (
        <div className="flex items-center justify-center gap-4 px-4 py-1.5 shrink-0">
          <span className="font-data type-caption1 text-muted-foreground">
            {formatTime(engine.elapsedTime)}
          </span>
          <span className="font-data type-caption1 text-muted-foreground">
            Amp: {engine.currentAmplitude.toFixed(1)}
          </span>
          {engine.silenceDuration > 2 && (
            <span className={`font-data type-caption1 font-semibold ${
              engine.silenceDuration > 20 ? 'text-destructive' : 'text-[#ff9f0a]'
            }`}>
              Silent: {engine.silenceDuration.toFixed(0)}s
            </span>
          )}
          {engine.isRecording && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive rec-blink" />
              <span className="type-caption1 font-semibold text-destructive">REC</span>
            </span>
          )}
        </div>
      )}

      {/* Control bar - Liquid Glass material (HIG: Materials) */}
      <div
        className="liquid-glass shrink-0 px-3 py-2"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center gap-2">
          {/* Start/Stop - primary action (HIG: prominent placement) */}
          {!engine.isRunning ? (
            <button
              onClick={handleStart}
              className="flex items-center justify-center gap-1.5 px-5 min-h-[44px] ios-rounded font-semibold type-subhead text-white transition-all active:scale-95"
              style={{ background: '#32d74b' }}
              aria-label="Start monitoring"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start</span>
            </button>
          ) : (
            <button
              onClick={engine.stop}
              className="flex items-center justify-center gap-1.5 px-5 min-h-[44px] ios-rounded font-semibold type-subhead text-white transition-all active:scale-95"
              style={{ background: '#ff453a' }}
              aria-label="Stop monitoring"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          )}

          {/* Record toggle */}
          <button
            onClick={engine.toggleRecording}
            disabled={!engine.isRunning}
            className={`flex items-center justify-center gap-1.5 px-4 min-h-[44px] ios-rounded type-subhead transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
              engine.isRecording
                ? 'bg-destructive/15 text-destructive font-semibold'
                : 'bg-secondary text-secondary-foreground'
            }`}
            aria-label={engine.isRecording ? 'Stop recording' : 'Start recording'}
          >
            <Circle className={`w-3 h-3 ${engine.isRecording ? 'fill-destructive text-destructive' : ''}`} />
            <span className="hidden sm:inline">{engine.isRecording ? 'Stop Rec' : 'Record'}</span>
            <span className="sm:hidden">{engine.isRecording ? 'Stop' : 'Rec'}</span>
          </button>

          {/* Export WAV */}
          <button
            onClick={engine.exportWAV}
            disabled={!engine.isRecording && !engine.isRunning}
            className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] ios-rounded bg-secondary text-secondary-foreground type-subhead transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Export recording as WAV file"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Device selector (HIG: 44pt touch target) */}
          <div className="relative">
            <button
              onClick={() => setShowDevices(!showDevices)}
              className="w-[44px] h-[44px] flex items-center justify-center ios-rounded bg-secondary active:bg-accent transition-colors sm:hidden"
              aria-label="Select audio input device"
            >
              <Mic className="w-4.5 h-4.5 text-secondary-foreground" />
            </button>

            {/* Mobile device picker popup */}
            {showDevices && (
              <div
                className="sm:hidden absolute bottom-full right-0 mb-2 ios-rounded-lg p-3 z-50 min-w-[240px] shadow-lg"
                style={{
                  background: isDark ? 'rgba(44,44,46,0.95)' : 'rgba(255,255,255,0.95)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                }}
              >
                <p className="type-caption1 text-muted-foreground mb-2 px-1">Input Device</p>
                {engine.devices.map((d) => (
                  <button
                    key={d.deviceId}
                    onClick={() => {
                      engine.switchDevice(d.deviceId);
                      setShowDevices(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 ios-rounded type-subhead transition-colors ${
                      d.deviceId === engine.selectedDeviceId
                        ? 'bg-primary/15 text-primary'
                        : 'text-foreground active:bg-accent'
                    }`}
                  >
                    {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                  </button>
                ))}
                {engine.devices.length === 0 && (
                  <p className="px-3 py-2 type-subhead text-muted-foreground">No devices found</p>
                )}
              </div>
            )}

            {/* Desktop: inline dropdown */}
            <div className="hidden sm:flex items-center gap-2">
              <Mic className="w-4 h-4 text-muted-foreground" />
              <select
                value={engine.selectedDeviceId || ''}
                onChange={(e) => engine.switchDevice(e.target.value)}
                className="bg-secondary text-secondary-foreground type-caption1 ios-rounded px-3 py-2 max-w-[200px] truncate border-none outline-none"
                aria-label="Select audio input device"
              >
                {engine.devices.length === 0 && <option value="">No devices</option>}
                {engine.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Alarm overlay */}
      <AlarmOverlay
        isAlarm={engine.isAlarm}
        silenceDuration={engine.silenceDuration}
        onDismiss={engine.dismissAlarm}
      />

      {/* Close device picker on outside tap */}
      {showDevices && (
        <div
          className="fixed inset-0 z-40 sm:hidden"
          onClick={() => setShowDevices(false)}
        />
      )}
    </div>
  );
}
