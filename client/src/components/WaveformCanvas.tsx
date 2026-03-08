/**
 * WaveformCanvas - High-performance canvas-based waveform renderer.
 *
 * Design: Clinical Instrument Panel
 *   - Dark background with phosphor-green waveform trace
 *   - Subtle grid lines mimicking real patient monitor displays
 *   - Glow effect on the waveform for that CRT phosphor look
 *   - Y-axis amplitude labels, X-axis time labels
 *   - Alarm state turns background red with warning overlay
 *
 * Performance:
 *   - Uses requestAnimationFrame for smooth 60fps rendering
 *   - Direct canvas 2D context manipulation (no DOM overhead)
 *   - Downsamples waveform data to match pixel width
 */

import { useRef, useEffect, useCallback } from 'react';

interface WaveformCanvasProps {
  waveformData: Float32Array;
  gain: number;
  isAlarm: boolean;
  elapsedTime: number;
  windowDuration: number;
  className?: string;
}

// Clinical monitor color palette
const COLORS = {
  bg: '#0a0f1a',
  bgAlarm: '#4a0a0a',
  grid: 'rgba(255, 255, 255, 0.06)',
  gridMajor: 'rgba(255, 255, 255, 0.1)',
  waveform: '#00e676',
  waveformGlow: 'rgba(0, 230, 118, 0.3)',
  text: 'rgba(255, 255, 255, 0.5)',
  textBright: 'rgba(255, 255, 255, 0.8)',
  alarmText: '#ff1744',
  alarmBg: 'rgba(255, 23, 68, 0.15)',
  alarmBorder: 'rgba(255, 23, 68, 0.4)',
};

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

  // Handle canvas resize to match container
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
  }, []);

  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resizeCanvas]);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    // Margins for axis labels
    const marginLeft = 56 * dpr;
    const marginRight = 16 * dpr;
    const marginTop = 12 * dpr;
    const marginBottom = 32 * dpr;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;

    // Clear
    ctx.fillStyle = isAlarm ? COLORS.bgAlarm : COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Alarm background pulse
    if (isAlarm) {
      const pulseAlpha = 0.08 + 0.07 * Math.sin(Date.now() / 750);
      ctx.fillStyle = `rgba(255, 23, 68, ${pulseAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // -- Grid --
    const yMax = 10; // max amplitude on display
    const ySteps = 5;
    const xSteps = Math.ceil(windowDuration);

    ctx.lineWidth = 1;

    // Horizontal grid lines (amplitude)
    for (let i = 0; i <= ySteps; i++) {
      const y = marginTop + (i / ySteps) * plotH;
      ctx.strokeStyle = i === ySteps ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(marginLeft + plotW, y);
      ctx.stroke();

      // Y-axis labels
      const val = yMax - (i / ySteps) * yMax;
      ctx.fillStyle = COLORS.text;
      ctx.font = `${11 * dpr}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val.toFixed(0), marginLeft - 8 * dpr, y);
    }

    // Vertical grid lines (time)
    for (let i = 0; i <= xSteps; i++) {
      const x = marginLeft + (i / xSteps) * plotW;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, marginTop);
      ctx.lineTo(x, marginTop + plotH);
      ctx.stroke();

      // X-axis labels
      const timeVal = elapsedTime - windowDuration + (i / xSteps) * windowDuration;
      if (timeVal >= 0) {
        ctx.fillStyle = COLORS.text;
        ctx.font = `${10 * dpr}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(
          `${timeVal.toFixed(0)}s`,
          x,
          marginTop + plotH + 6 * dpr
        );
      }
    }

    // -- Waveform trace --
    if (waveformData.length > 0) {
      // Downsample to pixel width
      const samplesPerPixel = Math.max(1, Math.floor(waveformData.length / plotW));

      // Glow layer (wider, semi-transparent)
      ctx.save();
      ctx.strokeStyle = COLORS.waveformGlow;
      ctx.lineWidth = 4 * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      for (let px = 0; px < plotW; px++) {
        const sampleIdx = Math.floor((px / plotW) * waveformData.length);
        const sample = Math.abs(waveformData[sampleIdx]) * gain;
        const normalized = Math.min(sample / yMax, 1);
        const x = marginLeft + px;
        const y = marginTop + plotH - normalized * plotH;

        if (px === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Main waveform line (sharp, bright)
      ctx.save();
      ctx.strokeStyle = isAlarm ? COLORS.alarmText : COLORS.waveform;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Add glow via shadow
      ctx.shadowColor = isAlarm ? 'rgba(255, 23, 68, 0.6)' : 'rgba(0, 230, 118, 0.5)';
      ctx.shadowBlur = 6 * dpr;

      ctx.beginPath();
      for (let px = 0; px < plotW; px++) {
        const sampleIdx = Math.floor((px / plotW) * waveformData.length);
        const sample = Math.abs(waveformData[sampleIdx]) * gain;
        const normalized = Math.min(sample / yMax, 1);
        const x = marginLeft + px;
        const y = marginTop + plotH - normalized * plotH;

        if (px === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // -- Axis labels --
    ctx.fillStyle = COLORS.textBright;
    ctx.font = `${11 * dpr}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Time (s)', marginLeft + plotW / 2, h - 2 * dpr);

    // Y-axis label (rotated)
    ctx.save();
    ctx.translate(14 * dpr, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = COLORS.textBright;
    ctx.font = `${11 * dpr}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Amplitude', 0, 0);
    ctx.restore();

    // -- Alarm overlay text --
    if (isAlarm) {
      const fontSize = Math.min(28 * dpr, plotW / 14);
      ctx.save();
      ctx.font = `700 ${fontSize}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Background box
      const text = 'WARNING: NO SOUND DETECTED';
      const metrics = ctx.measureText(text);
      const boxPad = 16 * dpr;
      const boxX = w / 2 - metrics.width / 2 - boxPad;
      const boxY = h / 2 - fontSize / 2 - boxPad;
      const boxW = metrics.width + boxPad * 2;
      const boxH = fontSize + boxPad * 2;

      ctx.fillStyle = 'rgba(10, 15, 26, 0.85)';
      ctx.strokeStyle = COLORS.alarmBorder;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8 * dpr);
      ctx.fill();
      ctx.stroke();

      // Text with glow
      ctx.shadowColor = 'rgba(255, 23, 68, 0.8)';
      ctx.shadowBlur = 16 * dpr;
      ctx.fillStyle = COLORS.alarmText;
      ctx.fillText(text, w / 2, h / 2);
      ctx.restore();
    }

    // Plot border
    ctx.strokeStyle = isAlarm ? COLORS.alarmBorder : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(marginLeft, marginTop, plotW, plotH);
  }, [waveformData, gain, isAlarm, elapsedTime, windowDuration]);

  return (
    <div ref={containerRef} className={`w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
}
