import SwiftUI

/// Real-time amplitude chart — the SwiftUI counterpart of `WaveformCanvas.tsx`.
///
/// Keeps the web build's visual language: rounded plot area, light grid,
/// monospaced axis ticks, 0–10 amplitude scale, red wash while alarming.
struct WaveformChart: View {
    let samples: [Float]
    let gain: Float
    let isAlarm: Bool
    let windowDuration: Double

    private let yMax: Double = 10
    private let yDivisions = 5

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 400
            let insets = EdgeInsets(top: compact ? 20 : 28,
                                    leading: compact ? 34 : 46,
                                    bottom: compact ? 28 : 34,
                                    trailing: compact ? 10 : 16)
            let plot = CGRect(
                x: insets.leading,
                y: insets.top,
                width: max(geo.size.width - insets.leading - insets.trailing, 1),
                height: max(geo.size.height - insets.top - insets.bottom, 1)
            )

            ZStack {
                Canvas { context, _ in
                    draw(in: &context, plot: plot, compact: compact)
                }
                .accessibilityLabel("Airflow amplitude waveform")
                .accessibilityValue(isAlarm ? "Alarm: no airflow detected" : "Monitoring")
            }
        }
    }

    private func draw(in context: inout GraphicsContext, plot: CGRect, compact: Bool) {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
            .path(in: plot)

        context.fill(shape, with: .color(isAlarm
                                         ? Color.red.opacity(0.18)
                                         : Color(.secondarySystemBackground)))

        // Grid
        var grid = Path()
        for i in 1..<yDivisions {
            let y = plot.minY + plot.height * CGFloat(i) / CGFloat(yDivisions)
            grid.move(to: CGPoint(x: plot.minX + 8, y: y))
            grid.addLine(to: CGPoint(x: plot.maxX - 8, y: y))
        }
        let xSteps = max(Int(windowDuration.rounded(.up)), 1)
        for i in 1..<max(xSteps, 2) {
            let x = plot.minX + plot.width * CGFloat(i) / CGFloat(xSteps)
            grid.move(to: CGPoint(x: x, y: plot.minY + 8))
            grid.addLine(to: CGPoint(x: x, y: plot.maxY - 8))
        }
        context.stroke(grid, with: .color(Color.primary.opacity(0.08)), lineWidth: 0.5)

        // Axis ticks
        let tickFont = Font.system(size: compact ? 10 : 11, design: .monospaced)
        for i in 0...yDivisions {
            let value = yMax - yMax * Double(i) / Double(yDivisions)
            let y = plot.minY + plot.height * CGFloat(i) / CGFloat(yDivisions)
            context.draw(
                Text(String(format: "%.0f", value)).font(tickFont).foregroundStyle(.secondary),
                at: CGPoint(x: plot.minX - 8, y: y),
                anchor: .trailing
            )
        }
        for i in 0...xSteps {
            let x = plot.minX + plot.width * CGFloat(i) / CGFloat(xSteps)
            context.draw(
                Text("\(i)").font(tickFont).foregroundStyle(.secondary),
                at: CGPoint(x: x, y: plot.maxY + 10),
                anchor: .center
            )
        }
        context.draw(
            Text("Time (s)").font(.system(size: compact ? 10 : 12)).foregroundStyle(.tertiary),
            at: CGPoint(x: plot.midX, y: plot.maxY + 24),
            anchor: .center
        )

        // Waveform envelope
        guard samples.count > 1 else { return }
        let columns = min(Int(plot.width), 600)
        guard columns > 1 else { return }
        let perColumn = max(samples.count / columns, 1)

        var line = Path()
        for column in 0..<columns {
            let start = column * perColumn
            let end = min(start + perColumn, samples.count)
            guard start < end else { break }

            // Peak magnitude in the column — the 0…10 scale is unsigned,
            // matching the axis labels and the original Python plot.
            var peak: Float = 0
            for i in start..<end {
                peak = max(peak, abs(samples[i]) * gain)
            }

            let x = plot.minX + plot.width * CGFloat(column) / CGFloat(columns - 1)
            let y = yPosition(for: Double(peak), in: plot)
            if column == 0 {
                line.move(to: CGPoint(x: x, y: y))
            } else {
                line.addLine(to: CGPoint(x: x, y: y))
            }
        }

        var filled = line
        filled.addLine(to: CGPoint(x: plot.maxX, y: plot.maxY))
        filled.addLine(to: CGPoint(x: plot.minX, y: plot.maxY))
        filled.closeSubpath()

        context.clip(to: shape)
        context.fill(filled, with: .color(Color.green.opacity(0.18)))
        context.stroke(line, with: .color(.green), lineWidth: 1.2)
    }

    /// Maps an unsigned amplitude onto the 0…10 axis (0 at the baseline).
    private func yPosition(for value: Double, in plot: CGRect) -> CGFloat {
        let normalized = min(max(value, 0) / yMax, 1)
        return plot.maxY - CGFloat(normalized) * plot.height
    }
}
