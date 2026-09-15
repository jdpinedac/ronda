import { describe, it, expect } from 'vitest';
import fixture from '../bench/fixtures/ami-ES2004a-embeddings.json' with { type: 'json' };
import {
  agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom,
} from '../src/engine/clustering.js';

/**
 * Regression test for the failure long conversations hit: on the whole of a
 * four-person meeting, with the head count given, cutting the dendrogram at
 * four merged two real people into one group while a fourth group collected
 * outliers of the other two. See ADR 0005.
 *
 * These are the 227 real embeddings Ronda extracts from AMI ES2004a, each
 * labelled with the annotated speaker. Short excerpts of the same meeting do
 * not show the failure, which is why the whole meeting is kept.
 */
describe('full meeting regression (ES2004a, four people, 17.5 min)', () => {
  const vectors = centreEmbeddings((fixture.vectors as number[][]).map((v) => Float32Array.from(v)));
  const durations = fixture.spans.map((s) => s.endMs - s.startMs);
  const truth = fixture.truthLabels as string[];
  const k = 4;

  /** The group holding most of a person's speech. */
  const homeOf = (labels: readonly number[], who: string): number => {
    const time = new Map<number, number>();
    labels.forEach((l, i) => { if (truth[i] === who) time.set(l, (time.get(l) ?? 0) + durations[i]!); });
    return [...time.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };
  /** Speech of `who` that did not land in their home group. */
  const strayMs = (labels: readonly number[], who: string): number => {
    const home = homeOf(labels, who);
    return labels.reduce((s, l, i) => s + (truth[i] === who && l !== home ? durations[i]! : 0), 0);
  };
  const people = ['FEE013', 'FEE016', 'MEE014', 'MEO015'];

  it('reproduces the failure when cutting at exactly the head count', () => {
    const labels = keepBusiest(agglomerative(vectors, { k }), durations, k);
    expect(homeOf(labels, 'MEE014'), 'the original bug: two men in one group').toBe(homeOf(labels, 'MEO015'));
  });

  it('keeps every person in a group of their own once splinters are placed back', () => {
    const wide = agglomerative(vectors, { k: k + splinterHeadroom(vectors.length) });
    const labels = placeSplinters(vectors, keepBusiest(wide, durations, k), durations);
    expect(new Set(labels).size).toBe(k);
    expect(new Set(people.map((p) => homeOf(labels, p))).size, 'each person has their own group').toBe(k);
  });

  it('leaves little of anyone outside their own group', () => {
    const wide = agglomerative(vectors, { k: k + splinterHeadroom(vectors.length) });
    const labels = placeSplinters(vectors, keepBusiest(wide, durations, k), durations);
    for (const p of people) {
      const own = labels.reduce((s, _, i) => s + (truth[i] === p ? durations[i]! : 0), 0);
      expect(strayMs(labels, p) / own, `${p} stray share`).toBeLessThan(0.2);
    }
  });
});
