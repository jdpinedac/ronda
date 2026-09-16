import { describe, it, expect } from 'vitest';
import {
  cosineDistance, normalise, agglomerative, absorbTinyClusters,
  resolveSpeakerCount, DEFAULT_THRESHOLD, centreEmbeddings,
  splinterHeadroom, placeSplinters, OTHER_VOICE,
} from '../src/engine/clustering.js';

/**
 * Deterministic synthetic speakers in embedding space.
 *
 * Centres occupy disjoint coordinate blocks so they are mutually orthogonal
 * (cosine distance 1.0). This reproduces the regime ADR 0001 measured on real
 * recordings — different speakers at 0.86-0.99, same speaker at 0.23-0.34 —
 * rather than random vectors, which land much closer together by chance and
 * would test the clusterer against a problem it will never face.
 */
function makeVoices(numSpeakers: number, perSpeaker: number, noise = 0.15, dim = 64) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const block = Math.floor(dim / numSpeakers);
  const centres = Array.from({ length: numSpeakers }, (_, s) => {
    const v = new Float32Array(dim);
    for (let i = s * block; i < (s + 1) * block; i++) v[i] = rnd() + 0.5;
    return normalise(v);
  });

  const vectors: Float32Array[] = [];
  const truth: number[] = [];
  for (let s = 0; s < numSpeakers; s++) {
    for (let i = 0; i < perSpeaker; i++) {
      const v = Float32Array.from(centres[s]!, (x) => x + (rnd() * 2 - 1) * noise);
      vectors.push(normalise(v));
      truth.push(s);
    }
  }
  return { vectors, truth };
}

/** Clustering labels are arbitrary; compare the partitions they induce. */
function samePartition(a: readonly number[], b: readonly number[]): boolean {
  const map = new Map<number, number>();
  const seen = new Set<number>();
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (map.has(x)) { if (map.get(x) !== y) return false; }
    else { if (seen.has(y)) return false; map.set(x, y); seen.add(y); }
  }
  return true;
}

describe('cosineDistance', () => {
  it('is zero for identical direction and one for orthogonal', () => {
    const a = normalise(new Float32Array([1, 0, 0]));
    const b = normalise(new Float32Array([2, 0, 0]));
    const c = normalise(new Float32Array([0, 1, 0]));
    expect(cosineDistance(a, b)).toBeCloseTo(0, 6);
    expect(cosineDistance(a, c)).toBeCloseTo(1, 6);
  });

  it('reaches two for opposite directions', () => {
    const a = normalise(new Float32Array([1, 0]));
    const b = normalise(new Float32Array([-1, 0]));
    expect(cosineDistance(a, b)).toBeCloseTo(2, 6);
  });
});

describe('agglomerative with a known speaker count', () => {
  it('recovers three speakers exactly', () => {
    const { vectors, truth } = makeVoices(3, 5);
    expect(samePartition(agglomerative(vectors, { k: 3 }), truth)).toBe(true);
  });

  it('recovers five speakers exactly', () => {
    const { vectors, truth } = makeVoices(5, 4);
    expect(samePartition(agglomerative(vectors, { k: 5 }), truth)).toBe(true);
  });

  it('never returns more clusters than requested', () => {
    const { vectors } = makeVoices(4, 3);
    expect(new Set(agglomerative(vectors, { k: 2 })).size).toBe(2);
  });

  it('handles k larger than the number of samples', () => {
    const { vectors } = makeVoices(2, 1);
    expect(new Set(agglomerative(vectors, { k: 10 })).size).toBe(2);
  });

  it('handles empty input', () => {
    expect(agglomerative([], { k: 3 })).toEqual([]);
  });
});

describe('agglomerative at conversation scale', () => {
  /**
   * The live path re-clusters every voice sample heard so far after each
   * 10-second block. An hour-long conversation is a few hundred samples, and
   * a phone has one slow core, so this has to stay well under a block.
   */
  it('clusters 300 samples in under a second', () => {
    const { vectors, truth } = makeVoices(4, 75, 0.15, 256);
    const started = performance.now();
    const labels = agglomerative(vectors, { k: 4 });
    const elapsed = performance.now() - started;
    expect(samePartition(labels, truth)).toBe(true);
    expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(1000);
  });
});

