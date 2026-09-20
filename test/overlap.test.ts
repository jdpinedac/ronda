import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { creditOverlap, assessOverlap, OVERLAP_LIMIT, type Span } from '../src/engine/segmentation.js';
import { OTHER_VOICE } from '../src/engine/clustering.js';
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * Overlap is speech the model hears as two voices at once. An embedding of the
 * mixture belongs to neither, so it cannot be clustered — but it can be
 * credited: measured against annotation, giving it to whoever held the floor
 * just before is right far more often than leaving it out. See ADR 0006.
 */
const one = (startMs: number, endMs: number): Span => ({ startMs, endMs, speakers: [0] });
const two = (startMs: number, endMs: number): Span => ({ startMs, endMs, speakers: [0, 1] });

describe('creditOverlap', () => {
  it('credits an overlap to the attributed span that ended most recently before it', () => {
    const attributed = [one(0, 2000), one(5000, 7000)];
    const { creditedMs, unattributedMs } = creditOverlap(attributed, [two(2000, 3000)]);
    expect(creditedMs).toEqual([1000, 0]);
    expect(unattributedMs).toBe(0);
  });

  it('accumulates several overlaps onto the same span', () => {
    const attributed = [one(0, 2000), one(9000, 10000)];
    const { creditedMs } = creditOverlap(attributed, [two(2500, 3000), two(4000, 5500)]);
    expect(creditedMs).toEqual([2000, 0]);
  });

  it('leaves overlap before the first attributed span unattributed', () => {
    const attributed = [one(3000, 5000)];
    const { creditedMs, unattributedMs } = creditOverlap(attributed, [two(1000, 2000)]);
    expect(creditedMs).toEqual([0]);
    expect(unattributedMs).toBe(1000);
  });

  it('picks the span before, not the one after, when the overlap sits between two', () => {
    const attributed = [one(0, 1000), one(1500, 3000)];
    const { creditedMs } = creditOverlap(attributed, [two(1000, 1500)]);
    expect(creditedMs).toEqual([500, 0]);
  });

  it('says which attributed span owns each overlap, or none', () => {
    const attributed = [one(0, 1000), one(1500, 3000)];
    const { ownerOf } = creditOverlap(attributed, [two(500, 600), two(1000, 1500), two(3000, 3500)]);
    expect(ownerOf).toEqual([-1, 0, 1]);
  });

  it('handles no overlaps and no attributed spans', () => {
    const a = creditOverlap([one(0, 1000)], []);
    expect(a.creditedMs).toEqual([0]);
    expect(a.unattributedMs).toBe(0);
    const b = creditOverlap([], [two(0, 1000)]);
    expect(b.creditedMs).toEqual([]);
    expect(b.unattributedMs).toBe(1000);
    expect(b.ownerOf).toEqual([-1]);
  });
});

/**
 * Crediting overlap is right on average and wrong in detail: whoever held the
 * floor gets every second the model heard as two voices, including seconds
 * where a second voice was music or a neighbouring table. On the annotated
 * meetings and the clean field sessions that credit is 0–24 % of the time
 * shown; a session in a shop with music read 42 %, and there the shares of
 * whoever spoke least cannot be trusted. Above OVERLAP_LIMIT the pages say so.
 * See ADR 0013.
 */
describe('assessOverlap', () => {
  it('reports the credited overlap as a share of the time shown, leaving other voices out', () => {
    const { share, heavy } = assessOverlap([1000, 1000, 1000], [0, 500, 900], [0, 1, OTHER_VOICE]);
    expect(share).toBeCloseTo(500 / 2500, 5);
    expect(heavy).toBe(false);
  });

  it('calls it heavy above the limit', () => {
    const { share, heavy } = assessOverlap([1000, 1000], [1000, 1000], [0, 1]);
    expect(share).toBeCloseTo(0.5, 5);
    expect(heavy).toBe(true);
    expect(OVERLAP_LIMIT).toBeGreaterThan(0.24);
    expect(OVERLAP_LIMIT).toBeLessThan(0.42);
  });

  it('is zero, and not heavy, when nothing has been heard', () => {
    expect(assessOverlap([], [], [])).toEqual({ share: 0, heavy: false });
  });
});

describe('both paths report the overlap share', () => {
  // A and B alternate, then talk over each other for a long stretch that goes to
  // whoever held the floor. The fake segmenter hears A+B as overlap.
  const TALK_OVER = conversation([['A', 5], ['B', 5], ['A', 3], ['AB', 12], ['B', 5], ['A', 3], ['AB', 8]]);

  it('the file path says how much of the time shown was credited overlap, and that it is heavy', async () => {
    const r = await diarize(TALK_OVER, { speakerCount: 2 });
    expect(r.overlapShare).toBeGreaterThan(OVERLAP_LIMIT);
    expect(r.overlapHeavy).toBe(true);
    const own = r.speakers.reduce((s, x) => s + x.totalMs, 0);
    expect(r.overlapShare).toBeLessThanOrEqual(r.overlapMs / own + 1e-9);
  });

  it('the live path agrees with the file path', async () => {
    const r = await diarize(TALK_OVER, { speakerCount: 2 });
    const s = await startLiveSession({ speakerCount: 2 });
    for (let off = 0; off < TALK_OVER.length; off += 16000) s.push(TALK_OVER.slice(off, Math.min(off + 16000, TALK_OVER.length)));
    for (;;) { const n = s.state().samples; await new Promise((res) => setTimeout(res, 20)); if (s.state().samples === n) break; }
    await s.flush();
    const st = s.state();
    s.dispose();
    expect(st.overlapHeavy).toBe(true);
    expect(Math.abs(st.overlapShare - r.overlapShare)).toBeLessThan(0.02);
  });

  it('a conversation without talk-over is not heavy', async () => {
    const r = await diarize(conversation([['A', 5], ['B', 5], ['A', 5], ['B', 5]]), { speakerCount: 2 });
    expect(r.overlapShare).toBe(0);
    expect(r.overlapHeavy).toBe(false);
  });
});
