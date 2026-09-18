import { describe, it, expect, vi } from 'vitest';
import * as fake from './helpers/fake-models.js';
import { conversation } from './helpers/fake-models.js';

/**
 * A field session stopped hearing after a long stretch and left no trace.
 * Nothing in the engine recorded what happened, a persistent failure would
 * have retried the same window for ever while the audio piled up, and the
 * page had no way to tell. Now the session keeps a short log of events,
 * skips a window that keeps failing, never holds more than a bounded amount
 * of audio, and can be nudged back into motion.
 */
type Seg = typeof fake.runSegmentation;
const control: { fail: (window: Float32Array, call: number) => boolean; hang: (call: number) => boolean } = { fail: () => false, hang: () => false };
let calls = 0;
vi.mock('../src/engine/models.js', async () => {
  const f = await import('./helpers/fake-models.js');
  const runSegmentation: Seg = async (s, w) => {
    calls++;
    if (control.hang(calls)) return new Promise(() => {}); // never settles
    if (control.fail(w, calls)) throw new Error('inference failed');
    return f.runSegmentation(s, w);
  };
  return { ...f, runSegmentation };
});
import { startLiveSession, type LiveSession, MAX_BUFFER_MS } from '../src/engine/live.js';

const TALK = conversation([['A', 6], ['B', 5], ['A', 4], ['B', 6], ['A', 5], ['B', 4]]); // 30 s

async function feed(s: LiveSession, audio: Float32Array, settleMs = 30) {
  for (let off = 0; off < audio.length; off += 16000) s.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = s.state().coveredToMs; await new Promise((r) => setTimeout(r, settleMs)); if (s.state().coveredToMs === n) break; }
}

describe('a live session under failure', () => {
  it('logs the windows it analyses', async () => {
    control.fail = () => false; control.hang = () => false;
    const s = await startLiveSession({ speakerCount: 2 });
    await feed(s, TALK);
    const kinds = s.state().log.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'window').length).toBeGreaterThanOrEqual(4);
    s.dispose();
  });

  it('skips a window that keeps failing, records it, and carries on', async () => {
    calls = 0; control.hang = () => false;
    // The second window fails every time it is tried: inference calls 2, 3 and 4.
    let seen = 0;
    control.fail = () => { seen++; return seen >= 2 && seen <= 4; };
    const s = await startLiveSession({ speakerCount: 2 });
    await feed(s, TALK);
    const st = s.state();
    expect(st.coveredToMs).toBeGreaterThanOrEqual(27_000);
    expect(st.log.some((e) => e.kind === 'error')).toBe(true);
    expect(st.log.some((e) => e.kind === 'skipped')).toBe(true);
    s.dispose();
  });

  it('never holds more than a bounded amount of audio when analysis stalls', async () => {
    calls = 0; control.fail = () => false;
    control.hang = (call) => call === 1; // the very first inference never returns
    const s = await startLiveSession({ speakerCount: 2 });
    const long = conversation([['A', 150]]);
    for (let off = 0; off < long.length; off += 16000) s.push(long.slice(off, off + 16000));
    await new Promise((r) => setTimeout(r, 50));
    const st = s.state();
    expect(st.bufferedMs).toBeLessThanOrEqual(MAX_BUFFER_MS);
    expect(st.log.some((e) => e.kind === 'dropped')).toBe(true);
    expect(st.coveredToMs).toBe(0);
    // Nudged, it lets go of the stuck analysis and resumes from the audio it still has.
    control.hang = () => false;
    s.recover();
    await feed(s, conversation([['B', 12]]));
    expect(s.state().coveredToMs).toBeGreaterThan(0);
    expect(s.state().log.some((e) => e.kind === 'recovered')).toBe(true);
    s.dispose();
  });

  it('lets the page note what the capture reported', async () => {
    control.fail = () => false; control.hang = () => false;
    const s = await startLiveSession({ speakerCount: 2 });
    s.note('capture', 'statechange: suspended');
    const b = s.exportDiagnostics();
    expect(b.log).toBeDefined();
    expect(b.log!.some((e) => e.kind === 'capture' && e.detail === 'statechange: suspended')).toBe(true);
    s.dispose();
  });
});
