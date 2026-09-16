/**
 * How good is "who is speaking now"?
 *
 * Runs the live path over an annotated recording and, at every update,
 * compares the speaker the indicator shows with the speaker the annotation
 * has at the moment the verdict reaches. Three numbers come out:
 *
 * - accuracy: updates whose active speaker is the annotated one;
 * - switch latency: for each annotated turn of at least 2 s that follows
 *   someone else, how long after it starts the indicator shows the new
 *   speaker (or never, within the turn);
 * - false flips: updates where the indicator changed speaker while the
 *   annotation had the same person speaking at both verdicts.
 *
 *     REC=ami-meeting npm run bench -- bench/now.report.ts
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
import { startLiveSession, type LiveState } from '../src/engine/live.js';
import type { Turn } from '../src/metrics/der.js';
import { readAudio16k, ROOT } from './node-models.js';

const TD = `${ROOT}/public/testdata`;
const RECORDINGS = [
  { id: 'example', wav: `${ROOT}/public/example/meeting.wav`, truth: `${ROOT}/public/example/meeting.truth.json`, people: 4 },
  { id: 'ami-meeting', wav: `${TD}/ami-meeting.wav`, truth: `${TD}/ami-meeting.truth.json`, people: 4 },
  { id: 'ami-ES2004a', wav: `${TD}/ami-ES2004a.wav`, truth: `${TD}/ami-ES2004a.truth.json`, people: 4 },
].filter((r) => r.id.includes(process.env.REC ?? 'ami-meeting'));

/** Annotated speaker at an instant: the longest-running turn covering it, or null. */
function speakerAt(turns: readonly Turn[], ms: number): string | null {
  let best: Turn | null = null;
  for (const t of turns) if (t.startMs <= ms && ms < t.endMs && (!best || t.endMs - t.startMs > best.endMs - best.startMs)) best = t;
  return best ? String(best.speaker) : null;
}

describe('who is speaking now', () => {
  for (const rec of RECORDINGS) {
    it(rec.id, async () => {
      if (!existsSync(rec.wav)) { console.log(`skip ${rec.id}`); return; }
      const truth = JSON.parse(readFileSync(rec.truth, 'utf8')) as { turns: Turn[] };
      const audio = readAudio16k(rec.wav);
      const session = await startLiveSession({ speakerCount: rec.people });
      const updates: { at: number; active: number | null }[] = [];
      session.onUpdate((s: LiveState) => updates.push({ at: s.coveredToMs, active: s.speakers.find((x) => x.active)?.id ?? null }));
      for (let off = 0; off < audio.length; off += 16000) {
        session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
        // Let the engine catch up after each second, as a microphone would.
        for (;;) { const n = updates.length; await new Promise((r) => setTimeout(r, 5)); if (updates.length === n) break; }
      }
      await session.flush();
      session.dispose();

      // Map identities to annotated speakers by agreement at update times.
      const votes = new Map<number, Map<string, number>>();
      for (const u of updates) {
        const who = speakerAt(truth.turns, u.at - 1);
        if (u.active === null || who === null) continue;
        const row = votes.get(u.active) ?? new Map<string, number>();
        row.set(who, (row.get(who) ?? 0) + 1);
        votes.set(u.active, row);
      }
      const pairs: { id: number; who: string; n: number }[] = [];
      for (const [id, row] of votes) for (const [who, n] of row) pairs.push({ id, who, n });
      pairs.sort((a, b) => b.n - a.n);
      const nameOf = new Map<number, string>(); const used = new Set<string>();
      for (const p of pairs) { if (nameOf.has(p.id) || used.has(p.who)) continue; nameOf.set(p.id, p.who); used.add(p.who); }

      // Accuracy at update times, over updates where someone is annotated as speaking.
      let scored = 0, right = 0;
      for (const u of updates) {
        const who = speakerAt(truth.turns, u.at - 1);
        if (who === null) continue;
        scored++;
        if (u.active !== null && nameOf.get(u.active) === who) right++;
      }

      // Switch latency per annotated turn change.
      const turns = [...truth.turns].sort((a, b) => a.startMs - b.startMs);
      const latencies: number[] = []; let never = 0; let changes = 0;
      for (let i = 1; i < turns.length; i++) {
        const t = turns[i]!;
        if (t.endMs - t.startMs < 2000) continue;
        const before = speakerAt(truth.turns, t.startMs - 200);
        if (before === String(t.speaker)) continue;
        changes++;
        const hit = updates.find((u) => u.at >= t.startMs && u.at <= t.endMs + 5000 && u.active !== null && nameOf.get(u.active) === String(t.speaker));
        if (hit) latencies.push(hit.at - t.startMs); else never++;
      }
      latencies.sort((a, b) => a - b);
      const q = (p: number) => latencies.length ? (latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]! / 1000).toFixed(1) : '-';

      // False flips.
      let flips = 0, stable = 0;
      for (let i = 1; i < updates.length; i++) {
        const a = updates[i - 1]!, b = updates[i]!;
        const wa = speakerAt(truth.turns, a.at - 1), wb = speakerAt(truth.turns, b.at - 1);
        if (wa === null || wa !== wb || a.active === null || b.active === null) continue;
        stable++;
        if (a.active !== b.active) flips++;
      }

      console.log([`\n=== ${rec.id}: ${updates.length} updates`,
        `  active speaker right at the verdict: ${right}/${scored} (${(100 * right / Math.max(1, scored)).toFixed(0)}%)`,
        `  switch latency over ${changes} turn changes: median ${q(0.5)} s, p90 ${q(0.9)} s, never within the turn: ${never}`,
        `  false flips while the same person kept speaking: ${flips}/${stable}`,
      ].join('\n'));
    });
  }
});
