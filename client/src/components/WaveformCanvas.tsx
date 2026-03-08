/**
 * WaveformCanvas - Matplotlib-style waveform display matching the PDF spec.
 *
 * Matches Figures 3, 4, 5 from the paper:
 *   - White background plot area
 *   - Blue vertical bars for amplitude (like a bar chart)
 *   - Y-axis: "Amplitude" (0-10)
 *   - X-axis: "Time (s)" rolling window
 *   - Red background + "WARNING: NO SOUND DETECTED" text on alarm
 *   - Top-left: instructions text
 *   - Top-right: clock time
 */

import { useRef, useEffect, useCallback, useState } from 'react';

interface WaveformCanvasProps {
  waveformData: Float32Array;
  gain: number;
  isAlarm: boolean;
  elapsedTime: number;
  windowDuration: number;
  className?: string;
}

export default function WaveformCanvas({
  waveformData,
  gain,
  isAlarm,
  elapsedTime,
  windowDuration,
  className = '',
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderKey, setRenderKey] = useState(0);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    setRenderKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // Initial render after mount
    const timer = setTimeout(() => resizeCanvas(), 50);
    const observer = new ResizeObserver(resizeCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    // Margins matching matplotlib defaults
    const marginLeft = 60 * dpr;
    const marginRight = 20 * dpr;
    const marginTop = 30 * dpr;
    const marginBottom = 45 * dpr;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;

    const yMax = 10;

    // -- Background --
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, w, h);

    // Plot area background
    if (isAlarm) {
      ctx.fillStyle = 'rgba(255, 53, 53, 0.35)';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillRect(marginLeft, marginTop, plotW, plotH);

    // -- Grid lines (subtle, matplotlib-style) --
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = marginTop + (i / 5) * plotH;
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(marginLeft + plotW, y);
      ctx.stroke();
    }

    // -- Y-axis tick labels --
    ctx.fillStyle = '#333333';
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const val = yMax - (i / 5) * yMax;
      const y = marginTop + (i / 5) * plotH;
      ctx.fillText(val.toFixed(0), marginLeft - 8 * dpr, y);
    }

    // -- X-axis tick labels --
    const xSteps = Math.ceil(windowDuration);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xSteps; i++) {
      const x = marginLeft + (i / xSteps) * plotW;
      const timeVal = elapsedTime - windowDuration + (i / xSteps) * windowDuration;
      if (timeVal >= 0) {
        ctx.fillText(Math.floor(timeVal).toString(), x, marginTop + plotH + 6 * dpr);
      }

      // Vertical grid
      ctx.strokeStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.moveTo(x, marginTop);
      ctx.lineTo(x, marginTop + plotH);
      ctx.stroke();
    }

    // -- Axis labels --
    ctx.fillStyle = '#333333';
    ctx.font = `${13 * dpr}px sans-serif`;

    // X-axis label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time (s)', marginLeft + plotW / 2, marginTop + plotH + 25 * dpr);

    // Y-axis label (rotated)
    ctx.save();
    ctx.translate(16 * dpr, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Amplitude', 0, 0);
    ctx.restore();

    // -- Waveform bars (blue, matching Figure 4 style) --
    if (waveformData.length > 0) {
      const numBars = Math.min(Math.floor(plotW / (1.5 * dpr)), waveformData.length);
      const barWidth = Math.max(1, plotW / numBars);

      ctx.fillStyle = '#4472C4'; // matplotlib default blue

      for (let i = 0; i < numBars; i++) {
        const sampleIdx = Math.floor((i / numBars) * waveformData.length);
        const sample = Math.abs(waveformData[sampleIdx]) * gain;
        const normalized = Math.min(sample / yMax, 1);
        const barH = normalized * plotH;

        const x = marginLeft + i * barWidth;
        const y = marginTop + plotH - barH;

        ctx.fillRect(x, y, Math.max(barWidth - 0.5, 0.5), barH);
      }
    }

    // -- Plot border --
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(marginLeft, marginTop, plotW, plotH);

    // -- Top-left instructions text --
    ctx.fillStyle = '#333333';
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Tap Start to begin monitoring', marginLeft + 4 * dpr, marginTop + 4 * dpr);

    // -- Top-right clock --
    const now = new Date();
    const clockStr = `Time: ${now.toLocaleTimeString('en-US', { hour12: false })}`;
    ctx.fillStyle = '#333333';
    ctx.font = `${11 * dpr}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(clockStr, marginLeft + plotW - 4 * dpr, marginTop + 4 * dpr);

    // -- Alarm warning text (Figure 5) --
    if (isAlarm) {
      const fontSize = Math.min(18 * dpr, plotW / 20);
      ctx.save();
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Background box
      const text = 'WARNING: NO SOUND DETECTED';
      const metrics = ctx.measureText(text);
      const boxPad = 10 * dpr;
      const boxX = marginLeft + plotW / 2 - metrics.width / 2 - boxPad;
      const boxY = marginTop + plotH / 2 - fontSize / 2 - boxPad;
      const boxW = metrics.width + boxPad * 2;
      const boxH = fontSize + boxPad * 2;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = '#000000';
      ctx.fillText(text, marginLeft + plotW / 2, marginTop + plotH / 2);
      ctx.restore();
    }
  }, [waveformData, gain, isAlarm, elapsedTime, windowDuration, renderKey]);

  return (
    <div ref={containerRef} className={`w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}
