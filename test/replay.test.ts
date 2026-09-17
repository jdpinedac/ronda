import { describe, it, expect } from 'vitest';
import { replayLive } from '../bench/replay.js';

/**
 * A diagnostics export holds each sample's final identity, not its history.
 * The replay re-runs the live clustering window by window on the exported
 * embeddings and reports what a user actually watched: when each identity
 * (and so each name) first appeared, and how often samples changed hands.
 */
const dim = 8;
/** A unit vector along one axis, nudged so no two samples are identical. */
function voice(axis: number, i: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  v[(axis + 1) % dim] = 0.05 * ((i % 3) - 1);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
/** One sample per 5 s window, from a list of who spoke in each. */
function bundle(order: readonly number[], speakerCount: number) {
  return {
    speakerCount,
    backgroundVoices: false,
    spans: order.map((_, i) => ({ startMs: i * 5000 + 1000, endMs: Math.min(i * 5000 + 4000, 7500 + i * 5000) })),
    durationsMs: order.map(() => 3000),
    vectors: order.map((who, i) => voice(who, i)),
    identities: [] as number[],
  };
}

describe('replayLive', () => {
  it('reproduces one identity per person when each has spoken before the cut is forced', () => {
    const r = replayLive(bundle([0, 1, 0, 1, 0, 1], 2));
    expect(new Set(r.identities).size).toBe(2);
    expect(r.relabelled).toBe(0);
    expect(r.firstSeenMs.size).toBe(2);
  });

  it('shows the head count minting identities before that many people have spoken', () => {
    // Two voices only, three people declared: by the third window all three
    // identities exist, two of them fragments of the same person.
    const r = replayLive(bundle([0, 0, 1, 1, 0, 1, 0, 1], 3));
    expect(r.firstSeenMs.size).toBe(3);
    const third = [...r.firstSeenMs.values()].sort((a, b) => a - b)[2]!;
    expect(third).toBeLessThanOrEqual(17_500);
    expect(r.identities).toHaveLength(8);
  });

  it('counts a sample changing identity as one relabelling', () => {
    // Same run: the fragment identities get re-sorted as evidence arrives.
    const r = replayLive(bundle([0, 0, 1, 1, 0, 1, 0, 1], 3));
    expect(r.relabelled).toBeGreaterThan(0);
    // Every identity records which final groups it held at some point.
    for (const held of r.heldFinal.values()) expect(held.size).toBeGreaterThanOrEqual(1);
  });
});
