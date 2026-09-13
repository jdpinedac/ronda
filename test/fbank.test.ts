import { describe, it, expect } from 'vitest';
import fixture from './fixtures/fbank.json' with { type: 'json' };
import { computeFbank, WESPEAKER_FBANK } from '../src/engine/fbank.js';

/** mulberry32 — must match spike/05-make-fixtures.js exactly. */
function prng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSignal(n = 16000, seed = 42): Float32Array {
  const rnd = prng(seed);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    a[i] = 0.35 * Math.sin(2 * Math.PI * 140 * t)
         + 0.2 * Math.sin(2 * Math.PI * 700 * t)
         + 0.12 * Math.sin(2 * Math.PI * 2300 * t)
         + 0.05 * (rnd() * 2 - 1);
  }
  return a;
}

describe('computeFbank against the transformers.js oracle', () => {
  const signal = makeSignal();
  const expectedDims = fixture.dims as [number, number, number];
  const [, expectedFrames, expectedBins] = expectedDims;

  it('produces the same number of frames and bins', () => {
    const { frames, numBins } = computeFbank(signal, WESPEAKER_FBANK);
    expect(numBins).toBe(expectedBins);
    expect(frames.length / numBins).toBe(expectedFrames);
  });

  it('matches every coefficient within tolerance', () => {
    const { frames } = computeFbank(signal, WESPEAKER_FBANK);
    const expected = fixture.features as number[];
    expect(frames.length).toBe(expected.length);

    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i < expected.length; i++) {
      const d = Math.abs(frames[i]! - expected[i]!);
      if (d > worst) { worst = d; worstAt = i; }
    }
    expect(worst, `largest deviation ${worst} at index ${worstAt} ` +
      `(frame ${Math.floor(worstAt / expectedBins)}, bin ${worstAt % expectedBins})`).toBeLessThan(1e-3);
  });

  it('is deterministic', () => {
    const a = computeFbank(signal, WESPEAKER_FBANK).frames;
    const b = computeFbank(signal, WESPEAKER_FBANK).frames;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('returns no frames for audio shorter than one window', () => {
    const { frames } = computeFbank(new Float32Array(100), WESPEAKER_FBANK);
    expect(frames.length).toBe(0);
  });
});
