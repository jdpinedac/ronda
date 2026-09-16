import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession, type LiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * Stopping is a pause. The tally on screen is the point of the session, and
 * a coffee break should not throw it away: after flush() the session keeps
 * its samples, identities and totals, and further audio adds to them.
 */
const FIRST = conversation([['A', 6], ['-', 1], ['B', 5], ['-', 1], ['A', 4]]);   // 17 s
const SECOND = conversation([['B', 6], ['-', 1], ['A', 5], ['-', 1], ['B', 4]]);  // 17 s

async function feed(session: LiveSession, audio: Float32Array) {
  for (let off = 0; off < audio.length; off += 16000) session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = session.state().samples; await new Promise((r) => setTimeout(r, 20)); if (session.state().samples === n) break; }
  await session.flush();
}

describe('pausing and resuming a live session', () => {
  it('keeps counting after a flush, on the same identities', async () => {
    const session = await startLiveSession({ speakerCount: 2 });
    await feed(session, FIRST);
    const paused = session.state();
    expect(paused.speakers).toHaveLength(2);
    const idsBefore = paused.speakers.map((s) => s.id).sort();
    const totalBefore = paused.spokenMs;

    await feed(session, SECOND);
    const resumed = session.state();
    expect(resumed.samples).toBeGreaterThan(paused.samples);
    expect(resumed.spokenMs).toBeGreaterThan(totalBefore + 10_000);
    expect(resumed.speakers.map((s) => s.id).sort()).toEqual(idsBefore);
    expect(resumed.elapsedMs).toBe(34_000);
    session.dispose();
  });

  it('credits each speaker about what one uninterrupted session would', async () => {
    const joined = new Float32Array(FIRST.length + SECOND.length);
    joined.set(FIRST, 0); joined.set(SECOND, FIRST.length);
    const file = await diarize(joined, { speakerCount: 2 });
    const session = await startLiveSession({ speakerCount: 2 });
    await feed(session, FIRST);
    await feed(session, SECOND);
    const live = session.state().speakers.map((s) => s.totalMs).sort((a, b) => b - a);
    const ref = file.speakers.map((s) => s.totalMs).sort((a, b) => b - a);
    // Resuming is like starting: the model has no context for the first second.
    for (let i = 0; i < ref.length; i++) expect(Math.abs(live[i]! - ref[i]!), `speaker ${i}: ${live[i]} vs ${ref[i]}`).toBeLessThanOrEqual(1500);
    session.dispose();
  });
});
