/**
 * What is different about the segments the embeddings get wrong?
 *
 * For each annotated segment in a dump, "misplaced" means its embedding sits
 * closer to another annotated speaker's centroid than to its own. This report
 * compares misplaced and well-placed segments on things Ronda could know at
 * run time — duration, level, position in time — and on things only the
 * annotation knows: how pure the segment really is, and who else is in it.
 *
 *     REC=TS3003a npm run bench -- bench/segments.report.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { centreEmbeddings, cosineDistance, normalise } from '../src/engine/clustering.js';
import { rms } from '../src/engine/levels.js';
import type { Turn } from '../src/metrics/der.js';
import { readAudio16k, ROOT } from './node-models.js';

interface Dump { name: string; people: number; totalMs: number; spans: { startMs: number; endMs: number; speaker: number }[]; truthLabels: string[] | null; vectors: number[][] }
const TD = `${ROOT}/public/testdata`;
const IDS = ['ami-ES2004a', 'ami-IS1009a', 'ami-TS3003a'].filter((id) => id.includes(process.env.REC ?? ''));
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN; };

describe('misplaced segments', () => {
  for (const id of IDS) {
    const dumpPath = existsSync(`${ROOT}/bench/out/${id}.json`) ? `${ROOT}/bench/out/${id}.json` : `${ROOT}/bench/fixtures/${id}-embeddings.json`;
    it(id, () => {
      const d = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump;
      const truth = JSON.parse(readFileSync(`${TD}/${id}.truth.json`, 'utf8')) as { turns: Turn[] };
      const audio = readAudio16k(`${TD}/${id}.wav`);
      const V = centreEmbeddings(d.vectors.map((v) => Float32Array.from(v)));
      const w = d.spans.map((s) => (s.endMs - s.startMs) / 1000);
      const lab = d.truthLabels!;
      const spk = [...new Set(lab.filter((t) => t !== '?' && t !== 'mixed'))].sort();
      const centroid = (idxs: number[]) => { const c = new Float32Array(V[0]!.length); for (const i of idxs) for (let k = 0; k < c.length; k++) c[k] = c[k]! + V[i]![k]! * w[i]!; return normalise(c); };
      const cents = new Map(spk.map((s) => [s, centroid(lab.map((t, i) => (t === s ? i : -1)).filter((i) => i >= 0))]));

      // Per segment: annotation coverage by each speaker, level, misplaced flag.
      const rows = d.spans.map((s, i) => {
        const dur = s.endMs - s.startMs;
        const cover = new Map<string, number>();
        for (const t of truth.turns) { const o = Math.min(s.endMs, t.endMs) - Math.max(s.startMs, t.startMs); if (o > 0) cover.set(String(t.speaker), (cover.get(String(t.speaker)) ?? 0) + o); }
        const own = lab[i]!;
        const purity = (cover.get(own) ?? 0) / dur;
        const others = [...cover.entries()].filter(([k]) => k !== own).reduce((a, [, v]) => a + v, 0) / dur;
        const unannotated = Math.max(0, 1 - [...cover.values()].reduce((a, b) => a + b, 0) / dur);
        const level = rms(audio.subarray(Math.round(s.startMs * 16), Math.round(s.endMs * 16)));
        let nearest = own; let nd = Infinity; let ownD = NaN;
        for (const [k, c] of cents) { const dd = cosineDistance(V[i]!, c); if (k === own) ownD = dd; if (dd < nd) { nd = dd; nearest = k; } }
        return { i, own, dur, purity, others, unannotated, level, ownD, nearest, misplaced: own !== '?' && own !== 'mixed' && nearest !== own, minute: s.startMs / 60000 };
      }).filter((r) => r.own !== '?' && r.own !== 'mixed');

      const out = [`\n=== ${id}`];
      for (const s of spk) {
        const mine = rows.filter((r) => r.own === s);
        const bad = mine.filter((r) => r.misplaced); const good = mine.filter((r) => !r.misplaced);
        if (bad.length === 0) { out.push(`  ${s}: ${mine.length} segments, none misplaced`); continue; }
        const cmp = (name: string, f: (r: typeof rows[number]) => number, fmt = f2) => `${name} ${fmt(median(bad.map(f)))} vs ${fmt(median(good.map(f)))}`;
        out.push(`  ${s}: ${bad.length} of ${mine.length} misplaced (medians, misplaced vs well-placed)`);
        out.push(`     ${cmp('duration s', (r) => r.dur / 1000, f1)} | ${cmp('purity', (r) => r.purity)} | ${cmp('other-speaker share', (r) => r.others)} | ${cmp('unannotated share', (r) => r.unannotated)}`);
        out.push(`     ${cmp('level rms', (r) => r.level, (x) => x.toFixed(4))} | ${cmp('dist to own centroid', (r) => r.ownD)} | with any other speaker inside: ${bad.filter((r) => r.others > 0).length}/${bad.length} vs ${good.filter((r) => r.others > 0).length}/${good.length}`);
        const to = new Map<string, number>(); for (const r of bad) to.set(r.nearest, (to.get(r.nearest) ?? 0) + 1);
        out.push(`     drawn to: ${[...to.entries()].map(([k, v]) => `${k}=${v}`).join(' ')} | by minute: ${bad.map((r) => Math.floor(r.minute)).sort((a, b) => a - b).join(',')}`);
      }
      // Does purity predict misplacement across everyone?
      const bins: [string, (r: typeof rows[number]) => boolean][] = [
        ['purity >= 0.95', (r) => r.purity >= 0.95], ['0.75-0.95', (r) => r.purity >= 0.75 && r.purity < 0.95], ['0.5-0.75', (r) => r.purity >= 0.5 && r.purity < 0.75],
      ];
      out.push(`  misplaced rate by annotation purity: ${bins.map(([n, p]) => { const g = rows.filter(p); return `${n}: ${g.filter((r) => r.misplaced).length}/${g.length}`; }).join('  ')}`);
      const dbins: [string, (r: typeof rows[number]) => boolean][] = [['< 1.5 s', (r) => r.dur < 1500], ['1.5-3 s', (r) => r.dur >= 1500 && r.dur < 3000], ['3-6 s', (r) => r.dur >= 3000 && r.dur < 6000], ['>= 6 s', (r) => r.dur >= 6000]];
      out.push(`  misplaced rate by duration:           ${dbins.map(([n, p]) => { const g = rows.filter(p); return `${n}: ${g.filter((r) => r.misplaced).length}/${g.length}`; }).join('  ')}`);
      console.log(out.join('\n'));
    });
  }
});
