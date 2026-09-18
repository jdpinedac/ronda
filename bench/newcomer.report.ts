/**
 * Can a voice that never introduced itself be noticed from its distance to
 * the known profiles? Simulated online: samples arrive in order, each goes to
 * the nearest profile (which keeps learning, as live.ts does), and a run of
 * samples far from every profile — enough of them, close enough together —
 * raises a suggestion. Measured two ways: on the annotated meetings with one
 * person hidden from the introductions (how soon is the hidden voice noticed,
 * and how often are known voices mistaken for a newcomer), and on field files
 * with introductions, where every trigger is either the newcomer the tester
 * reported or a false alarm.
 *
 *     npm run bench -- bench/newcomer.report.ts
 *     FILES=diagnostics/a.json,diagnostics/b.json npm run bench -- bench/newcomer.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createProfile, addToProfile, nearestProfile, type SpeakerProfile } from '../src/engine/profiles.js';
import { NewVoiceWatch, type NewVoiceRule } from '../src/engine/newcomer.js';
import { ROOT } from './node-models.js';

const RULES: NewVoiceRule[] = [
  { farDistance: 0.70, minSamples: 3, minMs: 4000, withinMs: 60_000 },
  { farDistance: 0.75, minSamples: 3, minMs: 4000, withinMs: 60_000 },
  { farDistance: 0.80, minSamples: 3, minMs: 4000, withinMs: 60_000 },
  { farDistance: 0.75, minSamples: 4, minMs: 6000, withinMs: 60_000 },
  { farDistance: 0.80, minSamples: 4, minMs: 6000, withinMs: 90_000 },
];
const f1 = (x: number) => x.toFixed(1);
const known = (t: string) => t !== '?' && t !== 'mixed';

interface Sample { v: Float32Array; ms: number; at: number; truth: string }

/** Runs one rule over samples in order; returns trigger times and, per trigger, whether the run was mostly the hidden voice. */
function simulate(samples: Sample[], profiles: SpeakerProfile[], rule: NewVoiceRule, hidden: string | null, learn: 'all' | 'near') {
  const watch = new NewVoiceWatch(rule);
  const triggers: { at: number; hiddenShare: number }[] = [];
  for (const s of samples) {
    const hit = nearestProfile(s.v, profiles)!;
    // A profile that learns from far samples drifts towards the newcomer and hides them.
    if (learn === 'all' || hit.distance <= rule.farDistance) addToProfile(profiles[hit.index]!, s.v, s.ms);
    const sug = watch.observe({ at: s.at, ms: s.ms, distance: hit.distance, meta: s.truth });
    if (sug) {
      const hiddenMs = sug.run.reduce((a, r) => a + (r.meta === hidden ? r.ms : 0), 0);
      triggers.push({ at: s.at, hiddenShare: hiddenMs / sug.run.reduce((a, r) => a + r.ms, 0) });
      watch.dismiss();
    }
  }
  return triggers;
}

describe('noticing a voice that never introduced itself', () => {
  const fixture = `${ROOT}/bench/fixtures/ami-ES2004a-embeddings.json`;
  const dumps = [fixture, `${ROOT}/bench/out/ami-IS1009a.json`, `${ROOT}/bench/out/ami-TS3003a.json`].filter(existsSync);
  for (const file of dumps) {
    it(file.split('/').pop()!, () => {
      const d = JSON.parse(readFileSync(file, 'utf8')) as { name: string; spans: { startMs: number; endMs: number }[]; truthLabels: string[]; vectors: number[][] };
      const V = d.vectors.map((v) => Float32Array.from(v));
      const w = d.spans.map((s) => s.endMs - s.startMs);
      const people = [...new Set(d.truthLabels.filter(known))];
      const out = [`\n=== ${d.name}`];
      for (const learn of ['all', 'near'] as const) for (const rule of RULES) {
        let detected = 0, latency: number[] = [], falseTriggers = 0, hours = 0;
        for (const hidden of people) {
          const enrolled = new Set<number>();
          const profiles = people.filter((p) => p !== hidden).map((p) => { const pr = createProfile(); let got = 0; for (let i = 0; i < V.length; i++) { if (d.truthLabels[i] !== p) continue; addToProfile(pr, V[i]!, w[i]!); enrolled.add(i); got += w[i]!; if (got >= 10_000) break; } return pr; });
          const samples: Sample[] = V.map((v, i) => ({ v, ms: w[i]!, at: d.spans[i]!.startMs, truth: d.truthLabels[i]! })).filter((_, i) => !enrolled.has(i));
          const firstHidden = samples.find((s) => s.truth === hidden)?.at ?? Infinity;
          const trig = simulate(samples, profiles, rule, hidden, learn);
          const real = trig.find((t) => t.hiddenShare >= 0.5);
          if (real) { detected++; latency.push((real.at - firstHidden) / 1000); }
          falseTriggers += trig.filter((t) => t.hiddenShare < 0.5).length;
          hours += (d.spans[d.spans.length - 1]!.endMs) / 3_600_000;
        }
        out.push(`  learn ${learn.padEnd(4)} far>${rule.farDistance} ≥${rule.minSamples} samples ≥${rule.minMs / 1000}s within ${rule.withinMs / 1000}s: hidden voice noticed ${detected}/${people.length}, after ${latency.length ? latency.map(f1).join('/') : '-'} s of them speaking; ${falseTriggers} false suggestions in ${f1(hours)} h of known voices`);
      }
      console.log(out.join('\n'));
    });
  }

  const files = (process.env.FILES ?? '').split(',').filter(Boolean);
  for (const file of files) {
    it(file, () => {
      const b = JSON.parse(readFileSync(file.replace(/^~/, process.env.HOME ?? ''), 'utf8')) as { speakerCount: number; spans: { startMs: number; endMs: number }[]; durationsMs: number[]; vectors: number[][]; identities: number[]; introductions?: { vectors: number[][]; durationsMs: number[]; profile: number[] } };
      if (!b.introductions) { console.log(`\n=== ${file}: no introductions, skipped`); return; }
      const out = [`\n=== ${file}: ${b.speakerCount} profiles, ${f1(b.spans[b.spans.length - 1]!.endMs / 60000)} min`];
      for (const learn of ['all', 'near'] as const) for (const rule of RULES) {
        const profiles = Array.from({ length: b.speakerCount }, () => createProfile());
        b.introductions.profile.forEach((p, i) => addToProfile(profiles[p]!, Float32Array.from(b.introductions!.vectors[i]!), b.introductions!.durationsMs[i]!));
        const samples: Sample[] = b.vectors.map((v, i) => ({ v: Float32Array.from(v), ms: b.durationsMs[i]!, at: b.spans[i]!.startMs, truth: `#${b.identities[i]! + 1}` }));
        const trig = simulate(samples, profiles, rule, null, learn);
        out.push(`  learn ${learn.padEnd(4)} far>${rule.farDistance} ≥${rule.minSamples} samples ≥${rule.minMs / 1000}s within ${rule.withinMs / 1000}s: ${trig.length} suggestion(s)${trig.length ? ' at ' + trig.map((t) => `${Math.floor(t.at / 60000)}:${String(Math.floor((t.at % 60000) / 1000)).padStart(2, '0')}`).join(', ') : ''}`);
      }
      console.log(out.join('\n'));
    });
  }
});
