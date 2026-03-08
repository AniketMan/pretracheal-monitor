/**
 * Home - Main monitor page.
 *
 * Matches the original Python script behavior:
 *   - Full-screen chart (matplotlib-style)
 *   - Simple controls: Start/Stop, Record, Export WAV, device selector
 *   - Audio passthrough to speakers
 *   - 30s silence alarm with audible warning
 *   - No fancy UI -- functional medical tool
 */

import { useState, useCallback, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import WaveformCanvas from '@/components/WaveformCanvas';
import AlarmOverlay from '@/components/AlarmOverlay';
import { Play, Square, Circle, Download, Mic } from 'lucide-react';

export default function Home() {
  const engine = useAudioEngine();
  const [gain] = useState(engine.GAIN);

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
    <div className="h-screen flex flex-col bg-[#f0f0f0] relative">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-300">
        <h1 className="text-sm font-semibold text-gray-800">
          Pretracheal Air Flow Monitor
        </h1>
        <span className="text-xs text-gray-500">
          USC Anesthesiology Scholarly Project
        </span>
      </div>

      {/* Chart area - takes all remaining space */}
      <div className="flex-1 p-2">
        <WaveformCanvas
          waveformData={engine.waveformData}
          gain={gain}
          isAlarm={engine.isAlarm}
          elapsedTime={engine.elapsedTime}
          windowDuration={engine.WINDOW_DURATION}
        />
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-t border-gray-300">
        {/* Left: Main controls */}
        <div className="flex items-center gap-2">
          {!engine.isRunning ? (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 active:bg-green-800 transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start
            </button>
          ) : (
            <button
              onClick={engine.stop}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-colors shadow-sm"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </button>
          )}

          <button
            onClick={engine.toggleRecording}
            disabled={!engine.isRunning}
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              engine.isRecording
                ? 'bg-red-100 text-red-700 border border-red-300'
                : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            <Circle className={`w-3 h-3 ${engine.isRecording ? 'fill-red-500 text-red-500' : ''}`} />
            {engine.isRecording ? 'Stop Rec' : 'Record'}
          </button>

          <button
            onClick={engine.exportWAV}
            disabled={!engine.isRecording && !engine.isRunning}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-gray-100 text-gray-700 border border-gray-300 text-sm font-medium hover:bg-gray-200 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Export WAV
          </button>
        </div>

        {/* Center: Status */}
        <div className="flex items-center gap-4 text-xs text-gray-600">
          {engine.isRunning && (
            <>
              <span>
                Elapsed: {Math.floor(engine.elapsedTime / 60).toString().padStart(2, '0')}:
                {Math.floor(engine.elapsedTime % 60).toString().padStart(2, '0')}
              </span>
              <span>Amp: {engine.currentAmplitude.toFixed(1)}</span>
              {engine.silenceDuration > 2 && (
                <span className={engine.silenceDuration > 20 ? 'text-red-600 font-semibold' : 'text-amber-600'}>
                  Silence: {engine.silenceDuration.toFixed(0)}s
                </span>
              )}
              {engine.isRecording && (
                <span className="text-red-600 font-semibold">REC</span>
              )}
            </>
          )}
        </div>

        {/* Right: Device selector */}
        <div className="flex items-center gap-2">
          <Mic className="w-3.5 h-3.5 text-gray-500" />
          <select
            value={engine.selectedDeviceId || ''}
            onChange={(e) => engine.switchDevice(e.target.value)}
            className="bg-white text-gray-700 text-xs border border-gray-300 rounded px-2 py-1.5 max-w-[180px] truncate focus:outline-none focus:border-blue-500"
          >
            {engine.devices.length === 0 && <option value="">No devices</option>}
            {engine.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Alarm overlay */}
      <AlarmOverlay
        isAlarm={engine.isAlarm}
        silenceDuration={engine.silenceDuration}
        onDismiss={engine.dismissAlarm}
      />
    </div>
  );
}
