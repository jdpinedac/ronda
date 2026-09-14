import { describe, it, expect } from 'vitest';
import { rms, median, selectForeground, BACKGROUND_LEVEL_RATIO } from '../src/engine/levels.js';

describe('rms', () => {
  it('is zero for silence and one for a full-scale square wave', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1)))).toBeCloseTo(1, 6);
  });

  it('handles empty input', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('median', () => {
  it('takes the middle of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middles of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles empty input', () => {
    expect(median([])).toBe(0);
  });
});

describe('selectForeground', () => {
  /**
   * The levels measured on a real recording with distant conversation in the
   * gaps, expressed as a fraction of the session median. The first three are
   * the other room.
   */
  const measured = [0.16, 0.18, 0.37, 0.56, 0.58, 0.65, 0.71, 0.72, 0.84, 0.86,
    0.9, 0.94, 0.95, 0.98, 1, 1.01, 1.06, 1.06, 1.08, 1.12, 1.13, 1.16, 1.27,
    1.27, 1.29, 1.29, 1.33, 1.76];

  it('drops the distant conversation and keeps the table', () => {
    const keep = selectForeground(measured);
    expect(keep.slice(0, 3)).toEqual([false, false, false]);
    expect(keep.slice(3).every(Boolean), 'no table speech may be dropped').toBe(true);
  });

  it('keeps everything in a clean recording, whose quietest stretch was 0.55', () => {
    const clean = [0.55, 0.57, 0.63, 0.68, 0.68, 0.8, 0.84, 0.86, 1, 1.1, 1.2, 1.4];
    expect(selectForeground(clean).every(Boolean)).toBe(true);
  });

  it('keeps everything when there are too few samples to judge', () => {
    expect(selectForeground([1, 0.01, 1]).every(Boolean)).toBe(true);
  });

  it('sits clear of the quietest legitimate speech observed', () => {
    expect(BACKGROUND_LEVEL_RATIO).toBeLessThan(0.55);
    expect(BACKGROUND_LEVEL_RATIO).toBeGreaterThan(0.37);
  });

  it('handles empty input', () => {
    expect(selectForeground([])).toEqual([]);
  });
});
