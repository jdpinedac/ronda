import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * Quiet speech is dropped as coming from outside the conversation only when
 * the user has said there is a television or a nearby table. Otherwise a
 * soft-spoken person keeps their time. Measured in ADR 0007: with the head
 * count mandatory, the filter cost real speech on every meeting it touched
 * and only helped where intruders were present — which the person in the
 * room knows and Ronda does not.
 */
// B speaks at a fifth of A's level: a soft voice, or the next table.
const TABLE = conversation([
  ['A', 4], ['-', 1], ['B', 3, 0.2], ['-', 1], ['A', 4], ['-', 1], ['B', 3, 0.2], ['-', 1],
  ['A', 4], ['-', 1], ['B', 3, 0.2], ['-', 1], ['A', 4], ['B', 3, 0.2], ['-', 1],
]);

async function live(audio: Float32Array, backgroundVoices: boolean) {
  const session = await startLiveSession({ speakerCount: 2, backgroundVoices });
  for (let off = 0; off < audio.length; off += 16000) session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = session.state().samples; await new Promise((r) => setTimeout(r, 20)); if (session.state().samples === n) break; }
  await session.flush();
  const state = session.state();
  session.dispose();
  return state;
}

describe('the level filter follows the television switch', () => {
  it('keeps a quiet speaker when no intruders were declared', async () => {
    const r = await diarize(TABLE, { speakerCount: 2 });
    expect(r.diagnostics.backgroundMs).toBe(0);
    expect(r.speakers).toHaveLength(2);
    expect(Math.min(...r.speakers.map((s) => s.totalMs))).toBeGreaterThan(8000);
  });

  it('drops quiet speech once a television or nearby table is declared', async () => {
    const r = await diarize(TABLE, { speakerCount: 2, backgroundVoices: true });
    expect(r.diagnostics.backgroundMs).toBeGreaterThan(8000);
  });

  it('does the same on the live path', async () => {
    expect((await live(TABLE, false)).backgroundMs).toBe(0);
    // Live judges each stretch against what it has heard so far, so the first
    // quiet stretches pass before the table's level is established; it drops
    // less than the file path, which sees the whole recording at once.
    expect((await live(TABLE, true)).backgroundMs).toBeGreaterThan(6000);
  });
});
