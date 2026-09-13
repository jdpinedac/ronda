import { describe, it, expect } from 'vitest';
import { windowPlan } from '../src/engine/windows.js';

describe('windowPlan', () => {
  it('covers short audio with a single window', () => {
    const plan = windowPlan(4000, 10000, 5000);
    expect(plan).toEqual([{ startMs: 0, endMs: 4000, trustFromMs: 0, trustToMs: 4000 }]);
  });

  it('trusts the whole of a single full-length window', () => {
    const plan = windowPlan(10000, 10000, 5000);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toEqual({ startMs: 0, endMs: 10000, trustFromMs: 0, trustToMs: 10000 });
  });

  it('trusts the middle of interior windows, and the edges of the outer ones', () => {
    const plan = windowPlan(20000, 10000, 5000);
    // First window trusted from its start; last trusted to its end.
    expect(plan[0]!.trustFromMs).toBe(0);
    expect(plan[plan.length - 1]!.trustToMs).toBe(20000);
    // Interior windows are trusted only around their centre, where the model
    // has the most context on both sides.
    const interior = plan.slice(1, -1);
    for (const w of interior) {
      expect(w.trustFromMs).toBe(w.startMs + 2500);
      expect(w.trustToMs).toBe(w.startMs + 7500);
    }
  });

  it('produces trust regions that tile the timeline exactly once', () => {
    for (const total of [12000, 20000, 33000, 57000, 60000]) {
      const plan = windowPlan(total, 10000, 5000);
      expect(plan[0]!.trustFromMs, `total=${total}`).toBe(0);
      expect(plan[plan.length - 1]!.trustToMs, `total=${total}`).toBe(total);
      for (let i = 1; i < plan.length; i++) {
        expect(plan[i]!.trustFromMs, `total=${total} at ${i}`).toBe(plan[i - 1]!.trustToMs);
      }
    }
  });

  it('never lets a window run past the end of the audio', () => {
    for (const total of [7000, 13000, 28000]) {
      for (const w of windowPlan(total, 10000, 5000)) {
        expect(w.endMs).toBeLessThanOrEqual(total);
        expect(w.trustToMs).toBeLessThanOrEqual(total);
        expect(w.trustFromMs).toBeLessThan(w.trustToMs);
      }
    }
  });

  it('returns nothing for empty audio', () => {
    expect(windowPlan(0, 10000, 5000)).toEqual([]);
  });
});
