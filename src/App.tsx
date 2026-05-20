import { useCallback, useMemo, useState } from "react";
import {
  Upload, Activity, Sparkles, Waves, Filter, Trophy,
  RefreshCcw, FileText, AudioLines, Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Progress, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/misc";
import { Toaster, toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import jsPDF from "jspdf";
import {
  butterworthLowpass, gaussianFFTFilter, wienerFilter,
  estimateSNR, encodeWAV,
} from "@/lib/dsp";
import { Waveform } from "@/components/Waveform";
import { AudioPlayer } from "@/components/AudioPlayer";

type MethodKey = "butterworth" | "gaussian" | "wiener";

interface MethodMeta {
  key: MethodKey;
  index: number;
  name: string;
  tagline: string;
  description: string;
  icon: typeof Filter;
  colorVar: string;
  softVar: string;
}

const METHODS: MethodMeta[] = [
  {
    key: "butterworth", index: 1, name: "Butterworth LP",
    tagline: "Order 4 · fc = 3000 Hz",
    description: "Simplest method, removes high-frequency noise above the cutoff.",
    icon: Filter,
    colorVar: "var(--method-1)", softVar: "var(--method-1-soft)",
  },
  {
    key: "gaussian", index: 2, name: "Gaussian FFT",
    tagline: "σ = 3000 Hz · spectral",
    description: "Frequency-domain filtering with smooth Gaussian transition.",
    icon: Waves,
    colorVar: "var(--method-2)", softVar: "var(--method-2-soft)",
  },
  {
    key: "wiener", index: 3, name: "Wiener Filter",
    tagline: "Order 50 · adaptive gain",
    description: "Adaptive optimal filter, best perceptual quality.",
    icon: Sparkles,
    colorVar: "var(--method-3)", softVar: "var(--method-3-soft)",
  },
];

interface MethodResult {
  samples: Float32Array;
  outSNR: number;
  deltaSNR: number;
  timeMs: number;
}

interface AudioState {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  fileName: string;
  inputSNR: number;
  results: Record<MethodKey, MethodResult>;
}

export default function App() {
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<Record<MethodKey, number>>({
    butterworth: 0, gaussian: 0, wiener: 0,
  });

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large (max 10 MB)"); return; }
    setProcessing(true);
    setProgress({ butterworth: 0, gaussian: 0, wiener: 0 });
    try {
      const arrayBuffer = await file.arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctx();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const samples = new Float32Array(decoded.getChannelData(0));
      const sampleRate = decoded.sampleRate;
      await audioCtx.close();

      const inputSNR = estimateSNR(samples, sampleRate);

      const run = async <K extends MethodKey>(k: K, fn: () => Float32Array): Promise<MethodResult> => {
        setProgress((p) => ({ ...p, [k]: 15 }));
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        const out = fn();
        const t1 = performance.now();
        setProgress((p) => ({ ...p, [k]: 70 }));
        await new Promise((r) => setTimeout(r, 30));
        const outSNR = estimateSNR(out, sampleRate);
        setProgress((p) => ({ ...p, [k]: 100 }));
        return { samples: out, outSNR, deltaSNR: outSNR - inputSNR, timeMs: t1 - t0 };
      };

      const [r1, r2, r3] = await Promise.all([
        run("butterworth", () => butterworthLowpass(samples, sampleRate, 3000)),
        run("gaussian", () => gaussianFFTFilter(samples, sampleRate, 3000)),
        run("wiener", () => wienerFilter(samples, sampleRate, 50)),
      ]);

      setAudio({ samples, sampleRate, duration: decoded.duration, fileName: file.name, inputSNR, results: { butterworth: r1, gaussian: r2, wiener: r3 } });
      toast.success("Processing complete");
    } catch (e) {
      console.error(e);
      toast.error("Could not decode audio file");
    } finally {
      setProcessing(false);
    }
  }, []);

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const ranked = useMemo(() => {
    if (!audio) return [];
    return METHODS.map((m) => ({ meta: m, res: audio.results[m.key] })).sort(
      (a, b) => b.res.deltaSNR - a.res.deltaSNR,
    );
  }, [audio]);

  const chartData = useMemo(() => {
    if (!audio) return [];
    return METHODS.map((m) => ({
      name: `M${m.index}`, full: m.name,
      delta: +audio.results[m.key].deltaSNR.toFixed(2),
      color: m.colorVar,
    }));
  }, [audio]);

  const downloadWav = (key: MethodKey) => {
    if (!audio) return;
    const blob = encodeWAV(audio.results[key].samples, audio.sampleRate);
    triggerDownload(blob, `${stripExt(audio.fileName)}_${key}.wav`);
  };

  const downloadOriginal = () => {
    if (!audio) return;
    const blob = encodeWAV(audio.samples, audio.sampleRate);
    triggerDownload(blob, `${stripExt(audio.fileName)}_original.wav`);
  };

  const exportPDF = () => {
    if (!audio) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Audio Denoising — SNR Report", 14, 18);
    doc.setFontSize(10);
    doc.text(`File: ${audio.fileName}`, 14, 28);
    doc.text(`Sample rate: ${audio.sampleRate} Hz`, 14, 34);
    doc.text(`Duration: ${audio.duration.toFixed(2)} s`, 14, 40);
    doc.text(`Input SNR: ${audio.inputSNR.toFixed(2)} dB`, 14, 46);
    doc.setFontSize(12);
    doc.text("Results", 14, 58);
    doc.setFontSize(10);
    let y = 66;
    doc.text("Method", 14, y); doc.text("Output SNR", 80, y); doc.text("ΔSNR", 130, y); doc.text("Time (ms)", 170, y);
    y += 4; doc.line(14, y, 196, y); y += 6;
    for (const m of METHODS) {
      const r = audio.results[m.key];
      doc.text(`${m.index}. ${m.name}`, 14, y);
      doc.text(`${r.outSNR.toFixed(2)} dB`, 80, y);
      doc.text(`${r.deltaSNR >= 0 ? "+" : ""}${r.deltaSNR.toFixed(2)} dB`, 130, y);
      doc.text(`${r.timeMs.toFixed(1)}`, 170, y);
      y += 8;
    }
    const best = ranked[0];
    y += 8; doc.setFontSize(12); doc.text("Recommendation", 14, y); y += 6; doc.setFontSize(10);
    doc.text(`${best.meta.name} provides the highest SNR improvement (${best.res.deltaSNR >= 0 ? "+" : ""}${best.res.deltaSNR.toFixed(2)} dB).`, 14, y, { maxWidth: 180 });
    y += 16; doc.text("Model: y(t) = x(t) + b(t)", 14, y); y += 6;
    doc.text("Based on practical implementation from master's thesis on audio denoising.", 14, y, { maxWidth: 180 });
    doc.save(`${stripExt(audio.fileName)}_snr_report.pdf`);
  };

  const reset = () => setAudio(null);
  const best = ranked[0]?.meta;

  return (
    <div className="min-h-screen">
      <Toaster richColors theme="dark" />

      <header style={{ borderBottom: "1px solid var(--border)", backdropFilter: "blur(12px)", backgroundColor: "oklch(0.16 0.02 250 / 0.6)", position: "sticky", top: 0, zIndex: 10 }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "oklch(0.72 0.18 215 / 0.15)", display: "grid", placeItems: "center", boxShadow: "0 0 0 1px oklch(0.72 0.18 215 / 0.3)", flexShrink: 0 }}>
              <AudioLines style={{ width: 20, height: 20, color: "var(--primary)" }} />
            </div>
            <div className="min-w-0">
              
              <p className="font-mono" style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0 }}></p>
              <h1 style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>NoiseLess</h1>

            </div>
          </div>
          {audio && (
            <Button variant="outline" size="sm" onClick={reset} style={{ flexShrink: 0 }}>
              <RefreshCcw style={{ width: 16, height: 16 }} /> <span className="hidden sm:inline">New file</span>
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {!audio && <UploadHero processing={processing} progress={progress} onUpload={onUpload} />}

        {audio && (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <RecommendationBanner best={best!} bestResult={audio.results[best!.key]} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
              {/* Original */}
              <Card>
                <CardHeader style={{ paddingBottom: 12 }}>
                  <CardTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <Activity style={{ width: 16, height: 16, color: "var(--primary)" }} /> Original (Noisy)
                  </CardTitle>
                </CardHeader>
                <CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <MetaRow audio={audio} />
                  <Waveform samples={audio.samples} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Stat label="Input SNR" value={`${audio.inputSNR.toFixed(2)} dB`} />
                    <AudioPlayer samples={audio.samples} sampleRate={audio.sampleRate} onDownload={downloadOriginal} />
                  </div>
                </CardContent>
              </Card>

              {/* Denoised */}
              <Card>
                <CardHeader style={{ paddingBottom: 12 }}>
                  <CardTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <Filter style={{ width: 16, height: 16, color: "var(--primary)" }} /> Denoised Outputs
                  </CardTitle>
                </CardHeader>
                <CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {METHODS.map((m) => {
                    const r = audio.results[m.key];
                    return (
                      <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6, color: m.colorVar }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.colorVar, display: "inline-block" }} />
                            {m.name}
                          </span>
                          <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>
                            {r.deltaSNR >= 0 ? "+" : ""}{r.deltaSNR.toFixed(2)} dB
                          </span>
                        </div>
                        <Waveform samples={r.samples} color={m.colorVar} height={56} />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* SNR Chart */}
              <Card>
                <CardHeader style={{ paddingBottom: 12 }}>
                  <CardTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <Gauge style={{ width: 16, height: 16, color: "var(--primary)" }} /> ΔSNR Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                        <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} unit=" dB" width={60} />
                        <Tooltip
                          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number, _n: string, p: { payload?: { full?: string } }) => [`${v} dB`, p?.payload?.full ?? ""]}
                          labelFormatter={() => ""}
                        />
                        <Bar dataKey="delta" radius={[6, 6, 0, 0]}>
                          {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
                    {METHODS.map((m) => {
                      const r = audio.results[m.key];
                      return (
                        <div key={m.key} style={{ borderRadius: 6, padding: "8px", border: "1px solid var(--border)", background: m.softVar }}>
                          <div className="font-mono" style={{ fontSize: 10, opacity: 0.8 }}>M{m.index}</div>
                          <div className="font-mono" style={{ fontWeight: 600 }}>{r.outSNR.toFixed(1)} dB</div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Method cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              {METHODS.map((m) => {
                const r = audio.results[m.key];
                const isBest = best?.key === m.key;
                const Icon = m.icon;
                return (
                  <Card key={m.key} style={{ position: "relative", overflow: "hidden", borderColor: isBest ? m.colorVar : undefined }}>
                    <div style={{ position: "absolute", inset: "0 0 auto 0", height: 2, background: m.colorVar }} />
                    <CardHeader style={{ paddingBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 6, display: "grid", placeItems: "center", background: m.softVar, color: m.colorVar }}>
                            <Icon style={{ width: 16, height: 16 }} />
                          </div>
                          <div>
                            <CardTitle style={{ fontSize: 14, lineHeight: 1.2 }}>Method {m.index}: {m.name}</CardTitle>
                            <p className="font-mono" style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{m.tagline}</p>
                          </div>
                        </div>
                        {isBest && (
                          <Badge style={{ fontFamily: "monospace", fontSize: 10, gap: 4, background: m.colorVar, color: "var(--background)", border: "none" }}>
                            <Trophy style={{ width: 12, height: 12 }} /> BEST
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{m.description}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        <Stat label="Out SNR" value={`${r.outSNR.toFixed(2)}`} suffix="dB" />
                        <Stat label="ΔSNR" value={`${r.deltaSNR >= 0 ? "+" : ""}${r.deltaSNR.toFixed(2)}`} suffix="dB" accent={m.colorVar} />
                        <Stat label="Time" value={`${r.timeMs.toFixed(0)}`} suffix="ms" />
                      </div>
                      <AudioPlayer samples={r.samples} sampleRate={audio.sampleRate} onDownload={() => downloadWav(m.key)} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="table">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <TabsList>
                  <TabsTrigger value="table">Metrics Table</TabsTrigger>
                  <TabsTrigger value="overlay">Overlay Comparison</TabsTrigger>
                  <TabsTrigger value="model">Methodology</TabsTrigger>
                </TabsList>
                <Button variant="outline" size="sm" onClick={exportPDF}>
                  <FileText style={{ width: 16, height: 16 }} /> Export PDF report
                </Button>
              </div>

              <TabsContent value="table">
                <Card>
                  <CardContent style={{ paddingTop: 24, overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Method", "Input SNR", "Output SNR", "ΔSNR", "Time", "Rank"].map((h) => (
                            <th key={h} className="font-mono" style={{ textAlign: h === "Method" ? "left" : "right", padding: "8px 12px", fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {ranked.map(({ meta, res }, i) => (
                          <tr key={meta.key} style={{ borderBottom: i < ranked.length - 1 ? "1px solid oklch(0.30 0.02 250 / 0.4)" : undefined }}>
                            <td style={{ padding: "12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.colorVar, display: "inline-block" }} />
                                <span style={{ fontFamily: "inherit" }}>{meta.index}. {meta.name}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: "right", padding: "12px" }}>{audio.inputSNR.toFixed(2)} dB</td>
                            <td style={{ textAlign: "right", padding: "12px" }}>{res.outSNR.toFixed(2)} dB</td>
                            <td style={{ textAlign: "right", padding: "12px", fontWeight: 600, color: meta.colorVar }}>
                              {res.deltaSNR >= 0 ? "+" : ""}{res.deltaSNR.toFixed(2)} dB
                            </td>
                            <td style={{ textAlign: "right", padding: "12px", color: "var(--muted-foreground)" }}>{res.timeMs.toFixed(1)} ms</td>
                            <td style={{ textAlign: "right", padding: "12px" }}>
                              <Badge variant={i === 0 ? "default" : "secondary"}>#{i + 1}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="overlay">
                <Card>
                  <CardContent style={{ paddingTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                    <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      All four waveforms overlaid on the same time axis. Look for reduced amplitude excursions in silent regions to visualize noise removal.
                    </p>
                    <div style={{ position: "relative" }}>
                      <Waveform samples={audio.samples} color="var(--waveform)" height={160} />
                      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.7 }}>
                        {METHODS.map((m) => (
                          <Waveform key={m.key} samples={audio.results[m.key].samples} color={m.colorVar} height={160} className="absolute inset-0" />
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
                      <Legend color="var(--waveform)" label="Original" />
                      {METHODS.map((m) => <Legend key={m.key} color={m.colorVar} label={m.name} />)}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="model">
                <Card>
                  <CardContent style={{ paddingTop: 24, display: "flex", flexDirection: "column", gap: 16, fontSize: 14 }}>
                    <div>
                      <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Signal model</h3>
                      <code style={{ fontFamily: "monospace", fontSize: 16, background: "oklch(0.24 0.025 250 / 0.4)", padding: "6px 12px", borderRadius: 6, display: "inline-block" }}>y(t) = x(t) + b(t)</code>
                      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>
                        Observed signal y(t) is the clean speech x(t) corrupted by additive noise b(t). Applied to speech signals sampled at 8000 Hz.
                      </p>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                      {METHODS.map((m) => (
                        <div key={m.key} style={{ borderRadius: 8, border: "1px solid var(--border)", padding: 12, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, color: m.colorVar }}>{m.name}</div>
                          <p style={{ color: "var(--muted-foreground)", margin: 0 }}>{m.description}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: "var(--muted-foreground)", fontStyle: "italic" }}>
                      Based on practical implementation from a master&apos;s thesis on audio denoising.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
      <footer style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted-foreground)", fontSize: 13 }}>
        Made by <br></br> Bouakline Katia <br></br> Alimohad Sali <br></br> Haouach Amira
            
      </footer>
    </div>
  );
}

function UploadHero({ processing, progress, onUpload }: {
  processing: boolean;
  progress: Record<MethodKey, number>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div style={{ maxWidth: 768, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", gap: 32, paddingTop: 24, paddingBottom: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Badge variant="secondary" style={{ margin: "0 auto", fontFamily: "monospace", display: "inline-flex" }}>
          <Activity style={{ width: 12, height: 12 }} /> y(t) = x(t) + b(t)
        </Badge>
        <h2 style={{ fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.15 }}>
          Three denoising methods.<br />
          <span style={{ color: "var(--primary)" }}>One verdict.</span>
        </h2>
        <p style={{ fontSize: 15, color: "var(--muted-foreground)", maxWidth: 520, margin: "0 auto" }}>
          Upload a noisy audio file. We&apos;ll run Butterworth, Gaussian FFT, and Wiener filters in
          parallel, compute SNR for each, and recommend the best.
        </p>
      </div>

      <label style={{
        display: "block", border: "2px dashed var(--border)", borderRadius: 16,
        padding: "40px 24px", cursor: "pointer", transition: "all 0.2s",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "oklch(0.72 0.18 215 / 0.6)"; e.currentTarget.style.background = "oklch(0.72 0.18 215 / 0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "transparent"; }}
      >
        <input type="file" accept="audio/wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/m4a,.wav,.mp3,.m4a"
          style={{ display: "none" }} onChange={onUpload} disabled={processing} />
        <Upload style={{ width: 40, height: 40, margin: "0 auto 12px", color: "var(--muted-foreground)" }} />
        <div style={{ fontWeight: 500 }}>Drop a WAV, MP3, or M4A file</div>
        <div className="font-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
          max 10 MB · mono channel used · 8 kHz recommended
        </div>
      </label>

      {processing && (
        <Card>
          <CardContent style={{ paddingTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            {METHODS.map((m) => (
              <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: m.colorVar }}>{m.name}</span>
                  <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>{progress[m.key]}%</span>
                </div>
                <Progress value={progress[m.key]} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, textAlign: "left" }}>
        {METHODS.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.key} style={{ borderRadius: 12, border: "1px solid var(--border)", padding: 16, background: "oklch(0.20 0.025 250 / 0.5)" }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, display: "grid", placeItems: "center", marginBottom: 12, background: m.softVar, color: m.colorVar }}>
                <Icon style={{ width: 16, height: 16 }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
              <div className="font-mono" style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>{m.tagline}</div>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>{m.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationBanner({ best, bestResult }: { best: MethodMeta; bestResult: MethodResult }) {
  return (
    <div style={{
      borderRadius: 16, padding: 20, border: `1px solid ${best.colorVar}`,
      display: "flex", alignItems: "center", gap: 16, position: "relative", overflow: "hidden",
      background: `linear-gradient(90deg, ${best.softVar}, transparent 70%)`,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0, background: best.colorVar, color: "var(--background)" }}>
        <Trophy style={{ width: 24, height: 24 }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span className="font-mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)" }}>Winner</span>
          <Badge style={{ fontFamily: "monospace", fontSize: 10, background: best.colorVar, color: "var(--background)", border: "none" }}>BEST METHOD</Badge>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          {best.name}{" "}
          <span style={{ color: "var(--muted-foreground)", fontWeight: 400, fontSize: 14 }}>
            — ΔSNR{" "}
            <span className="font-mono" style={{ color: best.colorVar, fontWeight: 600 }}>
              {bestResult.deltaSNR >= 0 ? "+" : ""}{bestResult.deltaSNR.toFixed(2)} dB
            </span>
          </span>
        </h3>
        <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "4px 0 0" }}>
          {best.key === "wiener"
            ? "Wiener filter provides optimal SNR improvement with adaptive noise reduction."
            : best.key === "gaussian"
              ? "Gaussian FFT delivers the highest SNR improvement on this signal with smooth spectral attenuation."
              : "Butterworth low-pass yields the strongest SNR improvement on this signal."}
        </p>
      </div>
    </div>
  );
}

function MetaRow({ audio }: { audio: AudioState }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
      <Meta label="Duration" value={`${audio.duration.toFixed(2)} s`} />
      <Meta label="Sample rate" value={`${audio.sampleRate} Hz`} />
      <Meta label="Bit depth" value="32f → 16" />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 6, background: "oklch(0.24 0.025 250 / 0.4)", padding: "6px 8px" }}>
      <div className="font-mono" style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function Stat({ label, value, suffix, accent }: { label: string; value: string; suffix?: string; accent?: string }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted-foreground)", letterSpacing: "0.05em" }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 14, color: accent }}>
        {value}{suffix && <span style={{ fontSize: 10, color: "var(--muted-foreground)", marginLeft: 2 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 16, height: 2, background: color, display: "inline-block" }} />
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
    </div>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
