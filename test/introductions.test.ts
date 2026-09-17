import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { startLiveSession, type LiveSession, type LiveState } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * A round of introductions: each person speaks in turn while the page says
 * whose turn it is, and what is heard becomes that person's profile. From
 * then on every voice sample goes to the nearest profile, so a name follows
 * a voice, not the order in which groups happened to form (ADR 0011).
 *
 * The fake segmenter calls the first and last second of each window silence,
 * so 12 s of one tone yields a handful of samples but comfortably more than
 * the 5 s minimum.
 */
const INTRO_A = conversation([['A', 12]]);
const INTRO_B = conversation([['B', 12]]);
const TALK = conversation([['A', 6], ['B', 5], ['A', 4], ['B', 6]]);

async function feed(s: LiveSession, audio: Float32Array) {
  for (let off = 0; off < audio.length; off += 16000) s.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  for (;;) { const n = s.state().samples; await new Promise((r) => setTimeout(r, 20)); if (s.state().samples === n) break; }
}

/** Introduce the two tones under the given profile indices, then talk. */
async function introduced(order: readonly [number, number], collect?: (state: LiveState, session: LiveSession) => void) {
  const s = await startLiveSession({ names: ['Ana', 'Juan'], speakerCount: 2, introductions: true });
  if (collect) s.onUpdate((state) => collect(state, s));
  s.introduce(order[0]);
  await feed(s, INTRO_A);
  await s.flush();
  s.introduce(order[1]);
  await feed(s, INTRO_B);
  await s.flush();
  s.startConversation();
  await feed(s, TALK);
  await s.flush();
  return s;
}

describe('a round of introductions', () => {
  it('collects each person\'s voice into their profile and counts none of it as conversation', async () => {
    const s = await startLiveSession({ names: ['Ana', 'Juan'], speakerCount: 2, introductions: true });
    s.introduce(0);
    await feed(s, INTRO_A);
    await s.flush();
    const st = s.state();
    expect(st.phase).toBe('introductions');
    expect(st.introducing?.index).toBe(0);
    expect(st.introducing?.collectedMs).toBeGreaterThanOrEqual(5000);
    expect(st.spokenMs).toBe(0);
    expect(st.samples).toBe(0);
    s.dispose();
  });

  it('gives each voice the name it was introduced under, whatever the speaking order', async () => {
    // Juan (index 1) introduces himself first, with tone A; Ana (0) second, with tone B.
    const s = await introduced([1, 0]);
    const st = s.state();
    const juan = st.speakers.find((x) => x.id === 1)!;
    const ana = st.speakers.find((x) => x.id === 0)!;
    // A spoke 10 s of the conversation, B 11 s; the trust regions trim a little.
    expect(juan.totalMs).toBeGreaterThan(ana.totalMs * 0.8);
    expect(juan.totalMs).toBeLessThan(ana.totalMs * 1.2);
    expect(st.countHint.source).toBe('calibration');
    // Every conversation sample landed on the tone it came from.
    const b = s.exportDiagnostics();
    const talkStart = (INTRO_A.length + INTRO_B.length) / 16;
    const aTurns = [[0, 6000], [11000, 15000]].map(([f, t]) => [talkStart + f!, talkStart + t!]);
    b.spans.forEach((span, i) => {
      const mid = (span.startMs + span.endMs) / 2;
      const isA = aTurns.some(([f, t]) => mid >= f! && mid < t!);
      expect(b.identities[i], `sample at ${(mid / 1000).toFixed(1)} s`).toBe(isA ? 1 : 0);
    });
    s.dispose();
  });

  it('never moves a sample from one person to another once attributed', async () => {
    const seen: number[][] = [];
    const s = await introduced([0, 1], (_, session) => { seen.push([...session.exportDiagnostics().identities]); });
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1]!;
      expect(seen[i]!.slice(0, prev.length)).toEqual(prev);
    }
    s.dispose();
  });

  it('lists everyone introduced from the start, even before they speak', async () => {
    const s = await introduced([0, 1]);
    expect(s.state().speakers.map((x) => x.id)).toEqual([0, 1]);
    s.dispose();
  });

  it('falls back to today\'s grouping when the introductions are skipped', async () => {
    const plain = await startLiveSession({ names: ['Ana', 'Juan'], speakerCount: 2 });
    await feed(plain, TALK);
    await plain.flush();
    const skipped = await startLiveSession({ names: ['Ana', 'Juan'], speakerCount: 2, introductions: true });
    skipped.startConversation();
    await feed(skipped, TALK);
    await skipped.flush();
    expect(skipped.state().phase).toBe('conversation');
    expect(skipped.state().countHint.source).toBe('count');
    expect(skipped.state().speakers.map((x) => x.totalMs).sort()).toEqual(plain.state().speakers.map((x) => x.totalMs).sort());
    plain.dispose(); skipped.dispose();
  });

  it('exports the introductions apart from the conversation, and no audio', async () => {
    const s = await introduced([0, 1]);
    const b = s.exportDiagnostics();
    expect(b.introductions).toBeDefined();
    expect(b.introductions!.profile.length).toBe(b.introductions!.vectors.length);
    expect(new Set(b.introductions!.profile)).toEqual(new Set([0, 1]));
    expect(JSON.stringify(b)).not.toContain('Ana');
    s.dispose();
  });
});
