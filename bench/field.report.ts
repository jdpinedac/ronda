/**
 * Reads a diagnostics file exported from the live page and says what happened
 * in that session: how many people, how much each was credited, how the
 * samples sit in embedding space, and whether re-running the shipped
 * clustering on the same samples gives the same groups. Then what a different
 * head count would have done, and whether any person is spread over two
 * groups — the signature of a dominant speaker being mistaken for someone else.
 * Finally what the user watched: the session replayed window by window, with
 * when each identity (each name) appeared and how often samples changed hands.
 *
 *     FILE=~/Downloads/ronda-diagnostics-2026-09-16-18-05-00.json npm run bench -- bench/field.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DiagnosticsBundle } from '../src/engine/live.js';
import {
  agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom, carryIdentities,
  cosineDistance, normalise, OTHER_VOICE, CLUSTER_HEADROOM,
} from '../src/engine/clustering.js';
import { assessOverlap } from '../src/engine/segmentation.js';
import { replayLive } from './replay.js';

const file = process.env.FILE;
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

describe('field diagnostics', () => {
  it(file ?? 'no FILE given', () => {
    if (!file) { console.log('Set FILE to an exported diagnostics JSON.'); return; }
    const b = JSON.parse(readFileSync(file.replace(/^~/, process.env.HOME ?? ''), 'utf8')) as DiagnosticsBundle;
    const V = b.vectors.map((v) => Float32Array.from(v));
    const n = V.length;
    const out = [`\n=== ${file}`,
      ...(b.capture ? [`  capture: ${b.capture.userAgent ?? 'unknown browser'}; track ${JSON.stringify(b.capture.track ?? {})}`] : ['  capture: not recorded (exported before rc.7)']),
      `  ${b.format} from Ronda ${b.version}, exported ${b.exportedAt}`,
      `  head count ${b.speakerCount ?? 'none'}, television switch ${b.backgroundVoices ? 'on' : 'off'}, listened ${f1(b.elapsedMs / 60000)} min, ${n} voice samples, ${f1(b.backgroundMs / 1000)} s dropped as distant`];

    if (b.introductions) {
      const per = new Map<number, number>();
      b.introductions.profile.forEach((who, i) => per.set(who, (per.get(who) ?? 0) + b.introductions!.durationsMs[i]!));
      out.push(`  introductions: ${[...per.entries()].sort((a, c) => a[0] - c[0]).map(([who, ms]) => `#${who + 1} ${f1(ms / 1000)}s`).join('  ')} of voice per profile`);
    }

    // As shown on screen.
    const overlap = assessOverlap(b.durationsMs, b.creditedMs, b.identities);
    out.push(`  overlap credited to the floor holder: ${Math.round(100 * overlap.share)}% of the time shown${overlap.heavy ? ' — heavy, the page warned' : ''}`);
    const tot = new Map<number, number>();
    b.identities.forEach((id, i) => { if (id !== OTHER_VOICE) tot.set(id, (tot.get(id) ?? 0) + b.durationsMs[i]! + b.creditedMs[i]!); });
    const sum = [...tot.values()].reduce((a, c) => a + c, 0);
    out.push(`  on screen: ${[...tot.entries()].sort((a, c) => a[0] - c[0]).map(([id, ms]) => `#${id + 1} ${f1(ms / 1000)}s (${Math.round(100 * ms / sum)}%)`).join('  ')}`);

    // Geometry per identity.
    const C = centreEmbeddings(V);
    const cents = new Map<number, Float32Array>();
    for (const id of tot.keys()) {
      const acc = new Float32Array(C[0]!.length);
      b.identities.forEach((x, i) => { if (x === id) for (let d = 0; d < acc.length; d++) acc[d] = acc[d]! + C[i]![d]! * b.durationsMs[i]!; });
      cents.set(id, normalise(acc));
    }
    const ids = [...cents.keys()].sort((a, c) => a - c);
    out.push('  distances between people: ' + ids.flatMap((a, i) => ids.slice(i + 1).map((c) => `#${a + 1}-#${c + 1}=${f2(cosineDistance(cents.get(a)!, cents.get(c)!))}`)).join('  '));
    for (const id of ids) {
      const mine = b.identities.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0);
      const own = mine.map((i) => cosineDistance(C[i]!, cents.get(id)!)).sort((a, c) => a - c);
      const closer = mine.filter((i) => ids.some((o) => o !== id && cosineDistance(C[i]!, cents.get(o)!) < cosineDistance(C[i]!, cents.get(id)!))).length;
      const short = mine.filter((i) => b.durationsMs[i]! < 1500).length;
      out.push(`  #${id + 1}: ${mine.length} samples, ${short} under 1.5 s; spread p50=${f2(own[Math.floor(own.length / 2)] ?? 0)} p90=${f2(own[Math.floor(own.length * 0.9)] ?? 0)}; ${closer} closer to someone else`);
    }

    // Does the shipped clustering reproduce the screen? Same policy as
    // clusterKnownCount in live.ts: with the television switch on, the extra
    // clusters are headroom for intruders and are discarded, not placed back.
    const w = b.durationsMs;
    const k = b.speakerCount ?? ids.length;
    const shipped = (kk: number) => (b.backgroundVoices
      ? keepBusiest(agglomerative(C, { k: kk + CLUSTER_HEADROOM }), w, kk)
      : placeSplinters(C, keepBusiest(agglomerative(C, { k: kk + splinterHeadroom(n) }), w, kk), w));
    const labels = shipped(k);
    const { identities } = carryIdentities(labels, b.identities, w, ids.length);
    const agree = identities.filter((x, i) => x === b.identities[i]).length;
    out.push(`  re-clustering the same samples: ${agree}/${n} samples land in the same group as on screen`);

    // Would one more or one fewer person have told a different story?
    for (const kk of [k - 1, k + 1]) {
      if (kk < 2) continue;
      const alt = shipped(kk);
      // Composition of each alternative group by the on-screen identity.
      const groups = new Map<number, Map<number, number>>();
      alt.forEach((g, i) => { const m = groups.get(g) ?? new Map<number, number>(); m.set(b.identities[i]!, (m.get(b.identities[i]!) ?? 0) + w[i]!); groups.set(g, m); });
      out.push(`  with ${kk} people instead: ${[...groups.values()].map((m) => '{' + [...m.entries()].sort((a, c) => c[1] - a[1]).map(([id, ms]) => `#${id + 1}:${f1(ms / 1000)}s`).join(' ') + '}').join('  ')}`);
    }
    // What the session itself recorded, when the export has it (rc.10+).
    if (b.log && b.log.length > 0) {
      const count = (kind: string) => b.log!.filter((e) => e.kind === kind).length;
      const first = (kind: string) => b.log!.find((e) => e.kind === kind);
      out.push(`  log: ${count('window')} windows, ${count('error')} errors, ${count('skipped')} skipped, ${count('dropped')} drops, ${count('recovered')} recoveries, ${count('capture')} capture events, ${count('far-run')} far runs, ${count('person-added')} people added`);
      for (const kind of ['error', 'skipped', 'dropped', 'recovered', 'capture'] as const) {
        const e = first(kind);
        if (e) out.push(`    first ${kind} at ${f1(e.atMs / 1000)} s: ${e.detail ?? ''}`);
      }
      for (const e of b.log.filter((x) => x.kind === 'far-run' || x.kind === 'person-added' || x.kind === 'introduction')) out.push(`    ${e.kind} at ${f1(e.atMs / 1000)} s: ${e.detail ?? ''}`);
    }

    // What the screen did over time. With profiles, identities are fixed by
    // construction and there is nothing to replay; without them, the export
    // has final identities only and the replay recovers when each was minted
    // and how much they churned.
    if (b.introductions) {
      out.push('  identities: attributed to profiles, fixed by construction; no replay');
      console.log(out.join('\n'));
      return;
    }
    const r = replayLive(b);
    const agreeReplay = r.identities.filter((x, i) => x === b.identities[i]).length;
    out.push(`  replay of the session: ${agreeReplay}/${n} final identities as exported`);
    const first = [...r.firstSeenMs.entries()].sort((a, c) => a[1] - c[1]);
    out.push(`  identities first appeared at: ${first.map(([id, ms]) => `#${id + 1} ${f1(ms / 1000)}s`).join('  ')}`);
    const spoken = new Set<number>();
    const peopleBy = (ms: number) => { b.spans.forEach((s, i) => { if (s.endMs <= ms) spoken.add(b.identities[i]!); }); return spoken.size; };
    const lastMinted = first[first.length - 1]?.[1] ?? 0;
    out.push(`  by then, samples of ${peopleBy(lastMinted)} distinct final groups had been heard: ${first.length > peopleBy(lastMinted) ? 'names were handed to fragments of the same voice' : 'each identity had its own voice'}`);
    out.push(`  samples that changed identity between windows: ${r.relabelled} (over ${n} samples)`);
    for (const [id, held] of [...r.heldFinal.entries()].sort((a, c) => a[0] - c[0])) {
      out.push(`  identity #${id + 1} held, at some point, samples that ended in: ${[...held].sort((a, c) => a - c).map((x) => `#${x + 1}`).join(' ')}`);
    }
    console.log(out.join('\n'));
  });
});
