/**
 * Measures Ronda's real pipeline on real recordings, in Node.
 *
 * Runs the unmodified diarize() and startLiveSession() with the ONNX models,
 * with and without the head count, and prints speaker count, share of the
 * floor and — where human annotation exists — the diarization error rate.
 *
 * Recordings live in public/testdata/ (not committed). The bundled 90-second
 * example always runs; the rest are skipped when missing. The full AMI meeting
 * matters most: on it, the number of speakers the automatic mode finds grows
 * with the length of the conversation. See ADR 0004.
 *
 *     npm run bench                      # everything present
 *     REC=meeting npm run bench          # substring filter on the name
 *     BENCH_DUMP=1 npm run bench         # also write embeddings to bench/out/
 *     BENCH_DUMP=only npm run bench      # write embeddings and stop; a quarter of the time
 *     BENCH_ONLY_COUNT=1 BG_RATIO=0 ...  # file path with the count only, background filter off
 *     BENCH_ONLY_COUNT=1 BENCH_BG=1 ...   # ... with "a television is audible" ticked
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
// BG_RATIO overrides the background level ratio, to measure the filter itself.
vi.mock('../src/engine/levels.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/engine/levels.js')>();
  const ratio = process.env.BG_RATIO !== undefined ? Number(process.env.BG_RATIO) : m.BACKGROUND_LEVEL_RATIO;
  return { ...m, selectForeground: (levels: readonly number[]) => m.selectForeground(levels, ratio) };
});
import { diarize } from '../src/engine/diarize.js';
import { startLiveSession } from '../src/engine/live.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';
import { readAudio16k, captured, resetCaptured, ROOT } from './node-models.js';

const TD = `${ROOT}/public/testdata`;
const RECORDINGS: { name: string; path: string; people: number; truth?: string }[] = [
  { name: 'example/meeting (AMI, 90 s)', path: `${ROOT}/public/example/meeting.wav`, people: 4, truth: `${ROOT}/public/example/meeting.truth.json` },
  { name: 'ami-meeting (AMI, 3 min)', path: `${TD}/ami-meeting.wav`, people: 4, truth: `${TD}/ami-meeting.truth.json` },
  { name: 'two-women (AMI, 4 min)', path: `${TD}/two-women.wav`, people: 2, truth: `${TD}/two-women.truth.json` },
  { name: 'ami-ES2004a (AMI, full 17.5 min)', path: `${TD}/ami-ES2004a.wav`, people: 4, truth: `${TD}/ami-ES2004a.truth.json` },
  { name: 'ami-IS1009a (AMI, full 13.4 min)', path: `${TD}/ami-IS1009a.wav`, people: 4, truth: `${TD}/ami-IS1009a.truth.json` },
  { name: 'ami-TS3003a (AMI, full 24.6 min)', path: `${TD}/ami-TS3003a.wav`, people: 4, truth: `${TD}/ami-TS3003a.truth.json` },
  { name: 'four-speakers-zh (clean, 57 s)', path: `${TD}/0-four-speakers-zh.wav`, people: 4 },
  // The same 90 s as the example, with voices from another table mixed in:
  // under the speech, and in the gaps. Scored against the example's annotation,
  // so anything attributed to the intruders counts as a false alarm.
  { name: 'with-distant-voices (90 s)', path: `${TD}/with-distant-voices.wav`, people: 4, truth: `${ROOT}/public/example/meeting.truth.json` },
  { name: 'distant-in-gaps (90 s)', path: `${TD}/distant-in-gaps.wav`, people: 4, truth: `${ROOT}/public/example/meeting.truth.json` },
  { name: 'real-phone-on-table (34 s)', path: `${TD}/real-phone-on-table.wav`, people: 2 },
];
const filter = process.env.REC ?? '';
const pct = (xs: number[]) => xs.map((x) => Math.round(x * 100)).join('/');

/**
 * Share error: how much of the floor is credited to the wrong person. Half
 * the L1 distance between Ronda's shares and the annotated ones, after
 * matching Ronda's speakers to annotated speakers the way DER does. The
 * annotated shares count overlap for everyone speaking, which is what a
 * table wants to know and what DER — one speaker per instant — cannot score.
 */
function shareError(truth: { turns: Turn[] }, speakers: { id: number; totalMs: number }[], mapping: Record<string, string>): { error: number; truthShares: string } {
  const ref = new Map<string, number>();
  for (const t of truth.turns) ref.set(String(t.speaker), (ref.get(String(t.speaker)) ?? 0) + t.endMs - t.startMs);
  const refSum = [...ref.values()].reduce((a, b) => a + b, 0);
  const hypSum = speakers.reduce((a, s) => a + s.totalMs, 0);
  let l1 = 0;
  const seen = new Set<string>();
  for (const s of speakers) {
    const who = mapping[String(s.id)];
    const hypShare = hypSum > 0 ? s.totalMs / hypSum : 0;
    const refShare = who !== undefined ? (ref.get(who) ?? 0) / refSum : 0;
    if (who !== undefined) seen.add(who);
    l1 += Math.abs(hypShare - refShare);
  }
  for (const [who, ms] of ref) if (!seen.has(who)) l1 += ms / refSum;
  return { error: l1 / 2, truthShares: pct([...ref.values()].sort((a, b) => b - a).map((v) => v / refSum)) };
}
const sec = (ms: number) => (ms / 1000).toFixed(1);

