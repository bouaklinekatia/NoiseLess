import { useEffect, useRef } from "react";

interface Props {
  samples: Float32Array | null;
  color?: string;
  height?: number;
  className?: string;
}

export function Waveform({ samples, color = "var(--waveform)", height = 96, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);

    ctx.strokeStyle = "oklch(0.30 0.02 250)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(w, height / 2);
    ctx.stroke();

    if (!samples || samples.length === 0) return;

    const step = Math.max(1, Math.floor(samples.length / w));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      const end = Math.min(samples.length, start + step);
      for (let i = start; i < end; i++) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = ((1 - max) / 2) * height;
      const y2 = ((1 - min) / 2) * height;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }, [samples, color, height]);

  return <canvas ref={ref} className={className} style={{ width: "100%", height }} />;
}
