/**
 * Home - Main monitor page. Mobile-first responsive layout.
 *
 * Mobile: stacked controls below chart, large touch targets (44px min)
 * Desktop: horizontal control bar
 */

import { useState, useCallback, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import WaveformCanvas from '@/components/WaveformCanvas';
import AlarmOverlay from '@/components/AlarmOverlay';
import { Play, Square, Circle, Download, Mic, Settings } from 'lucide-react';

export default function Home() {
  const engine = useAudioEngine();
  const [gain] = useState(engine.GAIN);
  const [showDevices, setShowDevices] = useState(false);

  // Register service worker for offline capability
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const base = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker.register(`${base}sw.js`).catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }
  }, []);

  // Force re-render for clock updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = useCallback(async () => {
    try {
      await engine.start(engine.selectedDeviceId || undefined);
    } catch (err) {
      console.error('Failed to start:', err);
      alert('Microphone access is required. Please allow microphone permissions and try again.');
    }
  }, [engine]);

  return (
    <div className="h-[100dvh] flex flex-col bg-[#f0f0f0] relative overflow-hidden">
      {/* Title bar - compact on mobile */}
      <div className="flex items-center justify-between px-3 py-1.5 sm:px-4 sm:py-2 bg-white border-b border-gray-300 shrink-0">
        <h1 className="text-xs sm:text-sm font-semibold text-gray-800 truncate">
          Pretracheal Air Flow Monitor
        </h1>
        <span className="text-[10px] sm:text-xs text-gray-500 hidden sm:block">
          USC Anesthesiology
        </span>
      </div>

      {/* Chart area - takes all remaining space */}
      <div className="flex-1 p-1 sm:p-2 min-h-0">
        <WaveformCanvas
          waveformData={engine.waveformData}
          gain={gain}
          isAlarm={engine.isAlarm}
          elapsedTime={engine.elapsedTime}
          windowDuration={engine.WINDOW_DURATION}
        />
      </div>

      {/* Status bar - only when running */}
      {engine.isRunning && (
        <div className="flex items-center justify-center gap-3 sm:gap-4 px-3 py-1 bg-gray-100 border-t border-gray-200 text-[10px] sm:text-xs text-gray-600 shrink-0">
          <span>
            {Math.floor(engine.elapsedTime / 60).toString().padStart(2, '0')}:
            {Math.floor(engine.elapsedTime % 60).toString().padStart(2, '0')}
          </span>
          <span>Amp: {engine.currentAmplitude.toFixed(1)}</span>
          {engine.silenceDuration > 2 && (
            <span className={engine.silenceDuration > 20 ? 'text-red-600 font-bold' : 'text-amber-600'}>
              Silence: {engine.silenceDuration.toFixed(0)}s
            </span>
          )}
          {engine.isRecording && (
            <span className="text-red-600 font-bold animate-pulse">REC</span>
          )}
        </div>
      )}

      {/* Control bar - responsive grid on mobile, flex row on desktop */}
      <div className="bg-white border-t border-gray-300 px-2 py-2 sm:px-4 sm:py-2.5 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Start/Stop - always prominent */}
          {!engine.isRunning ? (
            <button
              onClick={handleStart}
              className="flex items-center justify-center gap-1 px-3 sm:px-4 py-2.5 rounded bg-green-600 text-white text-xs sm:text-sm font-medium active:bg-green-800 transition-colors shadow-sm min-w-[60px] min-h-[44px]"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start</span>
            </button>
          ) : (
            <button
              onClick={engine.stop}
              className="flex items-center justify-center gap-1 px-3 sm:px-4 py-2.5 rounded bg-red-600 text-white text-xs sm:text-sm font-medium active:bg-red-800 transition-colors shadow-sm min-w-[60px] min-h-[44px]"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          )}

          {/* Record */}
          <button
            onClick={engine.toggleRecording}
            disabled={!engine.isRunning}
            className={`flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2.5 rounded text-xs sm:text-sm font-medium transition-colors shadow-sm min-h-[44px] disabled:opacity-30 disabled:cursor-not-allowed ${
              engine.isRecording
                ? 'bg-red-100 text-red-700 border border-red-300'
                : 'bg-gray-100 text-gray-700 border border-gray-300 active:bg-gray-200'
            }`}
          >
            <Circle className={`w-3 h-3 ${engine.isRecording ? 'fill-red-500 text-red-500' : ''}`} />
            <span className="hidden sm:inline">{engine.isRecording ? 'Stop Rec' : 'Record'}</span>
            <span className="sm:hidden">{engine.isRecording ? 'Stop' : 'Rec'}</span>
          </button>

          {/* Export */}
          <button
            onClick={engine.exportWAV}
            disabled={!engine.isRecording && !engine.isRunning}
            className="flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2.5 rounded bg-gray-100 text-gray-700 border border-gray-300 text-xs sm:text-sm font-medium active:bg-gray-200 transition-colors shadow-sm min-h-[44px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export WAV</span>
            <span className="sm:hidden">WAV</span>
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Device selector toggle (mobile: icon only, desktop: dropdown) */}
          <div className="relative">
            {/* Mobile: icon button */}
            <button
              onClick={() => setShowDevices(!showDevices)}
              className="sm:hidden flex items-center justify-center w-[44px] h-[44px] rounded bg-gray-100 border border-gray-300 active:bg-gray-200"
            >
              <Mic className="w-4 h-4 text-gray-600" />
            </button>

            {/* Mobile: dropdown */}
            {showDevices && (
              <div className="sm:hidden absolute bottom-full right-0 mb-1 bg-white border border-gray-300 rounded shadow-lg p-2 z-50 min-w-[200px]">
                <p className="text-[10px] text-gray-500 mb-1 px-1">Input Device</p>
                <select
                  value={engine.selectedDeviceId || ''}
                  onChange={(e) => {
                    engine.switchDevice(e.target.value);
                    setShowDevices(false);
                  }}
                  className="w-full bg-white text-gray-700 text-xs border border-gray-300 rounded px-2 py-2 focus:outline-none focus:border-blue-500"
                >
                  {engine.devices.length === 0 && <option value="">No devices</option>}
                  {engine.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Desktop: inline dropdown */}
            <div className="hidden sm:flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-gray-500" />
              <select
                value={engine.selectedDeviceId || ''}
                onChange={(e) => engine.switchDevice(e.target.value)}
                className="bg-white text-gray-700 text-xs border border-gray-300 rounded px-2 py-1.5 max-w-[180px] truncate focus:outline-none focus:border-blue-500"
              >
                {engine.devices.length === 0 && <option value="">No devices</option>}
                {engine.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
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
