import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { overlapCredits, type Span } from '../src/engine/segmentation.js';
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * When two people talk at once, both are talking. The segmentation model
 * names them as local speakers of the window, and the same window usually
 * holds stretches where each spoke alone — which is how the local speakers
 * get their identities. Cross the two and the overlap can be credited to
 * both. Only when neither local speaker is identified in the window does it
 * fall back to whoever held the floor (ADR 0006).
 */
const one = (startMs: number, endMs: number, local: number): Span => ({ startMs, endMs, speakers: [local] });
const two = (startMs: number, endMs: number, a: number, b: number): Span => ({ startMs, endMs, speakers: [a, b] });

describe('overlapCredits', () => {
  it('credits an overlap to the samples of both local speakers heard alone in its window', () => {
    const windowSpans = [one(0, 2000, 0), one(2000, 4000, 1), two(4000, 5000, 0, 1)];
    const attributed = [{ span: one(0, 2000, 0), vector: 0 }, { span: one(2000, 4000, 1), vector: 1 }];
    expect(overlapCredits(attributed, [{ span: two(4000, 5000, 0, 1), windowSpans }])).toEqual([[0, 1]]);
  });

  it('ties a local speaker to a sample by time, even one embedded from another window', () => {
    // The window saw local 1 alone at 2-4 s, but only 3-4 s was trusted here;
    // a sample from the neighbouring window covers 1.5-3 s.
    const windowSpans = [one(0, 2000, 0), one(2000, 4000, 1), two(4000, 5000, 0, 1)];
    const attributed = [{ span: one(0, 2000, 0), vector: 0 }, { span: one(1500, 3000, 5), vector: 9 }];
    expect(overlapCredits(attributed, [{ span: two(4000, 5000, 0, 1), windowSpans }])).toEqual([[0, 9]]);
  });

  it('credits only the identified local speaker when the other never spoke alone', () => {
    const windowSpans = [one(0, 2000, 0), two(2000, 3000, 0, 1)];
    expect(overlapCredits([{ span: one(0, 2000, 0), vector: 7 }], [{ span: two(2000, 3000, 0, 1), windowSpans }])).toEqual([[7]]);
  });

  it('credits nobody when no sample covers where either local speaker spoke alone', () => {
    const windowSpans = [one(10_000, 12_000, 0), two(12_000, 13_000, 0, 1)];
    expect(overlapCredits([{ span: one(0, 2000, 0), vector: 0 }], [{ span: two(12_000, 13_000, 0, 1), windowSpans }])).toEqual([[]]);
  });

  it('picks the sample that covers most of the local speaker\'s time alone', () => {
    const windowSpans = [one(0, 900, 2), one(1000, 4000, 2), one(4000, 6000, 0), two(6000, 7000, 0, 2)];
    const attributed = [{ span: one(0, 900, 2), vector: 0 }, { span: one(1000, 4000, 2), vector: 1 }, { span: one(4000, 6000, 0), vector: 2 }];
    expect(overlapCredits(attributed, [{ span: two(6000, 7000, 0, 2), windowSpans }])).toEqual([[2, 1]]);
  });
});

// Both speak alone shortly before and after talking at once (11-14 s).
const CONVERSATION = conversation([['A', 4], ['B', 4], ['A', 3], ['AB', 3], ['B', 3], ['A', 3]]);

describe('overlap is credited to both voices', () => {
  it('in the file path, the totals add up to more than the single-voice speech plus the overlap once', async () => {
    const r = await diarize(CONVERSATION, { speakerCount: 2 });
    const totals = r.speakers.reduce((s, x) => s + x.totalMs, 0);
    expect(r.overlapMs).toBeGreaterThan(2000);
    expect(totals).toBeGreaterThan(r.diagnostics.speechMs + 1.5 * r.overlapMs);
    expect(r.diagnostics.overlapBothMs).toBeGreaterThan(2000);
  });

  it('in the live path too, within the half second the last window edge costs', async () => {
    const file = await diarize(CONVERSATION, { speakerCount: 2 });
    const session = await startLiveSession({ speakerCount: 2 });
    for (let off = 0; off < CONVERSATION.length; off += 16000) session.push(CONVERSATION.slice(off, Math.min(off + 16000, CONVERSATION.length)));
    for (;;) { const n = session.state().samples; await new Promise((r) => setTimeout(r, 20)); if (session.state().samples === n) break; }
    await session.flush();
    const s = session.state();
    session.dispose();
    // The other voice's stretch alone can come after the overlap, in the next
    // window; the live path waits one window for it before giving up.
    const fileTotal = file.speakers.reduce((sum, x) => sum + x.totalMs, 0);
    expect(s.spokenMs).toBeGreaterThanOrEqual(fileTotal - 1000);
  });
});
