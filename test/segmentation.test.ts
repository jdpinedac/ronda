import { describe, it, expect } from 'vitest';
import { POWERSET, decodeSegmentation, speechSpans } from '../src/engine/segmentation.js';

/** Builds logits that select `classes[f]` at each frame. */
function logitsFor(classes: readonly number[], numClasses = 7): Float32Array {
  const out = new Float32Array(classes.length * numClasses).fill(-10);
  classes.forEach((c, f) => { out[f * numClasses + c] = 10; });
  return out;
}

describe('POWERSET', () => {
  it('maps the seven pyannote classes to speaker sets', () => {
    expect(POWERSET).toEqual([[], [0], [1], [2], [0, 1], [0, 2], [1, 2]]);
  });

  it('covers silence, every soloist, and every pair', () => {
    expect(POWERSET[0]).toEqual([]);
    expect(POWERSET.filter((s) => s.length === 1)).toHaveLength(3);
    expect(POWERSET.filter((s) => s.length === 2)).toHaveLength(3);
  });
});

describe('decodeSegmentation', () => {
  it('merges consecutive frames with the same speaker set', () => {
    // silence, A, A, A, silence  over 500 ms => 100 ms per frame
    const spans = decodeSegmentation(logitsFor([0, 1, 1, 1, 0]), 7, 500);
    expect(spans).toEqual([
      { startMs: 0, endMs: 100, speakers: [] },
      { startMs: 100, endMs: 400, speakers: [0] },
      { startMs: 400, endMs: 500, speakers: [] },
    ]);
  });

  it('detects a speaker change without silence between', () => {
    const spans = decodeSegmentation(logitsFor([1, 1, 2, 2]), 7, 400);
    expect(spans.map((s) => s.speakers)).toEqual([[0], [1]]);
    expect(spans[0]!.endMs).toBe(spans[1]!.startMs);
  });

  it('reports overlapping speech as a two-speaker span', () => {
    const spans = decodeSegmentation(logitsFor([1, 4, 2]), 7, 300);
    expect(spans.map((s) => s.speakers)).toEqual([[0], [0, 1], [1]]);
  });

  it('handles a single frame', () => {
    expect(decodeSegmentation(logitsFor([1]), 7, 100)).toEqual([
      { startMs: 0, endMs: 100, speakers: [0] },
    ]);
  });

  it('handles empty input', () => {
    expect(decodeSegmentation(new Float32Array(0), 7, 0)).toEqual([]);
  });

  it('spans tile the whole duration without gaps', () => {
    const spans = decodeSegmentation(logitsFor([0, 1, 1, 2, 0, 3]), 7, 600);
    expect(spans[0]!.startMs).toBe(0);
    expect(spans[spans.length - 1]!.endMs).toBe(600);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startMs).toBe(spans[i - 1]!.endMs);
  });
});

describe('speechSpans', () => {
  it('keeps only single-speaker spans long enough to embed', () => {
    const spans = [
      { startMs: 0, endMs: 200, speakers: [] },
      { startMs: 200, endMs: 400, speakers: [0] },        // too short
      { startMs: 400, endMs: 2000, speakers: [1] },       // keep
      { startMs: 2000, endMs: 4000, speakers: [0, 1] },   // overlap, unusable
    ];
    expect(speechSpans(spans, 800)).toEqual([{ startMs: 400, endMs: 2000, speakers: [1] }]);
  });

  it('drops everything when nothing is long enough', () => {
    expect(speechSpans([{ startMs: 0, endMs: 300, speakers: [0] }], 800)).toEqual([]);
  });

  it('returns overlap spans separately for interruption analysis', () => {
    const spans = [
      { startMs: 0, endMs: 1000, speakers: [0] },
      { startMs: 1000, endMs: 1500, speakers: [0, 1] },
      { startMs: 1500, endMs: 3000, speakers: [1] },
    ];
    expect(speechSpans(spans, 400).map((s) => s.speakers)).toEqual([[0], [1]]);
  });
});
