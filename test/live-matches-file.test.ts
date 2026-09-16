import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * The live path and the file path are the same measurement taken two ways,
 * and should agree. Until they did, the live path analysed disjoint
 * 10-second blocks and trusted the model everywhere, including the window
 * edges where it has the least context; the file path slides a 10-second
 * window every 5 seconds and trusts only the middle of each. Same audio,
 * different answers — which made every benchmark figure a statement about
 * the file path only.
 */
const CONVERSATION = conversation([
  ['A', 4], ['-', 1], ['B', 3], ['-', 0.5], ['A', 6.5],   // 15 s, turns cross the 5 s and 10 s marks
  ['B', 2], ['-', 1], ['A', 3], ['B', 4],                  // 25 s
  ['-', 2], ['A', 8],                                      // 35 s
  ['B', 5],                                                // 40 s
]);

async function live(audio: Float32Array, speakerCount: number) {
  const session = await startLiveSession({ speakerCount });
  for (let off = 0; off < audio.length; off += 16000) session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = session.state().samples; await new Promise((r) => setTimeout(r, 20)); if (session.state().samples === n) break; }
  await session.flush();
  const state = session.state();
  session.dispose();
  return state;
}

describe('the live path agrees with the file path', () => {
  it('credits each speaker the same time, to within a frame', async () => {
    const file = await diarize(CONVERSATION, { speakerCount: 2 });
    const state = await live(CONVERSATION, 2);
    const fileTotals = file.speakers.map((s) => s.totalMs).sort((a, b) => b - a);
    const liveTotals = state.speakers.map((s) => s.totalMs).sort((a, b) => b - a);
    expect(liveTotals).toHaveLength(fileTotals.length);
    for (let i = 0; i < fileTotals.length; i++) expect(Math.abs(liveTotals[i]! - fileTotals[i]!), `speaker ${i}: live ${liveTotals[i]} vs file ${fileTotals[i]}`).toBeLessThanOrEqual(20);
  });

  it('says how far into the audio its verdict reaches', async () => {
    const state = await live(CONVERSATION, 2);
    // After flush the whole recording has been analysed.
    expect(state.coveredToMs).toBe(CONVERSATION.length / 16);
  });

  it('takes the same voice samples, give or take the one split at stop', async () => {
    // When listening stops, the last 2.5 s are analysed on their own, so a
    // turn still running at that moment yields two samples where the file
    // path, which knows where the recording ends, yields one.
    const file = await diarize(CONVERSATION, { speakerCount: 2 });
    const state = await live(CONVERSATION, 2);
    expect(Math.abs(state.samples - file.diagnostics.embeddings)).toBeLessThanOrEqual(1);
  });
});
