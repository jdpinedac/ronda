import { describe, it, expect } from 'vitest';
import { assessReliability } from '../src/engine/diarize.js';

/**
 * The case this exists for: an 8-second recording of one person yields two
 * voice samples. Ask for two speakers and each sample becomes its own
 * "speaker", producing a 65/35 split that looks like a measurement and is not.
 */
describe('assessReliability', () => {
  it('calls a two-sample, two-speaker split unreliable', () => {
    expect(assessReliability(2, 2)).toBe('low');
  });

  it('accepts a split with enough samples per person', () => {
    expect(assessReliability(12, 2)).toBe('good');
    expect(assessReliability(12, 4)).toBe('good');
  });

  it('marks the boundary at three samples per person', () => {
    expect(assessReliability(6, 2)).toBe('good');
    expect(assessReliability(5, 2)).toBe('low');
  });

  it('reports insufficient when there is nothing to compare', () => {
    expect(assessReliability(0, 0)).toBe('insufficient');
    expect(assessReliability(1, 1)).toBe('insufficient');
  });

  it('gets stricter as more people are claimed', () => {
    expect(assessReliability(9, 3)).toBe('good');
    expect(assessReliability(9, 4)).toBe('low');
  });
});
