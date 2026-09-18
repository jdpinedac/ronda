import { describe, it, expect } from 'vitest';
import { NewVoiceWatch } from '../src/engine/newcomer.js';

/**
 * A voice nobody introduced shows up as a run of samples far from every
 * profile. One far sample is noise — a known voice turning away — so the
 * watch waits for several of them, adding up to enough speech, close
 * together in time, before suggesting that someone new is at the table.
 */
const rule = { farDistance: 0.75, minSamples: 3, minMs: 4000, withinMs: 60_000 };

describe('NewVoiceWatch', () => {
  it('says nothing for near samples, or for a single far one', () => {
    const w = new NewVoiceWatch(rule);
    expect(w.observe({ at: 0, ms: 2000, distance: 0.5 })).toBeNull();
    expect(w.observe({ at: 3000, ms: 2000, distance: 0.9 })).toBeNull();
    expect(w.observe({ at: 6000, ms: 2000, distance: 0.4 })).toBeNull();
  });

  it('suggests a new voice once enough far samples arrive close together', () => {
    const w = new NewVoiceWatch(rule);
    expect(w.observe({ at: 0, ms: 1500, distance: 0.8 })).toBeNull();
    expect(w.observe({ at: 5000, ms: 1500, distance: 0.85 })).toBeNull();
    const s = w.observe({ at: 10_000, ms: 1500, distance: 0.9 });
    expect(s).not.toBeNull();
    expect(s!.run).toHaveLength(3);
    expect(s!.sinceMs).toBe(0);
  });

  it('forgets far samples older than the time window', () => {
    const w = new NewVoiceWatch(rule);
    w.observe({ at: 0, ms: 2000, distance: 0.8 });
    w.observe({ at: 5000, ms: 2000, distance: 0.8 });
    // 70 s later: the two above are too old to count with this one.
    expect(w.observe({ at: 75_000, ms: 2000, distance: 0.8 })).toBeNull();
  });

  it('keeps carrying the run sample indices so a profile can be built from them', () => {
    const w = new NewVoiceWatch(rule);
    w.observe({ at: 0, ms: 2000, distance: 0.8, index: 10 });
    w.observe({ at: 5000, ms: 2000, distance: 0.8, index: 11 });
    const s = w.observe({ at: 10_000, ms: 2000, distance: 0.8, index: 12 })!;
    expect(s.run.map((r) => r.index)).toEqual([10, 11, 12]);
  });

  it('after a dismissal, does not ask again for the same run', () => {
    const w = new NewVoiceWatch(rule);
    w.observe({ at: 0, ms: 2000, distance: 0.8 });
    w.observe({ at: 5000, ms: 2000, distance: 0.8 });
    expect(w.observe({ at: 10_000, ms: 2000, distance: 0.8 })).not.toBeNull();
    w.dismiss();
    expect(w.observe({ at: 15_000, ms: 2000, distance: 0.8 })).toBeNull();
    expect(w.observe({ at: 20_000, ms: 2000, distance: 0.8 })).toBeNull();
    // A fresh run, after a quiet spell, may ask again.
    expect(w.observe({ at: 200_000, ms: 2000, distance: 0.8 })).toBeNull();
    expect(w.observe({ at: 205_000, ms: 2000, distance: 0.8 })).toBeNull();
    expect(w.observe({ at: 210_000, ms: 2000, distance: 0.8 })).not.toBeNull();
  });
});
