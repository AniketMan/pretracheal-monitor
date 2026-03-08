/**
 * WaveformCanvas - HIG-compliant real-time waveform chart.
 *
 * Design decisions per Apple HIG:
 *   - Line chart (Charting Data: "line mark for continuous time data")
 *   - SF Mono for axis numbers (Typography: monospaced for numerical alignment)
 *   - Caption1 (12pt) for axis ticks, Footnote (13pt) for axis labels
 *   - 4.5:1 contrast minimum on all text
 *   - Semantic colors that adapt to dark/light mode
 *   - Minimal grid lines to keep focus on data
 *   - Accessible: aria-label on canvas element
 */

import { useRef, useEffect, useCallback, useState } from 'react';

interface WaveformCanvasProps {
  waveformData: Float32Array;
  gain: number;
  isAlarm: boolean;
  elapsedTime: number;
  windowDuration: number;
  isDark: boolean;
}

export default function WaveformCanvas({
  waveformData,
  gain,
  isAlarm,
  elapsedTime,
  windowDuration,
  isDark,
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
    const cssW = w / dpr;

    // Responsive breakpoints
    const isCompact = cssW < 400;
    const isRegular = cssW >= 400 && cssW < 700;

    // HIG-compliant colors
    const colors = isDark
      ? {
          bg: '#1c1c1e',           // systemBackground (dark)
          plotBg: '#2c2c2e',       // secondarySystemBackground (dark)
          grid: 'rgba(255,255,255,0.08)',
          axis: 'rgba(255,255,255,0.12)',
          tickText: 'rgba(255,255,255,0.6)',  // secondaryLabel
          labelText: 'rgba(255,255,255,0.4)', // tertiaryLabel
          waveform: '#32d74b',     // iOS green
          waveformFill: 'rgba(50,215,75,0.15)',
          alarmBg: 'rgba(255,69,58,0.2)',
          alarmText: '#ff453a',    // iOS red (dark)
          border: 'rgba(255,255,255,0.15)',
          infoText: 'rgba(255,255,255,0.5)',
        }
      : {
          bg: '#f2f2f7',           // systemBackground (light)
          plotBg: '#ffffff',       // secondarySystemBackground (light)
          grid: 'rgba(0,0,0,0.06)',
          axis: 'rgba(0,0,0,0.1)',
          tickText: 'rgba(0,0,0,0.5)',
          labelText: 'rgba(0,0,0,0.35)',
          waveform: '#34c759',     // iOS green (light)
          waveformFill: 'rgba(52,199,89,0.12)',
          alarmBg: 'rgba(255,59,48,0.15)',
          alarmText: '#ff3b30',    // iOS red (light)
          border: 'rgba(0,0,0,0.12)',
          infoText: 'rgba(0,0,0,0.4)',
        };

    // Responsive margins (HIG: adequate spacing for readability)
    const marginLeft = (isCompact ? 40 : isRegular ? 52 : 64) * dpr;
    const marginRight = (isCompact ? 12 : 20) * dpr;
    const marginTop = (isCompact ? 28 : 36) * dpr;
    const marginBottom = (isCompact ? 36 : 48) * dpr;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;

    // HIG type scale (scaled by DPR)
    const caption1 = (isCompact ? 11 : 12) * dpr;  // Caption 1: 12pt
    const footnote = (isCompact ? 12 : 13) * dpr;   // Footnote: 13pt
    const headline = (isCompact ? 14 : 17) * dpr;   // Headline: 17pt
    const caption2 = (isCompact ? 10 : 11) * dpr;   // Caption 2: 11pt

    const yMax = 10;
    const systemFont = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    const monoFont = '"SF Mono", ui-monospace, Menlo, monospace';

    // -- Clear & Background --
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // -- Plot area --
    ctx.fillStyle = isAlarm ? colors.alarmBg : colors.plotBg;
    // Continuous corner radius (HIG: iOS uses continuous/squircle corners)
    const cornerR = 8 * dpr;
    ctx.beginPath();
    ctx.roundRect(marginLeft, marginTop, plotW, plotH, cornerR);
    ctx.fill();

    // -- Grid lines (HIG: "fewer, lighter grid lines to keep focus on data") --
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5 * dpr;
    // Horizontal grid: 5 divisions
    for (let i = 1; i < 5; i++) {
      const y = marginTop + (i / 5) * plotH;
      ctx.beginPath();
      ctx.moveTo(marginLeft + cornerR, y);
      ctx.lineTo(marginLeft + plotW - cornerR, y);
      ctx.stroke();
    }
    // Vertical grid
    const xSteps = Math.ceil(windowDuration);
    for (let i = 1; i < xSteps; i++) {
      const x = marginLeft + (i / xSteps) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, marginTop + cornerR);
      ctx.lineTo(x, marginTop + plotH - cornerR);
      ctx.stroke();
    }

    // -- Y-axis tick labels (SF Mono, Caption1) --
    ctx.fillStyle = colors.tickText;
    ctx.font = `400 ${caption1}px ${monoFont}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const val = yMax - (i / 5) * yMax;
      const y = marginTop + (i / 5) * plotH;
      ctx.fillText(val.toFixed(0), marginLeft - 8 * dpr, y);
    }

    // -- X-axis tick labels --
    const xTickSkip = isCompact ? 2 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xSteps; i++) {
      const x = marginLeft + (i / xSteps) * plotW;
      const timeVal = elapsedTime - windowDuration + (i / xSteps) * windowDuration;
      if (timeVal >= 0 && i % xTickSkip === 0) {
        ctx.fillStyle = colors.tickText;
        ctx.font = `400 ${caption1}px ${monoFont}`;
        ctx.fillText(Math.floor(timeVal).toString(), x, marginTop + plotH + 6 * dpr);
      }
    }

    // -- Axis labels (Footnote, tertiaryLabel color) --
    ctx.fillStyle = colors.labelText;
    ctx.font = `400 ${footnote}px ${systemFont}`;

    // X-axis label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time (s)', marginLeft + plotW / 2, marginTop + plotH + (isCompact ? 18 : 26) * dpr);

    // Y-axis label (rotated)
    ctx.save();
    ctx.translate((isCompact ? 10 : 16) * dpr, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Amplitude', 0, 0);
    ctx.restore();

    // -- Waveform (HIG: line chart for continuous data) --
    if (waveformData.length > 0) {
      const numPoints = Math.min(isCompact ? 200 : 400, waveformData.length);
      const step = waveformData.length / numPoints;

      // Filled area under the line
      ctx.beginPath();
      ctx.moveTo(marginLeft, marginTop + plotH);
      for (let i = 0; i < numPoints; i++) {
        const sampleIdx = Math.floor(i * step);
        const sample = Math.abs(waveformData[sampleIdx]) * gain;
        const normalized = Math.min(sample / yMax, 1);
        const x = marginLeft + (i / numPoints) * plotW;
        const y = marginTop + plotH - normalized * plotH;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(marginLeft + plotW, marginTop + plotH);
      ctx.closePath();
      ctx.fillStyle = colors.waveformFill;
      ctx.fill();

      // Line on top
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const sampleIdx = Math.floor(i * step);
        const sample = Math.abs(waveformData[sampleIdx]) * gain;
        const normalized = Math.min(sample / yMax, 1);
        const x = marginLeft + (i / numPoints) * plotW;
        const y = marginTop + plotH - normalized * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colors.waveform;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // -- Plot border (subtle) --
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 0.5 * dpr;
    ctx.beginPath();
    ctx.roundRect(marginLeft, marginTop, plotW, plotH, cornerR);
    ctx.stroke();

    // -- Top-left: chart title (Headline weight) --
    ctx.fillStyle = colors.infoText;
    ctx.font = `500 ${caption2}px ${systemFont}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Real-Time Airflow', marginLeft + 10 * dpr, marginTop + 8 * dpr);

    // -- Top-right: clock (Caption2, monospace) --
    const now = new Date();
    const clockStr = now.toLocaleTimeString('en-US', { hour12: false });
    ctx.fillStyle = colors.infoText;
    ctx.font = `400 ${caption2}px ${monoFont}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(clockStr, marginLeft + plotW - 10 * dpr, marginTop + 8 * dpr);

    // -- Alarm warning (HIG: critical alerts should be prominent) --
    if (isAlarm) {
      const alarmFontSize = isCompact
        ? Math.min(headline, plotW / 14)
        : Math.min(headline * 1.2, plotW / 16);

      ctx.save();
      ctx.font = `600 ${alarmFontSize}px ${systemFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const text = 'NO SOUND DETECTED';
      const metrics = ctx.measureText(text);
      const padX = 16 * dpr;
      const padY = 10 * dpr;
      const boxW = metrics.width + padX * 2;
      const boxH = alarmFontSize + padY * 2;
      const boxX = marginLeft + plotW / 2 - boxW / 2;
      const boxY = marginTop + plotH / 2 - boxH / 2;

      // Pill-shaped alarm badge
      ctx.fillStyle = isDark ? 'rgba(255,69,58,0.9)' : 'rgba(255,59,48,0.9)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, boxH / 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, marginLeft + plotW / 2, marginTop + plotH / 2);
      ctx.restore();
    }
  }, [waveformData, gain, isAlarm, elapsedTime, windowDuration, isDark, renderKey]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        role="img"
        aria-label={
          isAlarm
            ? 'Real-time airflow waveform chart. Warning: no sound detected.'
            : 'Real-time airflow waveform chart showing live microphone amplitude data.'
        }
      />
    </div>
  );
}
