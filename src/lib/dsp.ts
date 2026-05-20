// Digital Signal Processing utilities for audio denoising
// Implements three denoising methods: Butterworth LP, Gaussian FFT, Wiener filter

function nextPow2(n: number) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = cRe * re[b] - cIm * im[b];
        const tIm = cRe * im[b] + cIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function estimateSNR(signal: Float32Array, sampleRate: number, noiseMs = 100): number {
  const noiseLen = Math.min(
    Math.floor((noiseMs / 1000) * sampleRate),
    Math.floor(signal.length * 0.1),
  );
  if (noiseLen < 16) return 0;
  let noisePow = 0;
  for (let i = 0; i < noiseLen; i++) noisePow += signal[i] * signal[i];
  noisePow /= noiseLen;
  let sigPow = 0;
  for (let i = 0; i < signal.length; i++) sigPow += signal[i] * signal[i];
  sigPow /= signal.length;
  if (noisePow <= 1e-12) noisePow = 1e-12;
  const ratio = Math.max(sigPow / noisePow - 1, 1e-6);
  return 10 * Math.log10(ratio);
}

export function butterworthLowpass(
  input: Float32Array,
  sampleRate: number,
  cutoff = 3000,
): Float32Array {
  const qs = [0.54119610, 1.30656296];
  let data = new Float32Array(input);
  for (const Q of qs) {
    const w0 = (2 * Math.PI * cutoff) / sampleRate;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Q);
    const b0 = (1 - cosw) / 2;
    const b1 = 1 - cosw;
    const b2 = (1 - cosw) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;
    const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
    const out = new Float32Array(data.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
      out[i] = y0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
    data = out;
  }
  return data;
}

export function gaussianFFTFilter(
  input: Float32Array,
  sampleRate: number,
  sigmaHz = 3000,
): Float32Array {
  const n = nextPow2(input.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < input.length; i++) re[i] = input[i];
  fft(re, im, false);
  for (let k = 0; k < n; k++) {
    const freq = k <= n / 2 ? (k * sampleRate) / n : ((k - n) * sampleRate) / n;
    const g = Math.exp(-(freq * freq) / (2 * sigmaHz * sigmaHz));
    re[k] *= g;
    im[k] *= g;
  }
  fft(re, im, true);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = re[i];
  return out;
}

export function wienerFilter(
  input: Float32Array,
  sampleRate: number,
  order = 50,
): Float32Array {
  const frameSize = 512;
  const hop = 256;
  const nFFT = frameSize;
  const noiseLen = Math.min(Math.floor(0.1 * sampleRate), Math.floor(input.length * 0.1));

  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const noisePSD = new Float64Array(nFFT);
  let noiseFrames = 0;
  for (let start = 0; start + frameSize <= noiseLen; start += hop) {
    const re = new Float64Array(nFFT);
    const im = new Float64Array(nFFT);
    for (let i = 0; i < frameSize; i++) re[i] = input[start + i] * win[i];
    fft(re, im, false);
    for (let k = 0; k < nFFT; k++) noisePSD[k] += re[k] * re[k] + im[k] * im[k];
    noiseFrames++;
  }
  if (noiseFrames === 0) {
    for (let k = 0; k < nFFT; k++) noisePSD[k] = 1e-8;
  } else {
    for (let k = 0; k < nFFT; k++) noisePSD[k] /= noiseFrames;
  }

  const out = new Float32Array(input.length);
  const winSum = new Float32Array(input.length);
  const alpha = Math.min(0.98, Math.max(0.5, 1 - 1 / order));
  const smoothedPSD = new Float64Array(nFFT);
  let firstFrame = true;

  for (let start = 0; start + frameSize <= input.length; start += hop) {
    const re = new Float64Array(nFFT);
    const im = new Float64Array(nFFT);
    for (let i = 0; i < frameSize; i++) re[i] = input[start + i] * win[i];
    fft(re, im, false);

    for (let k = 0; k < nFFT; k++) {
      const py = re[k] * re[k] + im[k] * im[k];
      if (firstFrame) smoothedPSD[k] = py;
      else smoothedPSD[k] = alpha * smoothedPSD[k] + (1 - alpha) * py;
      const ps = Math.max(smoothedPSD[k] - noisePSD[k], 0);
      const denom = smoothedPSD[k] + 1e-12;
      const H = ps / denom;
      re[k] *= H;
      im[k] *= H;
    }
    firstFrame = false;

    fft(re, im, true);

    for (let i = 0; i < frameSize; i++) {
      const idx = start + i;
      if (idx < out.length) {
        out[idx] += re[i] * win[i];
        winSum[idx] += win[i] * win[i];
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (winSum[i] > 1e-6) out[i] /= winSum[i];
  }
  return out;
}

export function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
