/**
 * Re-embeds recordings with a different segment-to-embedding strategy and
 * dumps the result in the same shape as accuracy.report.ts, so
 * longform.report.ts can score it.
 *
 * Today Ronda takes one embedding per single-speaker span, however long. The
 * standard practice in diarization is fixed windows with overlap: a span is
 * cut into windows of WIN seconds every HOP seconds, and each window is
 * embedded on its own. Short spans are embedded whole.
 *
 *     EMB=win2 REC=ES2004a npm run bench -- bench/embedding.report.ts
 *     EMB=span EMB_MODEL=fp32 npm run bench -- bench/embedding.report.ts   # other weights, same strategy
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
import { computeFbank, WESPEAKER_FBANK } from '../src/engine/fbank.js';
import { normalise } from '../src/engine/clustering.js';
import { loadModels, runSegmentation, runEmbedding, SEGMENTATION_CLASSES, SAMPLE_RATE } from '../src/engine/models.js';
import { decodeSegmentation, speechSpans, type Span } from '../src/engine/segmentation.js';
import { rms, selectForeground } from '../src/engine/levels.js';
import { windowPlan } from '../src/engine/windows.js';
import { readAudio16k, ROOT, embeddingModel } from './node-models.js';
import type { Turn } from '../src/metrics/der.js';

const TD = `${ROOT}/public/testdata`;
const RECORDINGS = [
  { id: 'ami-ES2004a', people: 4 }, { id: 'ami-IS1009a', people: 4 }, { id: 'ami-TS3003a', people: 4 },
  { id: 'ami-meeting', people: 4 }, { id: 'two-women', people: 2 },
];
const STRATEGIES: Record<string, { winMs: number; hopMs: number }> = {
  /** One embedding per span, as Ronda does today. Useful with EMB_MODEL. */
  span: { winMs: Infinity, hopMs: Infinity },
  /** Spans that touch across a window boundary are joined before embedding. */
  merged: { winMs: Infinity, hopMs: Infinity },
  win2: { winMs: 2000, hopMs: 1000 },
  win3: { winMs: 3000, hopMs: 1500 },
  win15: { winMs: 1500, hopMs: 750 },
};
const strategy = process.env.EMB ?? 'win2';
const tag = embeddingModel === 'int8' ? strategy : `${strategy}-${embeddingModel}`;
const filter = process.env.REC ?? '';
const ms2s = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);

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

/** Same segment stage as diarize(): windows, trust regions, single speaker, >= 800 ms, foreground. */
async function usableSpans(audio: Float32Array): Promise<Span[]> {
  const { segmentation } = await loadModels();
  const totalMs = (audio.length / SAMPLE_RATE) * 1000;
  const all: Span[] = [];
  for (const w of windowPlan(totalMs, 10_000, 5_000)) {
    const logits = await runSegmentation(segmentation, audio.slice(ms2s(w.startMs), ms2s(w.endMs)));
    for (const s of decodeSegmentation(logits, SEGMENTATION_CLASSES, w.endMs - w.startMs)) {
      const startMs = Math.max(s.startMs + w.startMs, w.trustFromMs);
      const endMs = Math.min(s.endMs + w.startMs, w.trustToMs);
      if (endMs > startMs) all.push({ startMs, endMs, speakers: s.speakers });
    }
  }
  all.sort((a, b) => a.startMs - b.startMs);
  const candidates = speechSpans(all, 800);
  const fg = selectForeground(candidates.map((s) => rms(audio.subarray(ms2s(s.startMs), ms2s(s.endMs)))));
  return candidates.filter((_, i) => fg[i]);
}

describe(`re-embedding with ${strategy}`, () => {
  const { winMs, hopMs } = STRATEGIES[strategy]!;
  for (const rec of RECORDINGS.filter((r) => r.id.includes(filter))) {
    it(rec.id, async () => {
      const wav = rec.id === 'ami-meeting' || rec.id === 'two-women' ? `${TD}/${rec.id}.wav` : `${TD}/${rec.id}.wav`;
      if (!existsSync(wav)) { console.log(`skip ${rec.id}`); return; }
      const truth = JSON.parse(readFileSync(`${TD}/${rec.id}.truth.json`, 'utf8')) as { turns: Turn[] };
      const audio = readAudio16k(wav);
      const totalMs = (audio.length / SAMPLE_RATE) * 1000;
      const { embedding } = await loadModels();
      let spans = await usableSpans(audio);
      if (strategy === 'merged') {
        // The trust regions tile the timeline every 5 s, so a single turn that
        // crosses a boundary comes back as two spans that touch. Join them.
        const joined: Span[] = [];
        for (const s of spans) {
          const last = joined[joined.length - 1];
          if (last && s.startMs - last.endMs < 60) last.endMs = s.endMs; else joined.push({ ...s });
        }
        spans = joined;
      }
      const pieces: { startMs: number; endMs: number }[] = [];
      for (const s of spans) {
        const len = s.endMs - s.startMs;
        if (len <= winMs) { pieces.push({ startMs: s.startMs, endMs: s.endMs }); continue; }
        for (let a = s.startMs; a + winMs <= s.endMs + hopMs / 2; a += hopMs) {
          pieces.push({ startMs: a, endMs: Math.min(a + winMs, s.endMs) });
        }
      }
      const t0 = Date.now();
      const vectors: number[][] = [];
      for (const p of pieces) {
        const { frames, numBins } = computeFbank(audio.slice(ms2s(p.startMs), ms2s(p.endMs)), WESPEAKER_FBANK);
        const raw = await runEmbedding(embedding, frames, frames.length / numBins, numBins);
        vectors.push(Array.from(normalise(Float32Array.from(raw)), (x) => Math.round(x * 1e4) / 1e4));
      }
      writeFileSync(`${ROOT}/bench/out/${rec.id}.${tag}.json`, JSON.stringify({
        name: `${rec.id} ${tag}`, people: rec.people, totalMs,
        spans: pieces.map((p) => ({ ...p, speaker: 0 })),
        truthLabels: pieces.map((p) => trueSpeakerOf(p, truth.turns)),
        vectors,
      }));
      console.log(`${rec.id} ${tag}: ${spans.length} spans -> ${pieces.length} embeddings in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    });
  }
});
