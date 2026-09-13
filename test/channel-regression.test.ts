import { describe, it, expect } from 'vitest';
import fixture from './fixtures/channel-embeddings.json' with { type: 'json' };
import { agglomerative, centreEmbeddings } from '../src/engine/clustering.js';

/**
 * Regression test for the failure Ronda's first real users hit: on a recording
 * that had been through a phone codec, one person was credited with nearly the
 * whole conversation.
 *
 * The cause was not that a speaker "won". Average-linkage clustering stopped
 * separating people and started isolating two outlier segments, leaving both
 * speakers mixed together in the other cluster. Centring the embeddings —
 * removing the component they all share — restores the split.
 *
 * These are real embeddings from Ronda's own pipeline. Every synthetic fixture
 * tried reproduced the arithmetic but not the failure, because a uniform
 * additive bias compresses all distances equally and leaves their ordering, and
 * therefore the clustering, intact.
 */
describe('band-limited recording regression', () => {
  const vectors = (fixture.vectors as number[][]).map((v) => Float32Array.from(v));
  const durations = fixture.durationsMs as number[];

  const shares = (labels: readonly number[]): number[] => {
    const byLabel = new Map<number, number>();
    labels.forEach((l, i) => byLabel.set(l, (byLabel.get(l) ?? 0) + (durations[i] ?? 0)));
    const total = [...byLabel.values()].reduce((a, b) => a + b, 0);
    return [...byLabel.values()].map((t) => Math.round((t / total) * 100)).sort((a, b) => b - a);
  };

  it('reproduces the failure when embeddings are not centred', () => {
    const split = shares(agglomerative(vectors, { k: 2 }));
    expect(split[0], 'the original bug: one speaker takes almost everything').toBeGreaterThan(85);
  });

  it('splits the two speakers once the shared channel is removed', () => {
    const split = shares(agglomerative(centreEmbeddings(vectors), { k: 2 }));
    expect(split[0], `got ${split.join('/')}`).toBeLessThan(70);
    expect(split[1], `got ${split.join('/')}`).toBeGreaterThan(30);
  });

  it('gives both speakers a fair number of segments, not one and the rest', () => {
    const labels = agglomerative(centreEmbeddings(vectors), { k: 2 });
    const counts = [0, 1].map((l) => labels.filter((x) => x === l).length);
    expect(Math.min(...counts), `segment counts ${counts.join('/')}`).toBeGreaterThanOrEqual(3);
  });
});
