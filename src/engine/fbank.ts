/**
 * Kaldi-compatible log-mel filterbank features.
 *
 * WeSpeaker consumes 80-bin fbank computed the way Kaldi's compute-fbank-feats
 * does. The exact conventions matter — Kaldi differs from most textbook
 * implementations in several places (Povey/Hamming window scaling, per-frame DC
 * removal, pre-emphasis applied after DC removal, mel bins built on a triangular
 * basis over FFT bin centres). Every constant here is pinned by a golden fixture
 * in test/fixtures/fbank.json generated from transformers.js.
 */

export interface FbankConfig {
  sampleRate: number;
  frameLengthMs: number;
  frameShiftMs: number;
  numBins: number;
  lowFreq: number;
  /** Upper edge; <= 0 means Nyquist + highFreq, matching Kaldi. */
  highFreq: number;
  preEmphasis: number;
  removeDcOffset: boolean;
  /** Subtract each bin's mean across all frames (cepstral mean normalisation). */
  meanNormalise: boolean;
}

/** The configuration WeSpeaker's feature extractor uses. */
export const WESPEAKER_FBANK: FbankConfig = {
  sampleRate: 16000,
  frameLengthMs: 25,
  frameShiftMs: 10,
  numBins: 80,
  lowFreq: 20,
  highFreq: 0,
  preEmphasis: 0.97,
  removeDcOffset: true,
  meanNormalise: true,
};

export interface FbankResult {
  /** Row-major [frame][bin], length = numFrames * numBins. */
  frames: Float32Array;
  numBins: number;
}

const melOf = (hz: number) => 1127 * Math.log(1 + hz / 700);

/** Smallest power of two >= n, as Kaldi's round_to_power_of_two does. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Kaldi's "hamming" window: 0.54 - 0.46 cos(2*pi*i/(N-1)). */
function hammingWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  const a = (2 * Math.PI) / (n - 1);
  for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos(a * i);
  return w;
}

/**
 * Triangular mel filterbank over the FFT bins, built the way Kaldi does:
 * centres are equally spaced on the mel scale, and each filter rises linearly
 * in mel space from the previous centre and falls to the next.
 */
function melBanks(cfg: FbankConfig, nFft: number): { offsets: Int32Array; weights: Float32Array[] } {
  const nyquist = cfg.sampleRate / 2;
  const high = cfg.highFreq <= 0 ? nyquist + cfg.highFreq : cfg.highFreq;
  const numFftBins = nFft / 2;
  const fftBinWidth = cfg.sampleRate / nFft;

  const melLow = melOf(cfg.lowFreq);
  const melHigh = melOf(high);
  const melDelta = (melHigh - melLow) / (cfg.numBins + 1);

  const offsets = new Int32Array(cfg.numBins);
  const weights: Float32Array[] = [];

  for (let b = 0; b < cfg.numBins; b++) {
    const leftMel = melLow + b * melDelta;
    const centerMel = leftMel + melDelta;
    const rightMel = centerMel + melDelta;

    const acc: number[] = [];
    let first = -1;
    for (let i = 0; i < numFftBins; i++) {
      const mel = melOf(fftBinWidth * i);
      if (mel <= leftMel || mel >= rightMel) continue;
      const w = mel <= centerMel
        ? (mel - leftMel) / (centerMel - leftMel)
        : (rightMel - mel) / (rightMel - centerMel);
      if (first < 0) first = i;
      acc.push(w);
    }
    offsets[b] = first < 0 ? 0 : first;
    weights.push(Float32Array.from(acc));
  }
  return { offsets, weights };
}

/** In-place iterative radix-2 FFT on split real/imaginary arrays. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k]!;
        const aIm = im[i + k]!;
        const bRe = re[i + k + len / 2]! * curRe - im[i + k + len / 2]! * curIm;
        const bIm = re[i + k + len / 2]! * curIm + im[i + k + len / 2]! * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const LOG_FLOOR = Math.log(1.1920928955078125e-7); // Kaldi's epsilon floor

export function computeFbank(audio: Float32Array, cfg: FbankConfig): FbankResult {
  const frameLen = Math.round((cfg.sampleRate * cfg.frameLengthMs) / 1000);
  const frameShift = Math.round((cfg.sampleRate * cfg.frameShiftMs) / 1000);

  // snip_edges: only whole windows count.
  const numFrames = audio.length < frameLen ? 0 : 1 + Math.floor((audio.length - frameLen) / frameShift);
  if (numFrames <= 0) return { frames: new Float32Array(0), numBins: cfg.numBins };

  const nFft = nextPow2(frameLen);
  const window = hammingWindow(frameLen);
  const { offsets, weights } = melBanks(cfg, nFft);

  const out = new Float32Array(numFrames * cfg.numBins);
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);
  const power = new Float32Array(nFft / 2);

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameShift;
    re.fill(0);
    im.fill(0);

    let mean = 0;
    if (cfg.removeDcOffset) {
      for (let i = 0; i < frameLen; i++) mean += audio[start + i]!;
      mean /= frameLen;
    }
    for (let i = 0; i < frameLen; i++) re[i] = audio[start + i]! - mean;

    // Pre-emphasis, Kaldi order: after DC removal, before windowing, with the
    // first sample using itself as the previous value.
    if (cfg.preEmphasis > 0) {
      for (let i = frameLen - 1; i > 0; i--) re[i] = re[i]! - cfg.preEmphasis * re[i - 1]!;
      re[0] = re[0]! - cfg.preEmphasis * re[0]!;
    }
    for (let i = 0; i < frameLen; i++) re[i] = re[i]! * window[i]!;

    fft(re, im);
    for (let i = 0; i < nFft / 2; i++) power[i] = re[i]! * re[i]! + im[i]! * im[i]!;

    for (let b = 0; b < cfg.numBins; b++) {
      const off = offsets[b]!;
      const w = weights[b]!;
      let sum = 0;
      for (let i = 0; i < w.length; i++) sum += w[i]! * power[off + i]!;
      out[f * cfg.numBins + b] = sum > 0 ? Math.log(sum) : LOG_FLOOR;
    }
  }

  if (cfg.meanNormalise) {
    for (let b = 0; b < cfg.numBins; b++) {
      let sum = 0;
      for (let f = 0; f < numFrames; f++) sum += out[f * cfg.numBins + b]!;
      const m = sum / numFrames;
      for (let f = 0; f < numFrames; f++) {
        const i = f * cfg.numBins + b;
        out[i] = out[i]! - m;
      }
    }
  }

  return { frames: out, numBins: cfg.numBins };
}