describe('agglomerative with a threshold', () => {
  it('finds the right count when voices are well separated', () => {
    const { vectors, truth } = makeVoices(3, 5, 0.1);
    expect(samePartition(agglomerative(vectors, { threshold: DEFAULT_THRESHOLD }), truth)).toBe(true);
  });

  it('merges everything when the threshold is wide open', () => {
    const { vectors } = makeVoices(4, 3);
    expect(new Set(agglomerative(vectors, { threshold: 2 })).size).toBe(1);
  });

  it('splits everything when the threshold is zero', () => {
    const { vectors } = makeVoices(3, 3);
    expect(new Set(agglomerative(vectors, { threshold: 0 })).size).toBe(vectors.length);
  });
});

describe('absorbTinyClusters', () => {
  it('folds a one-segment cluster into its nearest neighbour', () => {
    const { vectors } = makeVoices(2, 4);
    const labels = [0, 0, 0, 0, 1, 1, 1, 2]; // index 7 is a spurious singleton
    const durations = [2000, 2000, 2000, 2000, 2000, 2000, 2000, 900];
    const out = absorbTinyClusters(vectors, labels, durations, { minSegments: 2, minDurationMs: 1500 });
    expect(new Set(out).size).toBe(2);
    expect(out[7]).not.toBe(2);
  });

  it('leaves healthy clusters alone', () => {
    const { vectors, truth } = makeVoices(2, 4);
    const durations = vectors.map(() => 3000);
    const out = absorbTinyClusters(vectors, truth, durations, { minSegments: 2, minDurationMs: 1500 });
    expect(samePartition(out, truth)).toBe(true);
  });

  it('keeps a short cluster that has enough segments', () => {
    const { vectors, truth } = makeVoices(2, 4);
    const durations = vectors.map(() => 700);
    const out = absorbTinyClusters(vectors, truth, durations, { minSegments: 2, minDurationMs: 1500 });
    expect(new Set(out).size).toBe(2);
  });

  it('never empties the last cluster', () => {
    const { vectors } = makeVoices(1, 2);
    const out = absorbTinyClusters(vectors, [0, 0], [100, 100], { minSegments: 5, minDurationMs: 9999 });
    expect(new Set(out).size).toBe(1);
  });
});

describe('DEFAULT_THRESHOLD against the regime measured in ADR 0001', () => {
  // Real recordings: same speaker 0.23-0.34 apart, different speakers 0.86-0.99.
  it('sits above every same-speaker distance and below every different-speaker one', () => {
    expect(DEFAULT_THRESHOLD).toBeGreaterThan(0.34);
    expect(DEFAULT_THRESHOLD).toBeLessThan(0.86);
  });

  it('separates correctly at the measured extremes', () => {
    const a = normalise(new Float32Array([1, 0, 0, 0]));
    const sameSpeaker = normalise(new Float32Array([1, 0.6, 0, 0]));   // ~0.34 away
    const otherSpeaker = normalise(new Float32Array([0.15, 1, 0, 0])); // ~0.85 away
    expect(cosineDistance(a, sameSpeaker)).toBeLessThan(DEFAULT_THRESHOLD);
    expect(cosineDistance(a, otherSpeaker)).toBeGreaterThan(DEFAULT_THRESHOLD);
  });
});

