/**
 * Home - Main monitor page orchestrating all components.
 *
 * Layout (full viewport, no scrolling):
 *   [StatusBar]        - top strip: connection, time, amplitude, recording
 *   [WaveformCanvas]   - center 70%+: real-time waveform display
 *   [ControlBar]       - bottom strip: start/stop, record, export, device select
 *   [SettingsPanel]    - slide-in from right (optional)
 *   [AlarmOverlay]     - full-screen overlay when alarm triggers
 *   [StartScreen]      - shown before first start (user gesture required for iOS)
 */

import { useState, useCallback, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import WaveformCanvas from '@/components/WaveformCanvas';
import StatusBar from '@/components/StatusBar';
import ControlBar from '@/components/ControlBar';
import SettingsPanel from '@/components/SettingsPanel';
import AlarmOverlay from '@/components/AlarmOverlay';
import StartScreen from '@/components/StartScreen';

export default function Home() {
  const engine = useAudioEngine();
  const [hasStarted, setHasStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Configurable parameters (local state, passed to engine via constants)
  // These override the hook defaults when we rebuild the settings panel
  const [gain, setGain] = useState(engine.GAIN);
  const [threshold, setThreshold] = useState(engine.THRESHOLD);
  const [maxSilenceDuration, setMaxSilenceDuration] = useState(engine.MAX_SILENCE_DURATION);

  // Track online/offline status
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

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
    if (!hasStarted) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [hasStarted]);

  // Handle initial start (user gesture for iOS AudioContext)
  const handleInitialStart = useCallback(async () => {
    try {
      await engine.start(engine.selectedDeviceId || undefined);
      setHasStarted(true);
    } catch (err) {
      console.error('Failed to start:', err);
      alert(
        'Microphone access is required. Please allow microphone permissions and try again.'
      );
    }
  }, [engine]);

  // Handle start from control bar (after initial start)
  const handleStart = useCallback(async () => {
    try {
      await engine.start(engine.selectedDeviceId || undefined);
    } catch (err) {
      console.error('Failed to start:', err);
    }
  }, [engine]);

  // Show start screen if not yet started
  if (!hasStarted) {
    return <StartScreen onStart={handleInitialStart} isOnline={isOnline} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-monitor-bg)] relative">
      {/* Status bar */}
      <StatusBar
        isRunning={engine.isRunning}
        isRecording={engine.isRecording}
        isAlarm={engine.isAlarm}
        elapsedTime={engine.elapsedTime}
        currentAmplitude={engine.currentAmplitude}
        peakAmplitude={engine.peakAmplitude}
        silenceDuration={engine.silenceDuration}
        maxSilenceDuration={maxSilenceDuration}
      />

      {/* Waveform area - takes all remaining space */}
      <div className="flex-1 relative">
        <WaveformCanvas
          waveformData={engine.waveformData}
          gain={gain}
          isAlarm={engine.isAlarm}
          elapsedTime={engine.elapsedTime}
          windowDuration={engine.WINDOW_DURATION}
        />

        {/* Settings panel overlays the waveform area */}
        <SettingsPanel
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          gain={gain}
          threshold={threshold}
          maxSilenceDuration={maxSilenceDuration}
          onGainChange={setGain}
          onThresholdChange={setThreshold}
          onSilenceDurationChange={setMaxSilenceDuration}
        />
      </div>

      {/* Control bar */}
      <ControlBar
        isRunning={engine.isRunning}
        isRecording={engine.isRecording}
        devices={engine.devices}
        selectedDeviceId={engine.selectedDeviceId}
        onStart={handleStart}
        onStop={engine.stop}
        onToggleRecording={engine.toggleRecording}
        onExport={engine.exportWAV}
        onDeviceChange={engine.switchDevice}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((s) => !s)}
      />

      {/* Alarm overlay */}
      <AlarmOverlay
        isAlarm={engine.isAlarm}
        silenceDuration={engine.silenceDuration}
        onDismiss={engine.dismissAlarm}
      />
    </div>
  );
}
