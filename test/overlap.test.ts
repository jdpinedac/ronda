import { describe, it, expect } from 'vitest';
import { creditOverlap, type Span } from '../src/engine/segmentation.js';

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
