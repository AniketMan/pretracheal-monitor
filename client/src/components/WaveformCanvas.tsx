/**
 * WaveformCanvas - Matplotlib-style waveform display matching the PDF spec.
 * Fully responsive -- scales margins, fonts, and bars to screen size.
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

    // CSS pixel dimensions for responsive scaling
    const cssW = w / dpr;
    const isMobile = cssW < 500;

    // Responsive margins -- tighter on mobile
    const marginLeft = (isMobile ? 36 : 60) * dpr;
    const marginRight = (isMobile ? 8 : 20) * dpr;
    const marginTop = (isMobile ? 22 : 30) * dpr;
    const marginBottom = (isMobile ? 32 : 45) * dpr;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;

    // Responsive font sizes
    const tickFont = (isMobile ? 9 : 12) * dpr;
    const labelFont = (isMobile ? 10 : 13) * dpr;
    const infoFont = (isMobile ? 8 : 10) * dpr;
    const clockFont = (isMobile ? 8 : 11) * dpr;

    const yMax = 10;

    // -- Background --
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, w, h);

    // Plot area background
    ctx.fillStyle = isAlarm ? 'rgba(255, 53, 53, 0.35)' : '#ffffff';
    ctx.fillRect(marginLeft, marginTop, plotW, plotH);

    // -- Grid lines --
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
    ctx.font = `${tickFont}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const val = yMax - (i / 5) * yMax;
      const y = marginTop + (i / 5) * plotH;
      ctx.fillText(val.toFixed(0), marginLeft - 4 * dpr, y);
    }

    // -- X-axis tick labels --
    const xSteps = Math.ceil(windowDuration);
    // On mobile, show fewer ticks to avoid overlap
    const xTickSkip = isMobile ? 2 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xSteps; i++) {
      const x = marginLeft + (i / xSteps) * plotW;
      const timeVal = elapsedTime - windowDuration + (i / xSteps) * windowDuration;

      // Vertical grid for all
      ctx.strokeStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.moveTo(x, marginTop);
      ctx.lineTo(x, marginTop + plotH);
      ctx.stroke();

      // Label only every xTickSkip
      if (timeVal >= 0 && i % xTickSkip === 0) {
        ctx.fillStyle = '#333333';
        ctx.font = `${tickFont}px sans-serif`;
        ctx.fillText(Math.floor(timeVal).toString(), x, marginTop + plotH + 3 * dpr);
      }
    }

    // -- Axis labels --
    ctx.fillStyle = '#333333';
    ctx.font = `${labelFont}px sans-serif`;

    // X-axis label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time (s)', marginLeft + plotW / 2, marginTop + plotH + (isMobile ? 14 : 25) * dpr);

    // Y-axis label (rotated)
    ctx.save();
    ctx.translate((isMobile ? 8 : 16) * dpr, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Amplitude', 0, 0);
    ctx.restore();

    // -- Waveform bars --
    if (waveformData.length > 0) {
      const maxBars = isMobile ? Math.floor(plotW / dpr) : Math.floor(plotW / (1.5 * dpr));
      const numBars = Math.min(maxBars, waveformData.length);
      const barWidth = Math.max(1, plotW / numBars);

      ctx.fillStyle = '#4472C4';

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

    // -- Top-left info text --
    ctx.fillStyle = '#333333';
    ctx.font = `${infoFont}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(isMobile ? 'Tap Start' : 'Tap Start to begin monitoring', marginLeft + 3 * dpr, marginTop + 3 * dpr);

    // -- Top-right clock --
    const now = new Date();
    const clockStr = now.toLocaleTimeString('en-US', { hour12: false });
    ctx.fillStyle = '#333333';
    ctx.font = `${clockFont}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(clockStr, marginLeft + plotW - 3 * dpr, marginTop + 3 * dpr);

    // -- Alarm warning text --
    if (isAlarm) {
      const alarmFontSize = isMobile
        ? Math.min(13 * dpr, plotW / 18)
        : Math.min(18 * dpr, plotW / 20);
      ctx.save();
      ctx.font = `bold ${alarmFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const text = isMobile ? 'WARNING:\nNO SOUND' : 'WARNING: NO SOUND DETECTED';

      if (isMobile) {
        // Multi-line on mobile
        const lines = text.split('\n');
        const lineH = alarmFontSize * 1.3;
        const totalH = lines.length * lineH;
        const boxPad = 8 * dpr;
        let maxLineW = 0;
        for (const line of lines) {
          const m = ctx.measureText(line);
          if (m.width > maxLineW) maxLineW = m.width;
        }
        const boxX = marginLeft + plotW / 2 - maxLineW / 2 - boxPad;
        const boxY = marginTop + plotH / 2 - totalH / 2 - boxPad;
        const boxW = maxLineW + boxPad * 2;
        const boxH = totalH + boxPad * 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5 * dpr;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.fillStyle = '#cc0000';
        for (let li = 0; li < lines.length; li++) {
          const ly = marginTop + plotH / 2 - totalH / 2 + li * lineH + lineH / 2;
          ctx.fillText(lines[li], marginLeft + plotW / 2, ly);
        }
      } else {
        const metrics = ctx.measureText(text);
        const boxPad = 10 * dpr;
        const boxX = marginLeft + plotW / 2 - metrics.width / 2 - boxPad;
        const boxY = marginTop + plotH / 2 - alarmFontSize / 2 - boxPad;
        const boxW = metrics.width + boxPad * 2;
        const boxH = alarmFontSize + boxPad * 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5 * dpr;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.fillStyle = '#cc0000';
        ctx.fillText(text, marginLeft + plotW / 2, marginTop + plotH / 2);
      }
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
