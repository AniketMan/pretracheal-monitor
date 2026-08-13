import AVFoundation
import SwiftUI

/// Main screen: edge-to-edge chart, status strip, Liquid Glass control bar.
///
/// Layout follows the same HIG notes the web build was written against —
/// primary action bottom-left within one-handed reach, 44pt targets,
/// status integrated into the UI rather than shown in a modal.
struct MonitorView: View {
    @State private var engine = AudioEngine()
    @State private var alarm = AlarmPlayer()
    @State private var exportURL: URL?
    @State private var showInputPicker = false

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()

            VStack(spacing: 0) {
                header
                WaveformChart(
                    samples: engine.waveform,
                    gain: engine.gain,
                    isAlarm: engine.isAlarm,
                    windowDuration: AudioEngine.windowDuration
                )
                .padding(.horizontal, 8)
                .padding(.bottom, 4)

                if engine.isRunning { statusStrip }
                sensitivitySlider
                controlBar
            }

            if engine.isAlarm {
                AlarmOverlay(silenceDuration: engine.silenceDuration) {
                    engine.dismissAlarm()
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: engine.isAlarm)
        .onChange(of: engine.isAlarm) { _, isAlarming in
            isAlarming ? alarm.start() : alarm.stop()
        }
        .sheet(item: $exportURL) { url in
            ShareLink(item: url) { Label("Share Recording", systemImage: "square.and.arrow.up") }
                .presentationDetents([.height(160)])
        }
        .alert("Audio Error",
               isPresented: .constant(engine.errorMessage != nil),
               actions: { Button("OK") { engine.clearError() } },
               message: { Text(engine.errorMessage ?? "") })
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Pretracheal Monitor")
                .font(.headline)
            if engine.isRunning {
                HStack(spacing: 4) {
                    Circle().fill(.green).frame(width: 8, height: 8)
                    Text("LIVE").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Status

    private var statusStrip: some View {
        HStack(spacing: 16) {
            Text(formatted(engine.elapsedTime))
            Text("Amp: \(engine.currentAmplitude, specifier: "%.1f")")
            if engine.silenceDuration > 2 {
                Text("Silent: \(engine.silenceDuration, specifier: "%.0f")s")
                    .fontWeight(.semibold)
                    .foregroundStyle(engine.silenceDuration > 20 ? Color.red : Color.orange)
            }
            if engine.isRecording {
                HStack(spacing: 4) {
                    Circle().fill(.red).frame(width: 8, height: 8)
                    Text("REC").fontWeight(.semibold).foregroundStyle(.red)
                }
            }
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .padding(.vertical, 6)
    }

    // MARK: - Sensitivity

    /// Mic gain. Scales the trace and the silence threshold together, so
    /// turning it up also makes the alarm slower to fire — the label spells
    /// that out rather than leaving it as a hidden side effect.
    private var sensitivitySlider: some View {
        @Bindable var engine = engine

        return VStack(spacing: 2) {
            HStack {
                Text("Mic Sensitivity")
                Spacer()
                Text("\(Int(engine.gain))×")
                    .monospacedDigit()
                    .foregroundStyle(engine.gain == AudioEngine.defaultGain ? .secondary : .primary)
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Image(systemName: "mic")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Slider(value: $engine.gain,
                       in: AudioEngine.gainRange,
                       step: 5) {
                    Text("Mic sensitivity")
                } minimumValueLabel: {
                    EmptyView()
                } maximumValueLabel: {
                    EmptyView()
                }
                .tint(.green)
                .accessibilityValue("\(Int(engine.gain)) times amplification")
                Image(systemName: "mic.fill")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    // MARK: - Controls

    private var controlBar: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                // Full titles when they fit, icons only on narrow devices.
                ViewThatFits(in: .horizontal) {
                    transportButtons(showTitles: true)
                    transportButtons(showTitles: false)
                }
                Spacer(minLength: 0)
                micButton
            }
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .confirmationDialog("Input Device", isPresented: $showInputPicker, titleVisibility: .visible) {
            ForEach(engine.inputs, id: \.uid) { port in
                Button(port.portName) { engine.selectInput(port) }
            }
        }
    }

    private func transportButtons(showTitles: Bool) -> some View {
        HStack(spacing: 8) {
            Button {
                engine.isRunning ? engine.stop() : engine.start()
            } label: {
                Label(engine.isRunning ? "Stop" : "Start",
                      systemImage: engine.isRunning ? "stop.fill" : "play.fill")
                    .frame(minHeight: 44)
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.glassProminent)
            .tint(engine.isRunning ? .red : .green)
            .accessibilityLabel(engine.isRunning ? "Stop monitoring" : "Start monitoring")

            Button {
                engine.toggleRecording()
            } label: {
                Label(engine.isRecording ? "Stop" : "Rec", systemImage: "record.circle")
                    .frame(minHeight: 44)
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.glass)
            .tint(engine.isRecording ? .red : nil)
            .accessibilityLabel(engine.isRecording ? "Stop recording" : "Start recording")
            .disabled(!engine.isRunning)

            Button {
                exportURL = engine.exportWAV()
            } label: {
                Label("Save", systemImage: "square.and.arrow.down")
                    .frame(minHeight: 44)
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.glass)
            .disabled(!engine.hasRecordedData && !engine.isRecording)
            .accessibilityLabel("Export recording as WAV file")
        }
        .labelStyle(AdaptiveLabelStyle(showTitle: showTitles))
        .fixedSize(horizontal: true, vertical: false)
    }

    private var micButton: some View {
        Button {
            engine.refreshInputs()
            showInputPicker = true
        } label: {
            Image(systemName: "mic")
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glass)
        .accessibilityLabel("Select audio input device")
    }

    private func formatted(_ seconds: Double) -> String {
        String(format: "%02d:%02d", Int(seconds) / 60, Int(seconds) % 60)
    }
}

/// Title-and-icon or icon-only, chosen by `ViewThatFits` on the control bar.
private struct AdaptiveLabelStyle: LabelStyle {
    let showTitle: Bool

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon
            if showTitle { configuration.title }
        }
    }
}

/// Critical alert requiring acknowledgement (HIG: interruptive, dismissible).
struct AlarmOverlay: View {
    let silenceDuration: Double
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.red.opacity(0.28).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.red)
                Text("NO AIRFLOW DETECTED")
                    .font(.title2.weight(.bold))
                Text("Silent for \(Int(silenceDuration)) seconds")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Acknowledge", action: onDismiss)
                    .buttonStyle(.glassProminent)
                    .tint(.red)
                    .frame(minHeight: 44)
            }
            .padding(28)
            .glassEffect(in: .rect(cornerRadius: 24))
        }
        .accessibilityAddTraits(.isModal)
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

#Preview {
    MonitorView()
}
