import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { startLiveSession, type LiveState } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * A speaker's id must survive re-clustering. Every window, all samples are
 * clustered again from scratch and the groups come back numbered by how much
 * each has spoken — so when one person overtakes another, their numbers, and
 * with them the colours and names on screen, swap. Ids are now carried across
 * updates by matching each new group with the old one it shares most speech
 * with, so the person who was "1" stays "1".
 */
// A leads, then B overtakes, then A speaks again alone.
const CONVERSATION = conversation([
  ['A', 8], ['B', 2], ['A', 4],      // 14 s: A 12, B 2
  ['B', 16],                          // 30 s: A 12, B 18 — B has overtaken
  ['A', 4], ['-', 1],                 // 35 s: A speaks alone again
]);

async function updates(audio: Float32Array): Promise<LiveState[]> {
  const session = await startLiveSession({ speakerCount: 2 });
  const seen: LiveState[] = [];
  session.onUpdate((s) => seen.push(s));
  for (let off = 0; off < audio.length; off += 16000) session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = seen.length; await new Promise((r) => setTimeout(r, 20)); if (seen.length === n) break; }
  await session.flush();
  session.dispose();
  return seen;
}

describe('speaker ids in the live path', () => {
  it('keep pointing at the same person after another overtakes them', async () => {
    const seen = await updates(CONVERSATION);
    const activeAt = (s: LiveState) => s.speakers.find((x) => x.active)?.id;
    // Updates arrive one per 5 s window. The second covers 7.5-12.5 s, where
    // A is the last to speak; the final one covers the tail, where only A
    // speaks again — after B has overtaken.
    const early = seen[1]!;
    const late = seen[seen.length - 1]!;
    expect(activeAt(early)).toBeDefined();
    // The scenario holds: at the end the active speaker (A) is not the busiest (B).
    const busiest = [...late.speakers].sort((a, b) => b.totalMs - a.totalMs)[0]!.id;
    expect(busiest).not.toBe(activeAt(late));
    expect(activeAt(late)).toBe(activeAt(early));
    // And B, who overtook, is the other id in both.
    const idsEarly = early.speakers.map((x) => x.id).sort();
    const idsLate = late.speakers.map((x) => x.id).sort();
    expect(idsLate).toEqual(idsEarly);
  });

  it('never shrink a speaker\'s time: an id accumulates, it is not handed over', async () => {
    const seen = await updates(CONVERSATION);
    const last = new Map<number, number>();
    for (const s of seen) for (const sp of s.speakers) {
      expect(sp.totalMs, `id ${sp.id} at ${s.elapsedMs} ms`).toBeGreaterThanOrEqual(last.get(sp.id) ?? 0);
      last.set(sp.id, sp.totalMs);
    }
  });
});
