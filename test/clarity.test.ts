import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { assessClarity, CLARITY_LIMIT } from '../src/engine/clustering.js';
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * How clearly the voices arrive: the spread of each person's samples around
 * their own centroid, in centred space. On the annotated table recordings
 * it sits between 0.19 and 0.55; a field session recorded 80 cm from two
 * people, in a small room with a large window onto a street, on a phone's
 * Chrome, sat at 0.68 and 0.79 — and its "who is speaking now" was
 * unreliable. This is the one figure the person at the table can move, by
 * moving the phone, so Ronda measures it and says so.
 */
describe('assessClarity', () => {
  const unit = (xs: number[]) => { const n = Math.hypot(...xs); return Float32Array.from(xs, (x) => x / n); };
  const around = (centre: number[], wobble: number, count: number) =>
    Array.from({ length: count }, (_, i) => unit(centre.map((c, d) => c + wobble * Math.sin(i * 1.7 + d))));

  it('reports a low spread for tight groups', () => {
    const a = around([1, 0, 0, 0], 0.1, 6), b = around([0, 1, 0, 0], 0.1, 6);
    const r = assessClarity([...a, ...b], [...a.map(() => 0), ...b.map(() => 1)], Array(12).fill(1000));
    expect(r.spread).toBeLessThan(0.3);
    expect(r.clear).toBe(true);
  });

  it('reports a high spread for loose groups and calls them unclear', () => {
    // Each group's eight samples point along eight orthogonal axes: every one
    // sits 1 - 1/sqrt(8) = 0.65 from the group's centroid.
    const axis = (d: number) => unit(Array.from({ length: 16 }, (_, i) => (i === d ? 1 : 0)));
    const a = Array.from({ length: 8 }, (_, i) => axis(i)), b = Array.from({ length: 8 }, (_, i) => axis(8 + i));
    const r = assessClarity([...a, ...b], [...a.map(() => 0), ...b.map(() => 1)], Array(16).fill(1000));
    expect(r.spread).toBeCloseTo(1 - 1 / Math.sqrt(8), 2);
    expect(r.spread).toBeGreaterThan(CLARITY_LIMIT);
    expect(r.clear).toBe(false);
  });

  it('needs a few samples before it judges', () => {
    const a = around([1, 0, 0, 0], 1.5, 2);
    expect(assessClarity(a, [0, 0], [1000, 1000]).clear).toBe(true);
  });
});

describe('the live session reports clarity', () => {
  it('exposes the spread in its state and diagnostics', async () => {
    const audio = conversation([['A', 6], ['B', 5], ['A', 5], ['B', 6]]);
    const s = await startLiveSession({ speakerCount: 2 });
    for (let off = 0; off < audio.length; off += 16000) s.push(audio.slice(off, Math.min(off + 16000, audio.length)));
    for (;;) { const n = s.state().samples; await new Promise((r) => setTimeout(r, 20)); if (s.state().samples === n) break; }
    await s.flush();
    const st = s.state();
    expect(typeof st.spread).toBe('number');
    expect(st.spread).toBeGreaterThanOrEqual(0);
    expect(s.exportDiagnostics({ capture: { userAgent: 'test', track: { noiseSuppression: true } } }).capture).toEqual({ userAgent: 'test', track: { noiseSuppression: true } });
    s.dispose();
  });
});
