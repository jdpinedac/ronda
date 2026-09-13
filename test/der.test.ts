import { describe, it, expect } from 'vitest';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';

const ref: Turn[] = [
  { startMs: 0, endMs: 1000, speaker: 'A' },
  { startMs: 1000, endMs: 2000, speaker: 'B' },
  { startMs: 3000, endMs: 4000, speaker: 'A' },
];

describe('diarizationErrorRate', () => {
  it('scores a perfect diarization at zero, despite different label names', () => {
    const hyp: Turn[] = [
      { startMs: 0, endMs: 1000, speaker: 1 },
      { startMs: 1000, endMs: 2000, speaker: 2 },
      { startMs: 3000, endMs: 4000, speaker: 1 },
    ];
    const r = diarizationErrorRate(ref, hyp, 4000);
    expect(r.der).toBe(0);
    expect(r.mapping).toEqual({ '1': 'A', '2': 'B' });
  });

  it('counts speech attributed to the wrong person as confusion', () => {
    const hyp: Turn[] = [
      { startMs: 0, endMs: 1000, speaker: 1 },
      { startMs: 1000, endMs: 2000, speaker: 1 }, // should have been B
      { startMs: 3000, endMs: 4000, speaker: 1 },
    ];
    const r = diarizationErrorRate(ref, hyp, 4000);
    expect(r.confusionMs).toBe(1000);
    expect(r.der).toBeCloseTo(1000 / 3000, 6);
  });

  it('counts speech it did not find as missed', () => {
    const hyp: Turn[] = [{ startMs: 0, endMs: 1000, speaker: 1 }];
    const r = diarizationErrorRate(ref, hyp, 4000);
    expect(r.missedMs).toBe(2000);
    expect(r.der).toBeCloseTo(2000 / 3000, 6);
  });

  it('counts silence labelled as speech as false alarm', () => {
    const hyp: Turn[] = [
      { startMs: 0, endMs: 1000, speaker: 1 },
      { startMs: 1000, endMs: 2000, speaker: 2 },
      { startMs: 2000, endMs: 3000, speaker: 1 }, // reference is silent here
      { startMs: 3000, endMs: 4000, speaker: 1 },
    ];
    const r = diarizationErrorRate(ref, hyp, 4000);
    expect(r.falseAlarmMs).toBe(1000);
    expect(r.der).toBeCloseTo(1000 / 3000, 6);
  });

  it('scores an empty hypothesis as everything missed', () => {
    expect(diarizationErrorRate(ref, [], 4000).der).toBe(1);
  });

  it('reports zero when the reference has no speech', () => {
    expect(diarizationErrorRate([], [{ startMs: 0, endMs: 100, speaker: 1 }], 1000).der).toBe(0);
  });

  it('never maps two hypothesis labels to the same person', () => {
    const hyp: Turn[] = [
      { startMs: 0, endMs: 1000, speaker: 1 },
      { startMs: 1000, endMs: 2000, speaker: 2 },
      { startMs: 3000, endMs: 4000, speaker: 3 },
    ];
    const values = Object.values(diarizationErrorRate(ref, hyp, 4000).mapping);
    expect(new Set(values).size).toBe(values.length);
  });
});
