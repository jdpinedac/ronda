/**
 * The two remaining sources of missed speech, measured.
 *
 * 1. Speech the segmentation model hears as silence: is it at the edges of
 *    annotated turns (the annotation's generosity) or inside them (a miss)?
 * 2. Overlap: what happens to DER if the spans the model hears as two voices
 *    are credited to a neighbour in time instead of left unattributed.
 *
 * Needs a dump of the recording (bench/out/<id>.json or the fixture) for the
 * clustering labels; runs only the segmentation model.
 *
 *     REC=ES2004a npm run bench -- bench/overlap.report.ts
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
import { loadModels, runSegmentation, SEGMENTATION_CLASSES, SAMPLE_RATE } from '../src/engine/models.js';
import { decodeSegmentation, type Span } from '../src/engine/segmentation.js';
import { windowPlan } from '../src/engine/windows.js';
import { agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom } from '../src/engine/clustering.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';
import { readAudio16k, ROOT } from './node-models.js';

interface Dump { people: number; totalMs: number; spans: { startMs: number; endMs: number; speaker: number }[]; vectors: number[][] }
const TD = `${ROOT}/public/testdata`;
const IDS = ['ami-ES2004a', 'ami-IS1009a', 'ami-TS3003a', 'ami-meeting'].filter((id) => id.includes(process.env.REC ?? ''));
const ms2s = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const FRAME = 10;

describe('silence inside annotated speech, and overlap attribution', () => {
  for (const id of IDS) {
    it(id, async () => {
      const dumpPath = existsSync(`${ROOT}/bench/out/${id}.json`) ? `${ROOT}/bench/out/${id}.json` : `${ROOT}/bench/fixtures/${id}-embeddings.json`;
      if (!existsSync(`${TD}/${id}.wav`) || !existsSync(dumpPath)) { console.log(`skip ${id}`); return; }
      const truth = JSON.parse(readFileSync(`${TD}/${id}.truth.json`, 'utf8')) as { turns: Turn[] };
      const d = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump;
      const audio = readAudio16k(`${TD}/${id}.wav`);
      const totalMs = (audio.length / SAMPLE_RATE) * 1000;
      const { segmentation } = await loadModels();
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

      // --- 1. silence heard inside annotated single-speaker speech: distance to the turn's edge ---
      const n = Math.ceil(totalMs / FRAME);
      const refCount = new Uint8Array(n);
      const edgeDist = new Float32Array(n).fill(Infinity);
      for (const t of truth.turns) {
        for (let f = Math.floor(t.startMs / FRAME); f < Math.min(n, Math.ceil(t.endMs / FRAME)); f++) {
          refCount[f] = (refCount[f]! + 1) as number;
          const ms = f * FRAME + FRAME / 2;
          edgeDist[f] = Math.min(edgeDist[f]!, ms - t.startMs, t.endMs - ms);
        }
      }
      const hypSilence = new Uint8Array(n);
      for (const s of all) if (s.speakers.length === 0) for (let f = Math.floor(s.startMs / FRAME); f < Math.min(n, Math.ceil(s.endMs / FRAME)); f++) hypSilence[f] = 1;
      const buckets = [[0, 250], [250, 500], [500, 1000], [1000, 2000], [2000, Infinity]] as const;
      const counts = buckets.map(() => 0);
      for (let f = 0; f < n; f++) if (refCount[f] === 1 && hypSilence[f]) { const dd = edgeDist[f]!; counts[buckets.findIndex(([a, b]) => dd >= a && dd < b)]!++; }
      const totSil = counts.reduce((a, b) => a + b, 0);
      const out = [`\n=== ${id}`, `  speech heard as silence, ${(totSil * FRAME / 1000).toFixed(0)} s, by distance from the annotated turn's edge: ` +
        buckets.map(([a, b], i) => `${a}-${b === Infinity ? '' : b} ms: ${(100 * counts[i]! / totSil).toFixed(0)}%`).join('  ')];

      // --- 2. overlap attribution ---
      const V = centreEmbeddings(d.vectors.map((v) => Float32Array.from(v)));
      const w = d.spans.map((s) => (s.endMs - s.startMs) / 1000);
      const k = d.people;
      const labels = placeSplinters(V, keepBusiest(agglomerative(V, { k: k + splinterHeadroom(V.length) }), w, k), w);
      const attributed: Turn[] = d.spans.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: labels[i]! }));
      const overlaps = all.filter((s) => s.speakers.length > 1);
      const overlapMs = overlaps.reduce((a, s) => a + s.endMs - s.startMs, 0);
      const before = (t: Span) => [...attributed].filter((a) => a.endMs <= t.startMs + 1).sort((a, b) => b.endMs - a.endMs)[0];
      const after = (t: Span) => [...attributed].filter((a) => a.startMs >= t.endMs - 1).sort((a, b) => a.startMs - b.startMs)[0];
      const rules: [string, (o: Span) => Turn[]][] = [
        ['none (as shipped)', () => []],
        ['to the speaker before', (o) => { const p = before(o); return p ? [{ ...o, speaker: p.speaker }] : []; }],
        ['to the speaker after', (o) => { const q = after(o); return q ? [{ ...o, speaker: q.speaker }] : []; }],
        ['to the nearer in time', (o) => { const p = before(o), q = after(o); const dp = p ? o.startMs - p.endMs : Infinity, dq = q ? q.startMs - o.endMs : Infinity; const s = dp <= dq ? p : q; return s ? [{ ...o, speaker: s.speaker }] : []; }],
        ['first half before, second half after', (o) => { const p = before(o), q = after(o); const mid = (o.startMs + o.endMs) / 2; const r: Turn[] = []; if (p) r.push({ startMs: o.startMs, endMs: mid, speaker: p.speaker }); if (q) r.push({ startMs: mid, endMs: o.endMs, speaker: q.speaker }); return r; }],
        ['to before, only if within 1 s', (o) => { const p = before(o); return p && o.startMs - p.endMs < 1000 ? [{ ...o, speaker: p.speaker }] : []; }],
      ];
      out.push(`  overlap heard: ${(overlapMs / 1000).toFixed(0)} s in ${overlaps.length} spans`);
      for (const [name, rule] of rules) {
        const hyp = [...attributed, ...overlaps.flatMap(rule)];
        const r = diarizationErrorRate(truth.turns, hyp, totalMs);
        out.push(`  ${name.padEnd(40)} DER=${r.der.toFixed(3)} miss=${(r.missedMs / 1000).toFixed(0).padStart(3)}s conf=${(r.confusionMs / 1000).toFixed(0).padStart(3)}s fa=${(r.falseAlarmMs / 1000).toFixed(0).padStart(2)}s`);
      }
      console.log(out.join('\n'));
    });
  }
});
