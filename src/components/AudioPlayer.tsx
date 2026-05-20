import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  samples: Float32Array | null;
  sampleRate: number;
  onDownload?: () => void;
}

export function AudioPlayer({ samples, sampleRate, onDownload }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => { srcRef.current?.stop(); ctxRef.current?.close(); }, []);

  const toggle = async () => {
    if (!samples) return;
    if (playing) {
      srcRef.current?.stop();
      setPlaying(false);
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(false);
    src.start();
    srcRef.current = src;
    setPlaying(true);
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={toggle} disabled={!samples}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        {playing ? "Pause" : "Play"}
      </Button>
      {onDownload && (
        <Button size="sm" variant="outline" onClick={onDownload} disabled={!samples}>
          <Download className="size-4" /> WAV
        </Button>
      )}
    </div>
  );
}
