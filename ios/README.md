# Pneuma Sense — iOS

Native SwiftUI port of the web app on `main`. Same clinical behaviour, native
audio stack and Liquid Glass controls.

## Build

```bash
cd ios
xcodegen generate          # regenerates PneumaSense.xcodeproj
open PneumaSense.xcodeproj
```

Requires Xcode 26 (iOS 26 SDK — `glassEffect` / `.buttonStyle(.glass)`),
XcodeGen (`brew install xcodegen`), Swift 6 with complete strict concurrency.

Command-line build:

```bash
xcodebuild -project ios/PneumaSense.xcodeproj -scheme PneumaSense -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

The generated `.xcodeproj` and `build/` are ignored — `project.yml` is the source
of truth.

## Layout

| File | Web counterpart |
|------|-----------------|
| `Sources/AudioEngine.swift` | `client/src/hooks/useAudioEngine.ts` |
| `Sources/WaveformChart.swift` | `client/src/components/WaveformCanvas.tsx` |
| `Sources/MonitorView.swift` | `client/src/pages/Home.tsx` + `ControlBar` + `StatusBar` |
| `AlarmOverlay` (in `MonitorView.swift`), `Sources/AlarmPlayer.swift` | `client/src/components/AlarmOverlay.tsx` |
| `Sources/WAVEncoder.swift` | `encodeWAV()` in `useAudioEngine.ts` |
| `Sources/WaveformBuffer.swift` | the rolling `Float32Array` buffer |

## Behaviour parity

Constants are unchanged from the web build and the original Python script:
3 s window, gain 50, silence threshold 1, 30 s to alarm, 44.1 kHz mono.

Native differences worth knowing:

- **Capture** is `AVAudioEngine` input-node tap instead of `ScriptProcessorNode`.
  The tap runs on the audio thread and writes into a lock-guarded ring buffer;
  the UI samples it at 30 Hz on the main actor.
- **Input selection** uses `AVAudioSession.availableInputs` /
  `setPreferredInput` rather than `enumerateDevices`.
- **Export** writes a WAV to the temp directory and hands it to `ShareLink`,
  instead of triggering a browser download.
- **Alarm** is an `AVAudioEngine` tone buffer plus `UINotificationFeedbackGenerator`
  haptics, replacing the Web Audio oscillator and `navigator.vibrate`.
- **Background audio** is declared in `Info.plist` (`UIBackgroundModes: audio`)
  so monitoring survives screen lock. Dark mode and Dynamic Type come from the
  system, so the manual theme toggle from the web build is gone.

## Not ported

The web build's service worker, PWA manifest, fullscreen toggle, and the unused
`server/` and shadcn UI kit have no native equivalent and were left behind.
