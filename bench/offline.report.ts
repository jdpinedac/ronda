/**
 * Clustering experiments on stored embeddings. No models run, so this takes
 * seconds and is the place to try a clustering change before paying for a
 * full run of accuracy.report.ts.
 *
 * bench/fixtures/ami-ES2004a-embeddings.json holds the 227 real embeddings
 * Ronda extracts from the full AMI ES2004a meeting (four people, 17.5 min,
 * single distant microphone), each labelled with the annotated speaker.
 *
 *     npm run bench:offline
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  agglomerative, absorbTinyClusters, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom,
  cosineDistance, DEFAULT_THRESHOLD,
} from '../src/engine/clustering.js';
import { ROOT } from './node-models.js';

interface Fixture {
  name: string; people: number; totalMs: number;
  spans: { startMs: number; endMs: number; speaker: number }[];
  truthLabels: string[];
  vectors: number[][];
}
const fx = JSON.parse(readFileSync(`${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`, 'utf8')) as Fixture;
const V = fx.vectors.map((v) => Float32Array.from(v));
const durs = fx.spans.map((s) => s.endMs - s.startMs);
const count = (l: readonly number[]) => new Set(l).size;
const f2 = (x: number) => x.toFixed(2);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN; };

/** Cluster → annotated speaker, by speech time. */
function composition(labels: readonly number[]): string {
  const byC = new Map<number, Map<string, number>>();
  labels.forEach((c, i) => {
    const m = byC.get(c) ?? new Map<string, number>();
    m.set(fx.truthLabels[i]!, (m.get(fx.truthLabels[i]!) ?? 0) + durs[i]!);
    byC.set(c, m);
  });
  return [...byC.entries()].sort((a, b) => a[0] - b[0]).map(([c, m]) =>
    `#${c}{${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / 1000).toFixed(0)}s`).join(' ')}}`).join('  ');
}

describe(`offline: ${fx.name}`, () => {
  it('distances between and within annotated speakers', () => {
    const within: number[] = []; const between: number[] = [];
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const a = fx.truthLabels[i]!, b = fx.truthLabels[j]!;
      if (a === '?' || a === 'mixed' || b === '?' || b === 'mixed') continue;
      (a === b ? within : between).push(cosineDistance(V[i]!, V[j]!));
    }
    console.log([
      `samples=${V.length}`,
      `within-speaker  p10=${f2(q(within, 0.1))} p50=${f2(q(within, 0.5))} p90=${f2(q(within, 0.9))} max=${f2(Math.max(...within))}  above ${DEFAULT_THRESHOLD}: ${(100 * within.filter((x) => x > DEFAULT_THRESHOLD).length / within.length).toFixed(0)}%`,
      `between-speaker p10=${f2(q(between, 0.1))} p50=${f2(q(between, 0.5))} p90=${f2(q(between, 0.9))} min=${f2(Math.min(...between))}`,
    ].join('\n'));
  });

  it('automatic mode: speakers found against minutes of conversation', () => {
    const rows = ['  min  samples  raw  shown  cluster sizes'];
    for (const min of [1.5, 3, 5, 8, 11, 14, 17.5]) {
      const n = fx.spans.filter((s) => s.endMs <= min * 60000).length;
      const v = V.slice(0, n); const du = durs.slice(0, n);
      const raw = agglomerative(v, { threshold: DEFAULT_THRESHOLD });
      const shown = absorbTinyClusters(v, raw, du, { minSegments: 2, minDurationMs: 2000 });
      const sizes = [...new Set(shown)].map((l) => shown.filter((x) => x === l).length).sort((a, b) => b - a);
      rows.push(`${String(min).padStart(5)}  ${String(n).padStart(7)}  ${String(count(raw)).padStart(3)}  ${String(count(shown)).padStart(5)}  ${sizes.join(',')}`);
    }
    console.log(rows.join('\n'));
  });

  it('automatic mode: threshold sweep on the full meeting', () => {
    console.log([0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((th) => {
      const raw = agglomerative(V, { threshold: th });
      const shown = absorbTinyClusters(V, raw, durs, { minSegments: 2, minDurationMs: 2000 });
      return `${th}: ${count(raw)}→${count(shown)}`;
    }).join('   '));
  });

  it(`head count known (k=${fx.people}): cut at exactly k, the failure ADR 0005 fixes`, () => {
    const labels = keepBusiest(agglomerative(centreEmbeddings(V), { k: fx.people }), durs, fx.people);
    console.log(composition(labels));
  });

  it(`head count known (k=${fx.people}): as shipped, with splinter headroom placed back`, () => {
    const C = centreEmbeddings(V);
    const wide = agglomerative(C, { k: fx.people + splinterHeadroom(C.length) });
    console.log(composition(placeSplinters(C, keepBusiest(wide, durs, fx.people), durs)));
  });
});
