/**
 * Scores every embedding dump in bench/out (and the committed fixture) with the
 * few clustering variants still under consideration, plus the oracle that
 * assigns each segment to its annotated speaker's centroid — the floor any
 * centroid-based method can reach with these embeddings.
 *
 *     npm run bench -- bench/score.report.ts
 *     REC=win2 npm run bench -- bench/score.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { agglomerative, centreEmbeddings, keepBusiest, cosineDistance, normalise, OTHER_VOICE, placeSplinters, splinterHeadroom } from '../src/engine/clustering.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';
import { ROOT } from './node-models.js';

interface Dump { name: string; people: number; totalMs: number; spans: { startMs: number; endMs: number; speaker: number }[]; truthLabels: string[] | null; vectors: number[][] }
type Vec = Float32Array;
const TRUTH: Record<string, string> = {
  'ami-ES2004a': `${ROOT}/public/testdata/ami-ES2004a.truth.json`,
  'ami-IS1009a': `${ROOT}/public/testdata/ami-IS1009a.truth.json`,
  'ami-TS3003a': `${ROOT}/public/testdata/ami-TS3003a.truth.json`,
  'example_meeting': `${ROOT}/public/example/meeting.truth.json`,
  'ami-meeting': `${ROOT}/public/testdata/ami-meeting.truth.json`,
  'two-women': `${ROOT}/public/testdata/two-women.truth.json`,
};
const filter = new RegExp(process.env.REC ?? '');
/** Extra clusters to cut before keeping the k busiest: grows with the evidence. */
const adaptiveExtra = (n: number) => Math.min(8, Math.floor(n / 25));
const files = [`${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`,
  ...readdirSync(`${ROOT}/bench/out`).filter((f) => f.endsWith('.json')).map((f) => `${ROOT}/bench/out/${f}`)]
  .filter((f) => filter.test(f));

function centroid(V: readonly Vec[], w: readonly number[], idxs: readonly number[]): Vec {
  const c = new Float32Array(V[0]!.length);
  for (const i of idxs) for (let d = 0; d < c.length; d++) c[d] = c[d]! + V[i]![d]! * w[i]!;
  return normalise(c);
}
function members(labels: readonly number[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  labels.forEach((l, i) => { if (l === OTHER_VOICE) return; const a = m.get(l); if (a) a.push(i); else m.set(l, [i]); });
  return m;
}
const nearest = (v: Vec, cents: { l: number; c: Vec }[]) => { let b = cents[0]!.l, bd = Infinity; for (const { l, c } of cents) { const d = cosineDistance(v, c); if (d < bd) { bd = d; b = l; } } return b; };
function coreThenAssign(V: readonly Vec[], w: readonly number[], k: number, minS: number): number[] {
  const core = w.map((x, i) => (x >= minS ? i : -1)).filter((i) => i >= 0);
  if (core.length < k) return keepBusiest(agglomerative(V, { k }), w, k);
  const CV = core.map((i) => V[i]!); const CW = core.map((i) => w[i]!);
  const cl = agglomerative(CV, { k });
  const cents = [...members(cl).entries()].map(([l, idxs]) => ({ l, c: centroid(CV, CW, idxs) }));
  return V.map((v, i) => { const ci = core.indexOf(i); return ci >= 0 ? cl[ci]! : nearest(v, cents); });
}
function keepAndPlace(V: readonly Vec[], w: readonly number[], k: number, extra: number): number[] {
  const kept = keepBusiest(agglomerative(V, { k: Math.min(k + extra, V.length) }), w, k);
  const cents = [...members(kept).entries()].map(([l, idxs]) => ({ l, c: centroid(V, w, idxs) }));
  return kept.map((l, i) => (l !== OTHER_VOICE ? l : nearest(V[i]!, cents)));
}
/** The policy diarize() ships: cut wide, keep k busiest, place the rest. */
function shipped(V: readonly Vec[], w: readonly number[], k: number): number[] {
  const wide = agglomerative(V, { k: k + splinterHeadroom(V.length) });
  return placeSplinters(V, keepBusiest(wide, w, k), w);
}
/** After the shipped policy, leave out segments shorter than minS: they are not attributed at all. */
function shippedDropShort(V: readonly Vec[], w: readonly number[], k: number, minS: number): number[] {
  return shipped(V, w, k).map((l, i) => (w[i]! < minS ? OTHER_VOICE : l));
}
/** After the shipped policy, leave out segments whose nearest centroid does not win by `margin`. */
function shippedDropAmbiguous(V: readonly Vec[], w: readonly number[], k: number, margin: number): number[] {
  const labels = shipped(V, w, k);
  const cents = [...members(labels).entries()].map(([l, idxs]) => ({ l, c: centroid(V, w, idxs) }));
  return labels.map((l, i) => {
    const ds = cents.map(({ c }) => cosineDistance(V[i]!, c)).sort((a, b) => a - b);
    return ds.length > 1 && ds[1]! - ds[0]! < margin ? OTHER_VOICE : l;
  });
}
/** Does the span start or end on a window trust boundary (2.5 s + 5 s multiples)? */
const onBoundary = (s: { startMs: number; endMs: number }) =>
  [s.startMs, s.endMs].some((t) => Math.abs(((t - 2500) % 5000 + 5000) % 5000) < 60 || Math.abs(((t - 2500) % 5000 + 5000) % 5000 - 5000) < 60);

function score(d: Dump, truth: { turns: Turn[] }, labels: readonly number[]): string {
  const durs = d.spans.map((s) => s.endMs - s.startMs);
  const hyp: Turn[] = d.spans.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: labels[i]! })).filter((t) => t.speaker !== OTHER_VOICE);
  const der = diarizationErrorRate(truth.turns, hyp, d.totalMs);
  const tot = new Map<number, number>();
  labels.forEach((l, i) => { if (l !== OTHER_VOICE) tot.set(l, (tot.get(l) ?? 0) + durs[i]!); });
  const sum = [...tot.values()].reduce((a, b) => a + b, 0);
  let merged = 0;
  if (d.truthLabels) for (const idxs of members(labels).values()) {
    const by = new Map<string, number>();
    for (const i of idxs) { const t = d.truthLabels[i]!; if (t === '?' || t === 'mixed') continue; by.set(t, (by.get(t) ?? 0) + durs[i]!); }
    const s = [...by.values()].sort((a, b) => b - a);
    if (s.length > 1 && s[1]! > 0.3 * (s[0]! + s[1]!)) merged++;
  }
  return `DER=${der.der.toFixed(3)} conf=${(der.confusionMs / 1000).toFixed(0).padStart(3)}s miss=${(der.missedMs / 1000).toFixed(0).padStart(3)}s merged=${merged}  ${[...tot.values()].sort((a, b) => b - a).map((v) => Math.round((100 * v) / sum)).join('/')}`;
}

