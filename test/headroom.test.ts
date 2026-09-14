import { describe, it, expect } from 'vitest';
import { keepBusiest, OTHER_VOICE, CLUSTER_HEADROOM } from '../src/engine/clustering.js';

/**
 * The failure this exists for: three people at a table with a television
 * playing a two-person dialogue. Cutting at exactly three forced five voices
 * into three groups, and two of the three people were merged together.
 */
describe('keepBusiest', () => {
  it('discards the quietest clusters when there are more than there are people', () => {
    const labels = [0, 0, 0, 1, 1, 2, 3, 4];
    const durations = [5000, 5000, 5000, 4000, 4000, 3000, 500, 400];
    const out = keepBusiest(labels, durations, 3);
    expect(out.slice(0, 6)).toEqual([0, 0, 0, 1, 1, 2]);
    expect(out.slice(6)).toEqual([OTHER_VOICE, OTHER_VOICE]);
  });

  it('renumbers by how much each speaks, busiest first', () => {
    const labels = [7, 7, 3, 9];
    const durations = [1000, 1000, 5000, 100];
    expect(keepBusiest(labels, durations, 2)).toEqual([1, 1, 0, OTHER_VOICE]);
  });

  it('keeps everything when there are no more clusters than people', () => {
    const labels = [0, 0, 1, 1];
    const out = keepBusiest(labels, [1000, 1000, 2000, 2000], 4);
    expect(out.filter((l) => l === OTHER_VOICE)).toHaveLength(0);
    expect(new Set(out).size).toBe(2);
  });

  it('measures by total speech, not by number of stretches', () => {
    // One long turn beats three short interjections.
    const labels = [0, 1, 1, 1];
    const durations = [9000, 500, 500, 500];
    expect(keepBusiest(labels, durations, 1)).toEqual([0, OTHER_VOICE, OTHER_VOICE, OTHER_VOICE]);
  });

  it('handles empty input and a zero count', () => {
    expect(keepBusiest([], [], 3)).toEqual([]);
    expect(keepBusiest([0, 1], [10, 10], 0)).toEqual([OTHER_VOICE, OTHER_VOICE]);
  });

  it('allows enough headroom for a television, which is two voices', () => {
    expect(CLUSTER_HEADROOM).toBeGreaterThanOrEqual(2);
  });
});
