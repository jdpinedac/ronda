/**
 * Temporal smoothing of labels after clustering.
 *
 * A sample surrounded in time by another person's samples is more likely
 * theirs than the embedding alone says; a change of speaker should cost
 * something. Viterbi over the sequence of samples: the cost of assigning a
 * sample to a group is its distance to that group's centroid, plus a penalty
 * for every switch between consecutive samples, scaled by how close in time
 * they are. Scored with DER and share error against annotation.
 *
 *     npm run bench -- bench/smooth.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom, cosineDistance, normalise, OTHER_VOICE } from '../src/engine/clustering.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';
import { ROOT } from './node-models.js';

interface Dump { name: string; people: number; totalMs: number; spans: { startMs: number; endMs: number; speaker: number }[]; truthLabels: string[] | null; vectors: number[][] }
const CASES = [
  ['ami-ES2004a', `${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`, `${ROOT}/public/testdata/ami-ES2004a.truth.json`],
  ['ami-IS1009a', `${ROOT}/bench/out/ami-IS1009a.json`, `${ROOT}/public/testdata/ami-IS1009a.truth.json`],
  ['ami-TS3003a', `${ROOT}/bench/out/ami-TS3003a.json`, `${ROOT}/public/testdata/ami-TS3003a.truth.json`],
  ['ami-meeting', `${ROOT}/bench/out/ami-meeting.json`, `${ROOT}/public/testdata/ami-meeting.truth.json`],
  ['two-women', `${ROOT}/bench/out/two-women.json`, `${ROOT}/public/testdata/two-women.truth.json`],
] as const;

function centroids(V: Float32Array[], w: number[], labels: number[]): Map<number, Float32Array> {
  const acc = new Map<number, Float32Array>();
  labels.forEach((l, i) => {
    if (l === OTHER_VOICE) return;
    const c = acc.get(l) ?? new Float32Array(V[0]!.length);
    for (let d = 0; d < c.length; d++) c[d] = c[d]! + V[i]![d]! * w[i]!;
    acc.set(l, c);
  });
  return new Map([...acc.entries()].map(([l, c]) => [l, normalise(c)]));
}

/** Viterbi over samples; switching between consecutive samples costs `penalty` × exp(-gap/tau). */
function smooth(V: Float32Array[], spans: Dump['spans'], labels: number[], w: number[], penalty: number, tauMs: number): number[] {
  const cents = centroids(V, w, labels);
  const ids = [...cents.keys()];
  const n = V.length; const k = ids.length;
  if (k === 0) return labels;
  const cost = new Float64Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) cost[i * k + j] = cosineDistance(V[i]!, cents.get(ids[j]!)!);
  const dp = new Float64Array(n * k); const back = new Int32Array(n * k);
  for (let j = 0; j < k; j++) dp[j] = cost[j]!;
  for (let i = 1; i < n; i++) {
    const gap = Math.max(0, spans[i]!.startMs - spans[i - 1]!.endMs);
    const sw = penalty * Math.exp(-gap / tauMs);
    for (let j = 0; j < k; j++) {
      let best = Infinity, arg = 0;
      for (let p = 0; p < k; p++) { const v = dp[(i - 1) * k + p]! + (p === j ? 0 : sw); if (v < best) { best = v; arg = p; } }
      dp[i * k + j] = best + cost[i * k + j]!; back[i * k + j] = arg;
    }
  }
  const out = new Array<number>(n);
  let j = 0; for (let q = 1; q < k; q++) if (dp[(n - 1) * k + q]! < dp[(n - 1) * k + j]!) j = q;
  for (let i = n - 1; i >= 0; i--) { out[i] = ids[j]!; j = back[i * k + j]!; }
  return out;
}

function score(d: Dump, truth: { turns: Turn[] }, labels: number[]) {
  const hyp: Turn[] = d.spans.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: labels[i]! })).filter((t) => t.speaker !== OTHER_VOICE);
  const der = diarizationErrorRate(truth.turns, hyp, d.totalMs);
  const tot = new Map<number, number>(); labels.forEach((l, i) => { if (l !== OTHER_VOICE) tot.set(l, (tot.get(l) ?? 0) + d.spans[i]!.endMs - d.spans[i]!.startMs); });
  const hypSum = [...tot.values()].reduce((a, b) => a + b, 0);
  const ref = new Map<string, number>(); for (const t of truth.turns) ref.set(String(t.speaker), (ref.get(String(t.speaker)) ?? 0) + t.endMs - t.startMs);
  const refSum = [...ref.values()].reduce((a, b) => a + b, 0);
  let l1 = 0; const seen = new Set<string>();
  for (const [l, ms] of tot) { const who = der.mapping[String(l)]; const rs = who ? (ref.get(who) ?? 0) / refSum : 0; if (who) seen.add(who); l1 += Math.abs(ms / hypSum - rs); }
  for (const [who, ms] of ref) if (!seen.has(who)) l1 += ms / refSum;
  const shares = [...tot.values()].sort((a, b) => b - a).map((v) => Math.round(100 * v / hypSum)).join('/');
  return `DER=${der.der.toFixed(3)} conf=${(der.confusionMs / 1000).toFixed(0).padStart(3)}s share-error=${(50 * l1).toFixed(1).padStart(4)}%  ${shares}`;
}

describe('temporal smoothing of labels', () => {
  for (const [id, dump, truthPath] of CASES) {
    if (!existsSync(dump) || !existsSync(truthPath)) continue;
    it(id, () => {
      const d = JSON.parse(readFileSync(dump, 'utf8')) as Dump;
      const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as { turns: Turn[] };
      const V = centreEmbeddings(d.vectors.map((v) => Float32Array.from(v)));
      const w = d.spans.map((s) => (s.endMs - s.startMs) / 1000);
      const k = d.people;
      const base = placeSplinters(V, keepBusiest(agglomerative(V, { k: k + splinterHeadroom(V.length) }), w, k), w);
      const rows = [`\n=== ${id}  n=${V.length}`, `  ${'shipped'.padEnd(28)} ${score(d, truth, base)}`];
      for (const [pen, tau] of [[0.1, 2000], [0.2, 2000], [0.3, 2000], [0.5, 2000], [0.3, 5000], [0.3, 500]] as const) {
        rows.push(`  ${`smooth penalty=${pen} tau=${tau / 1000}s`.padEnd(28)} ${score(d, truth, smooth(V, d.spans, base, w, pen, tau))}`);
      }
      console.log(rows.join('\n'));
    });
  }
});