describe('prefixes of ES2004a (int8): baseline | k+8 | adaptive', () => {
  it('table', () => {
    const d = JSON.parse(readFileSync(`${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`, 'utf8')) as Dump;
    const truth = JSON.parse(readFileSync(TRUTH['ami-ES2004a']!, 'utf8')) as { turns: Turn[] };
    const lines: string[] = [];
    for (const min of [2, 3, 5, 8, 11, 14, 17.5]) {
      const ms = min * 60000;
      const n = d.spans.filter((s) => s.endMs <= ms).length;
      const sub: Dump = { ...d, totalMs: ms, spans: d.spans.slice(0, n), truthLabels: d.truthLabels!.slice(0, n), vectors: d.vectors.slice(0, n) };
      const t = { turns: truth.turns.filter((x) => x.startMs < ms).map((x) => ({ ...x, endMs: Math.min(x.endMs, ms) })) };
      const V = centreEmbeddings(sub.vectors.map((v) => Float32Array.from(v)));
      const w = sub.spans.map((s) => (s.endMs - s.startMs) / 1000);
      const short = (l: number[]) => score(sub, t, l).replace(/ conf=.*merged=/, ' m=');
      lines.push(`  ${String(min).padStart(4)} min n=${String(n).padStart(3)}  ${short(keepBusiest(agglomerative(V, { k: 4 }), w, 4))} | ${short(keepAndPlace(V, w, 4, 8))} | +${adaptiveExtra(n)}: ${short(keepAndPlace(V, w, 4, adaptiveExtra(n)))}`);
    }
    console.log(lines.join('\n'));
  });
});

describe('score', () => {
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, 'utf8')) as Dump;
    const key = Object.keys(TRUTH).find((k) => f.includes(k));
    if (!key || !existsSync(TRUTH[key]!) || !d.truthLabels) continue;
    it(d.name, () => {
      const truth = JSON.parse(readFileSync(TRUTH[key]!, 'utf8')) as { turns: Turn[] };
      const V = centreEmbeddings(d.vectors.map((v) => Float32Array.from(v)));
      const w = d.spans.map((s) => (s.endMs - s.startMs) / 1000);
      const k = d.people;
      const spk = [...new Set(d.truthLabels!.filter((t) => t !== '?' && t !== 'mixed'))].sort();
      const cents = spk.map((s, l) => ({ l, c: centroid(V, w, d.truthLabels!.map((t, i) => (t === s ? i : -1)).filter((i) => i >= 0)) }));
      const closer = d.truthLabels!.filter((t, i) => t !== '?' && t !== 'mixed' && spk[nearest(V[i]!, cents)] !== t).length;
      if (d.truthLabels) {
        const lab = d.truthLabels;
        const mis = (i: number) => lab[i] !== '?' && lab[i] !== 'mixed' && spk[nearest(V[i]!, cents)] !== lab[i];
        const idx = d.spans.map((_, i) => i).filter((i) => lab[i] !== '?' && lab[i] !== 'mixed');
        const b = idx.filter((i) => onBoundary(d.spans[i]!)); const nb = idx.filter((i) => !onBoundary(d.spans[i]!));
        console.log(`  ${d.name}: spans touching a window boundary ${b.length}/${idx.length}; misplaced ${b.filter(mis).length}/${b.length} on-boundary vs ${nb.filter(mis).length}/${nb.length} off`);
      }
      const rows: [string, number[]][] = [
        ['baseline (cut at k)', keepBusiest(agglomerative(V, { k }), w, k)],
        ['shipped (splinters placed)', shipped(V, w, k)],
        ['shipped, drop < 1.5 s', shippedDropShort(V, w, k, 1.5)],
        ['shipped, drop ambiguous 0.1', shippedDropAmbiguous(V, w, k, 0.1)],
        ['shipped, drop ambiguous 0.2', shippedDropAmbiguous(V, w, k, 0.2)],
        ['core>=2s, place rest', coreThenAssign(V, w, k, 2)],
        ['k+8 keep k, place rest', keepAndPlace(V, w, k, 8)],
        [`k+${adaptiveExtra(V.length)} (adaptive) keep k, place`, keepAndPlace(V, w, k, adaptiveExtra(V.length))],
        ['ORACLE nearest true centroid', V.map((v) => nearest(v, cents))],
      ];
      console.log([`\n=== ${d.name}  n=${V.length}  segments closer to another speaker's centroid: ${closer}`,
        ...rows.map(([n, l]) => `  ${n.padEnd(30)} ${score(d, truth, l)}`)].join('\n'));
    });
  }
});