/** Which annotated speaker a span mostly belongs to; 'mixed' when two share it. */
function trueSpeakerOf(span: { startMs: number; endMs: number }, turns: Turn[]): string {
  const ov = new Map<string, number>();
  for (const t of turns) {
    const o = Math.min(span.endMs, t.endMs) - Math.max(span.startMs, t.startMs);
    if (o > 0) ov.set(String(t.speaker), (ov.get(String(t.speaker)) ?? 0) + o);
  }
  const sorted = [...ov.entries()].sort((a, b) => b[1] - a[1]);
  const dur = span.endMs - span.startMs;
  if (sorted.length === 0) return '?';
  if (sorted.length > 1 && sorted[1]![1] > 0.25 * dur) return 'mixed';
  return sorted[0]![1] > 0.5 * dur ? sorted[0]![0] : '?';
}

async function live(audio: Float32Array, opts: Parameters<typeof startLiveSession>[0]) {
  const session = await startLiveSession(opts);
  const history: number[] = [];
  session.onUpdate((s) => history.push(s.speakers.length));
  for (let off = 0; off < audio.length; off += 16000) session.push(audio.slice(off, Math.min(off + 16000, audio.length)));
  // push() analyses asynchronously; wait until the count stops changing.
  for (;;) {
    const n = history.length;
    await new Promise((r) => setTimeout(r, 250));
    if (history.length === n) break;
  }
  await session.flush();
  const state = session.state();
  session.dispose();
  return { state, history };
}

describe('accuracy', () => {
  for (const rec of RECORDINGS.filter((r) => r.name.includes(filter))) {
    it(rec.name, async () => {
      if (!existsSync(rec.path)) { console.log(`\n--- ${rec.name}: not present, skipped`); return; }
      const audio = readAudio16k(rec.path);
      const totalMs = (audio.length / 16000) * 1000;
      const truth = rec.truth && existsSync(rec.truth)
        ? JSON.parse(readFileSync(rec.truth, 'utf8')) as { turns: Turn[] } : null;
      const out = [`\n=== ${rec.name} — ${rec.people} people, ${sec(totalMs)} s`];
      const der = (spans: Turn[]) => truth
        ? `  DER=${diarizationErrorRate(truth.turns, spans, totalMs).der.toFixed(3)}` : '';

      if (process.env.BENCH_ONLY_COUNT) {
        const bg = process.env.BENCH_BG === '1';
        const r = await diarize(audio, { speakerCount: rec.people, backgroundVoices: bg });
        const d = diarizationErrorRate(truth?.turns ?? [], r.spans, totalMs);
        const se = truth ? shareError(truth, r.speakers, d.mapping) : null;
        out.push(`[file, count=${rec.people}${bg ? ', tv on' : ''}]  speakers=${r.speakers.length}  shares=${pct(r.speakers.map((s) => s.share))}${se ? ` (true ${se.truthShares}) share-error=${(100 * se.error).toFixed(1)}%` : ''}  DER=${d.der.toFixed(3)} miss=${sec(d.missedMs)} fa=${sec(d.falseAlarmMs)} conf=${sec(d.confusionMs)}  overlap heard=${sec(r.overlapMs)}s credited=${Math.round(100 * r.overlapShare)}%${r.overlapHeavy ? ' HEAVY' : ''}  dropped-as-distant=${sec(r.diagnostics.backgroundMs)}s`);
        console.log(out.join('\n'));
        return;
      }
      resetCaptured();
      const auto = await diarize(audio, {});
      out.push(`[file, no count]   speakers=${String(auto.speakers.length).padStart(2)}  shares=${pct(auto.speakers.map((s) => s.share))}${der(auto.spans)}  reliability=${auto.reliability}`);
      if (process.env.BENCH_DUMP) {
        writeFileSync(`${ROOT}/bench/out/${rec.name.split(' ')[0]!.replace('/', '_')}.json`, JSON.stringify({
          name: rec.name, people: rec.people, totalMs,
          spans: auto.spans,
          truthLabels: truth ? auto.spans.map((s) => trueSpeakerOf(s, truth.turns)) : null,
          vectors: captured.map((v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4)),
        }));
      }

      if (process.env.BENCH_DUMP === 'only') { console.log(out.join('\n')); return; }

      const counted = await diarize(audio, { speakerCount: rec.people });
      const seCounted = truth ? shareError(truth, counted.speakers, diarizationErrorRate(truth.turns, counted.spans, totalMs).mapping) : null;
      out.push(`[file, count=${rec.people}]    speakers=${String(counted.speakers.length).padStart(2)}  shares=${pct(counted.speakers.map((s) => s.share))}${seCounted ? ` (true ${seCounted.truthShares}) share-error=${(100 * seCounted.error).toFixed(1)}%` : ''}${der(counted.spans)}  reliability=${counted.reliability}  overlap credited=${Math.round(100 * counted.overlapShare)}%${counted.overlapHeavy ? ' HEAVY' : ''}  dropped-as-distant=${sec(counted.diagnostics.backgroundMs)}s`);

      const l0 = await live(audio, {});
      out.push(`[live, no count]   speakers=${String(l0.state.speakers.length).padStart(2)}  shares=${pct(l0.state.speakers.map((s) => s.share))}  over time: ${l0.history.join(',')}`);
      const l1 = await live(audio, { speakerCount: rec.people });
      out.push(`[live, count=${rec.people}]    speakers=${String(l1.state.speakers.length).padStart(2)}  shares=${pct(l1.state.speakers.map((s) => s.share))}  overlap credited=${Math.round(100 * l1.state.overlapShare)}%${l1.state.overlapHeavy ? ' HEAVY' : ''}`);
      console.log(out.join('\n'));
    });
  }
});
