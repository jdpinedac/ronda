import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { startLiveSession, type LiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * Someone who joins after the introductions has no profile. Their voice went
 * to whoever they sounded most like, and — worse — that profile learned from
 * it and drifted towards them. Now a profile learns only from samples that
 * are clearly its own, a run of far samples is written to the log, and the
 * person at the table can add the newcomer, who introduces themselves.
 */
async function feed(s: LiveSession, audio: Float32Array) {
  for (let off = 0; off < audio.length; off += 16000) s.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = s.state().coveredToMs; await new Promise((r) => setTimeout(r, 20)); if (s.state().coveredToMs === n) break; }
}
async function introducedAB() {
  const s = await startLiveSession({ names: ['Ana', 'Juan'], speakerCount: 2, introductions: true });
  s.introduce(0); await feed(s, conversation([['A', 12]])); await s.flush();
  s.introduce(1); await feed(s, conversation([['B', 12]])); await s.flush();
  s.startConversation();
  return s;
}

describe('a voice that never introduced itself', () => {
  it('does not teach the profile it lands on', async () => {
    const s = await introducedAB();
    const before = s.state().profilesMs.slice();
    await feed(s, conversation([['C', 15]]));
    await s.flush();
    // C was credited to someone — there is nobody else — but no profile grew.
    expect(s.state().spokenMs).toBeGreaterThan(5000);
    expect(s.state().profilesMs).toEqual(before);
    s.dispose();
  });

  it('is written to the log as a run of far samples', async () => {
    const s = await introducedAB();
    await feed(s, conversation([['C', 20]]));
    await s.flush();
    expect(s.state().log.some((e) => e.kind === 'far-run')).toBe(true);
    s.dispose();
  });

  it('can be added mid-conversation and introduce themselves', async () => {
    const s = await introducedAB();
    await feed(s, conversation([['A', 6]]));
    const idx = s.addPerson('Marta');
    expect(idx).toBe(2);
    expect(s.state().speakers.map((x) => x.id)).toEqual([0, 1, 2]);
    s.introduce(idx);
    await feed(s, conversation([['C', 12]]));
    await s.flush();
    expect(s.state().introducing?.index).toBe(2);
    expect(s.state().profilesMs[2]).toBeGreaterThanOrEqual(5000);
    s.endIntroduction();
    const cBefore = s.state().speakers.find((x) => x.id === 2)!.totalMs;
    await feed(s, conversation([['C', 8], ['A', 4]]));
    await s.flush();
    const st = s.state();
    expect(st.speakers.find((x) => x.id === 2)!.totalMs).toBeGreaterThan(cBefore + 3000);
    expect(st.phase).toBe('conversation');
    expect(st.countHint.k).toBe(3);
    s.dispose();
  });
});
