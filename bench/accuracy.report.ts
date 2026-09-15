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
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
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
  { name: 'four-speakers-zh (clean, 57 s)', path: `${TD}/0-four-speakers-zh.wav`, people: 4 },
  { name: 'with-distant-voices (90 s)', path: `${TD}/with-distant-voices.wav`, people: 4 },
  { name: 'distant-in-gaps (90 s)', path: `${TD}/distant-in-gaps.wav`, people: 4 },
  { name: 'real-phone-on-table (34 s)', path: `${TD}/real-phone-on-table.wav`, people: 2 },
];
const filter = process.env.REC ?? '';
const pct = (xs: number[]) => xs.map((x) => Math.round(x * 100)).join('/');
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

      const counted = await diarize(audio, { speakerCount: rec.people });
      out.push(`[file, count=${rec.people}]    speakers=${String(counted.speakers.length).padStart(2)}  shares=${pct(counted.speakers.map((s) => s.share))}${der(counted.spans)}  reliability=${counted.reliability}  dropped-as-distant=${sec(counted.diagnostics.backgroundMs)}s`);

      const l0 = await live(audio, {});
      out.push(`[live, no count]   speakers=${String(l0.state.speakers.length).padStart(2)}  shares=${pct(l0.state.speakers.map((s) => s.share))}  over time: ${l0.history.join(',')}`);
      const l1 = await live(audio, { speakerCount: rec.people });
      out.push(`[live, count=${rec.people}]    speakers=${String(l1.state.speakers.length).padStart(2)}  shares=${pct(l1.state.speakers.map((s) => s.share))}`);
      console.log(out.join('\n'));
    });
  }
});
