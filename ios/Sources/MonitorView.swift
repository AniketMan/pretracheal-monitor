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
    @State private var calibrationTask: Task<BreathBand?, Never>?

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
                calibrationRow
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
            if engine.filterEnabled, let band = engine.band {
                Text("\(Int(band.lowHz))–\(Int(band.highHz)) Hz")
                    .foregroundStyle(.green)
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

    // MARK: - Calibration

    /// Learns the patient's breath band from a room sample vs a breathing
    /// sample, then bandpasses the mic to it.
    @ViewBuilder
    private var calibrationRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            if engine.calibrationPhase != .idle {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(calibrationPrompt)
                            .font(.caption.weight(.semibold))
                        ProgressView(value: engine.calibrationProgress)
                            .tint(.green)
                    }
                    Button("Cancel") { engine.cancelCalibration() }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 44)
                }
            } else {
                HStack(spacing: 8) {
                    Button {
                        calibrationTask = Task { await engine.calibrate() }
                    } label: {
                        Label(engine.band == nil ? "Calibrate Breathing" : "Recalibrate",
                              systemImage: "waveform.badge.magnifyingglass")
                            .font(.caption.weight(.semibold))
                            .frame(minHeight: 44)
                            .padding(.horizontal, 4)
                    }
                    .buttonStyle(.glass)
                    .disabled(!engine.isRunning)

                    if let band = engine.band {
                        Button {
                            engine.filterEnabled.toggle()
                        } label: {
                            Text(engine.filterEnabled ? "Filtered" : "Raw")
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                                .padding(.horizontal, 6)
                        }
                        .buttonStyle(.glass)
                        .tint(engine.filterEnabled ? .green : nil)
                        .accessibilityLabel(engine.filterEnabled
                                            ? "Breath filter on" : "Breath filter off")

                        Text("\(Int(band.lowHz))–\(Int(band.highHz)) Hz")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)

                        Spacer(minLength: 0)

                        Button("Clear") { engine.clearCalibration() }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(minHeight: 44)
                    } else {
                        Spacer(minLength: 0)
                    }
                }
            }

            if let error = engine.calibrationError {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 2)
    }

    private var calibrationPrompt: String {
        switch engine.calibrationPhase {
        case .ambient: "Stay quiet — sampling the room"
        case .breathing: "Now breathe normally into the mic"
        case .analyzing: "Analyzing…"
        case .idle: ""
        }
    }

    // MARK: - Sensitivity

    /// Mic gain, 10x-500x on a log-spaced ladder. Display only: silence
    /// detection runs at the reference gain, so moving this cannot change
    /// when the no-airflow alarm fires.
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
                Slider(value: Binding(
                            get: { Double(AudioEngine.step(forGain: engine.gain)) },
                            set: { engine.gain = AudioEngine.gain(forStep: Int($0.rounded())) }
                       ),
                       in: 0...Double(AudioEngine.gainSteps.count - 1),
                       step: 1) {
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
