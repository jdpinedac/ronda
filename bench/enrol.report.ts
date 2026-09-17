/**
 * What a round of introductions would buy. Each annotated speaker's first N
 * seconds of voice samples become their profile, as if they had introduced
 * themselves; the rest of the recording is attributed by nearest profile.
 * Compared against the shipped clustering two ways: with the best possible
 * name mapping (an oracle), and with the mapping a user actually sees — the
 * i-th identity to appear gets the i-th name, and the i-th person to speak
 * is the i-th name's owner.
 *
 *     npm run bench -- bench/enrol.report.ts
 *     REC=ES2004a npm run bench -- bench/enrol.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom, OTHER_VOICE } from '../src/engine/clustering.js';
import { createProfile, addToProfile, nearestProfile, type SpeakerProfile } from '../src/engine/profiles.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';
import { replayLive } from './replay.js';
import { ROOT } from './node-models.js';

interface Dump { name: string; people: number; totalMs: number; spans: { startMs: number; endMs: number }[]; truthLabels: string[] | null; vectors: number[][] }
const TRUTH: Record<string, string> = {
  'ami-ES2004a': `${ROOT}/public/testdata/ami-ES2004a.truth.json`,
  'ami-IS1009a': `${ROOT}/public/testdata/ami-IS1009a.truth.json`,
  'ami-TS3003a': `${ROOT}/public/testdata/ami-TS3003a.truth.json`,
  'ami-meeting': `${ROOT}/public/testdata/ami-meeting.truth.json`,
  'two-women': `${ROOT}/public/testdata/two-women.truth.json`,
};
const filter = new RegExp(process.env.REC ?? '');
const files = [`${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`,
  ...readdirSync(`${ROOT}/bench/out`).filter((f) => /^(ami-IS1009a|ami-TS3003a|ami-meeting|two-women)\.json$/.test(f)).map((f) => `${ROOT}/bench/out/${f}`)]
  .filter((f) => filter.test(f));
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const known = (t: string) => t !== '?' && t !== 'mixed';

describe('a round of introductions', () => {
  for (const file of files) {
    const d = JSON.parse(readFileSync(file, 'utf8')) as Dump;
    if (!d.truthLabels) continue;
    it(d.name, () => {
      const V = d.vectors.map((v) => Float32Array.from(v));
      const C = centreEmbeddings(V);
      const n = V.length;
      const w = d.spans.map((s) => s.endMs - s.startMs);
      const truth = d.truthLabels!;
      const people = [...new Set(truth.filter(known))];
      const k = people.length;
      const scored = truth.map((t, i) => (known(t) ? w[i]! : 0));
      const totalScored = scored.reduce((a, b) => a + b, 0);
      const truthKey = Object.keys(TRUTH).find((key) => d.name.startsWith(key));
      const truthTurns: Turn[] | null = truthKey && existsSync(TRUTH[truthKey]!) ? (JSON.parse(readFileSync(TRUTH[truthKey]!, 'utf8')) as { turns: Turn[] }).turns : null;
      const der = (labels: readonly (string | number)[]) => truthTurns
        ? diarizationErrorRate(truthTurns, d.spans.map((s, i) => ({ ...s, speaker: labels[i]! })).filter((t) => t.speaker !== OTHER_VOICE), d.totalMs).der.toFixed(3)
        : '  n/a';
      /** Time-weighted share of scored speech whose label maps to its annotated speaker. */
      const accuracyWith = (labels: readonly number[], nameOf: (label: number) => string | undefined, only?: (i: number) => boolean) => {
        let ok = 0, tot = 0;
        labels.forEach((l, i) => { if (!known(truth[i]!) || (only && !only(i))) return; tot += w[i]!; if (nameOf(l) === truth[i]) ok += w[i]!; });
        return tot > 0 ? ok / tot : 0;
      };
      /** The best mapping from labels to people, by shared speech. */
      const oracleMap = (labels: readonly number[]) => {
        const shared = new Map<string, number>();
        labels.forEach((l, i) => { if (known(truth[i]!)) shared.set(`${l}|${truth[i]}`, (shared.get(`${l}|${truth[i]}`) ?? 0) + w[i]!); });
        const pairs = [...shared.entries()].map(([key, ms]) => ({ l: Number(key.split('|')[0]), p: key.split('|')[1]!, ms })).sort((a, b) => b.ms - a.ms);
        const map = new Map<number, string>(); const used = new Set<string>();
        for (const { l, p } of pairs) { if (map.has(l) || used.has(p)) continue; map.set(l, p); used.add(p); }
        return (l: number) => map.get(l);
      };

      const out = [`\n=== ${d.name}: ${k} people, ${(d.totalMs / 60000).toFixed(1)} min, ${n} samples, ${(totalScored / 1000).toFixed(0)} s scored`];

      // Shipped clustering, cut at k with splinters placed back.
      const shipped = placeSplinters(C, keepBusiest(agglomerative(C, { k: k + splinterHeadroom(n) }), w, k), w);
      out.push(`  shipped clustering, oracle names:      accuracy ${pct(accuracyWith(shipped, oracleMap(shipped)))}  DER ${der(shipped)}`);
      // As the user sees it: identities in order of appearance, names in order of speaking.
      const r = replayLive({ speakerCount: k, backgroundVoices: false, spans: d.spans, durationsMs: w, vectors: d.vectors, identities: shipped });
      const speakingOrder: string[] = [];
      truth.forEach((t) => { if (known(t) && !speakingOrder.includes(t)) speakingOrder.push(t); });
      const appearance = [...r.firstSeenMs.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
      const userMap = new Map(appearance.map((id, i) => [id, speakingOrder[i]!]));
      out.push(`  shipped clustering, names as shown:    accuracy ${pct(accuracyWith(r.identities, (l) => userMap.get(l)))}  (identities minted at ${appearance.map((id) => `${(r.firstSeenMs.get(id)! / 1000).toFixed(0)}s`).join(', ')}; ${r.relabelled} relabellings)`);

      // Introductions: the first N s of each person, in time order.
      for (const N of [5, 10, 15, 20]) {
        const enrolled = new Set<number>();
        const enrolIdx = new Map<string, number[]>(people.map((p) => [p, []]));
        const got = new Map<string, number>(people.map((p) => [p, 0]));
        for (let i = 0; i < n; i++) {
          const t = truth[i]!;
          if (!known(t) || got.get(t)! >= N * 1000) continue;
          enrolIdx.get(t)!.push(i); got.set(t, got.get(t)! + w[i]!); enrolled.add(i);
        }
        const short = people.filter((p) => got.get(p)! < N * 1000);
        for (const space of ['raw', 'centred'] as const) for (const mode of ['fixed', 'online', 'online+sweep'] as const) {
          const X = space === 'raw' ? V : C;
          const profiles: SpeakerProfile[] = people.map((p) => { const pr = createProfile(); for (const i of enrolIdx.get(p)!) addToProfile(pr, X[i]!, w[i]!); return pr; });
          const labels = new Array<number>(n);
          for (let i = 0; i < n; i++) {
            if (enrolled.has(i)) { labels[i] = people.indexOf(truth[i]!); continue; }
            const hit = nearestProfile(X[i]!, profiles)!;
            labels[i] = hit.index;
            if (mode !== 'fixed') addToProfile(profiles[hit.index]!, X[i]!, w[i]!);
          }
          if (mode === 'online+sweep') for (let i = 0; i < n; i++) if (!enrolled.has(i)) labels[i] = nearestProfile(X[i]!, profiles)!.index;
          const acc = accuracyWith(labels, (l) => people[l], (i) => !enrolled.has(i));
          out.push(`  introductions ${String(N).padStart(2)} s, ${space.padEnd(7)} ${mode.padEnd(12)}: accuracy ${pct(acc)} on the rest  DER ${der(labels)}${short.length ? `  (${short.length} never reached ${N} s)` : ''}`);
        }
      }
      console.log(out.join('\n'));
    });
  }
});