describe('resolveSpeakerCount — the tiered strategy from ADR 0001', () => {
  it('prefers calibrated profiles above all', () => {
    const r = resolveSpeakerCount({ names: ['Ana', 'Juan'], calibratedProfiles: 3 });
    expect(r).toEqual({ k: 3, source: 'calibration', confident: true });
  });

  it('falls back to the number of names typed', () => {
    const r = resolveSpeakerCount({ names: ['Ana', 'Juan', 'Marta'] });
    expect(r).toEqual({ k: 3, source: 'names', confident: true });
  });

  it('goes automatic when nothing is known', () => {
    const r = resolveSpeakerCount({});
    expect(r).toEqual({ k: null, source: 'automatic', confident: false });
  });

  it('ignores a single name, which says nothing about the group', () => {
    expect(resolveSpeakerCount({ names: ['Ana'] }).source).toBe('automatic');
  });

  it('takes an explicit head count over the names typed', () => {
    const r = resolveSpeakerCount({ speakerCount: 4, names: ['Ana', 'Juan'] });
    expect(r).toEqual({ k: 4, source: 'count', confident: true });
  });

  it('still lets calibrated profiles beat an explicit head count', () => {
    expect(resolveSpeakerCount({ speakerCount: 4, calibratedProfiles: 3 }).k).toBe(3);
  });

  it('ignores a head count below two, which leaves nothing to split', () => {
    expect(resolveSpeakerCount({ speakerCount: 1 }).source).toBe('automatic');
    expect(resolveSpeakerCount({ speakerCount: 0, names: ['Ana', 'Juan'] }).k).toBe(2);
  });

  it('ignores a head count that is not a whole number', () => {
    expect(resolveSpeakerCount({ speakerCount: Number.NaN }).source).toBe('automatic');
    expect(resolveSpeakerCount({ speakerCount: 3.5 }).source).toBe('automatic');
  });

  it('ignores blank entries from a trailing comma', () => {
    expect(resolveSpeakerCount({ names: ['Ana', 'Juan', '', '  '] })).toEqual({
      k: 2, source: 'names', confident: true,
    });
  });
});

describe('centreEmbeddings', () => {
  /**
   * The behavioural test for this lives in channel-regression.test.ts, against
   * real embeddings. Synthetic fixtures could not reproduce the failure: a
   * uniform additive bias compresses every distance by the same factor and
   * leaves their ordering — and therefore the clustering — unchanged. These
   * tests cover the function's contract only.
   */
  it('returns unit vectors', () => {
    const { vectors } = makeVoices(3, 4);
    for (const v of centreEmbeddings(vectors)) {
      expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
    }
  });

  it('removes the shared component', () => {
    const { vectors } = makeVoices(3, 4);
    const centred = centreEmbeddings(vectors);
    const dim = centred[0]!.length;
    for (let i = 0; i < dim; i++) {
      const mean = centred.reduce((s, v) => s + v[i]!, 0) / centred.length;
      expect(Math.abs(mean)).toBeLessThan(0.2);
    }
  });

  it('preserves correct groupings on clean data', () => {
    const { vectors, truth } = makeVoices(3, 4, 0.1);
    expect(samePartition(agglomerative(centreEmbeddings(vectors), { k: 3 }), truth)).toBe(true);
  });

  it('refuses to centre too few vectors, where the mean is meaningless', () => {
    const { vectors } = makeVoices(2, 1);
    expect(centreEmbeddings(vectors)).toEqual(vectors);
    expect(centreEmbeddings([])).toEqual([]);
  });
});

describe('splinterHeadroom', () => {
  it('asks for no extra groups while there is little evidence', () => {
    expect(splinterHeadroom(0)).toBe(0);
    expect(splinterHeadroom(24)).toBe(0);
  });

  it('grows with the number of voice samples', () => {
    expect(splinterHeadroom(25)).toBe(1);
    expect(splinterHeadroom(55)).toBe(2);
    expect(splinterHeadroom(178)).toBe(7);
  });

  it('caps at eight', () => {
    expect(splinterHeadroom(227)).toBe(8);
    expect(splinterHeadroom(10_000)).toBe(8);
  });
});

describe('placeSplinters', () => {
  const { vectors } = makeVoices(2, 4);
  const durations = vectors.map(() => 2000);

  it('gives every unplaced segment to the nearest kept group', () => {
    // Speaker 0 is indices 0-3, speaker 1 is 4-7. Two of each are unplaced.
    const labels = [0, 0, OTHER_VOICE, OTHER_VOICE, 1, 1, OTHER_VOICE, OTHER_VOICE];
    expect(placeSplinters(vectors, labels, durations)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('leaves placed segments alone', () => {
    const labels = [0, 0, 0, 0, 1, 1, 1, OTHER_VOICE];
    expect(placeSplinters(vectors, labels, durations).slice(0, 7)).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  it('changes nothing when nothing is unplaced', () => {
    const labels = [0, 0, 0, 0, 1, 1, 1, 1];
    expect(placeSplinters(vectors, labels, durations)).toEqual(labels);
  });

  it('changes nothing when there is no group to place into', () => {
    const labels = vectors.map(() => OTHER_VOICE);
    expect(placeSplinters(vectors, labels, durations)).toEqual(labels);
  });
});
