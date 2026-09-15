/**
 * Where does the missed speech go?
 *
 * DER on whole meetings is dominated by misses, not confusion. This report
 * runs the segmentation stage exactly as diarize() does and rasterises the
 * timeline against the annotation, so every 10 ms of annotated speech is
 * accounted for: attributed, dropped as too short, dropped as too quiet, heard
 * as overlap, or heard as silence.
 *
 *     REC=ES2004a npm run bench -- bench/coverage.report.ts
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
import { loadModels, runSegmentation, SEGMENTATION_CLASSES, SAMPLE_RATE } from '../src/engine/models.js';
import { decodeSegmentation, speechSpans, type Span } from '../src/engine/segmentation.js';
import { rms, selectForeground } from '../src/engine/levels.js';
import { windowPlan } from '../src/engine/windows.js';
import type { Turn } from '../src/metrics/der.js';
import { readAudio16k, ROOT } from './node-models.js';

const TD = `${ROOT}/public/testdata`;
const IDS = ['ami-ES2004a', 'ami-IS1009a', 'ami-TS3003a', 'ami-meeting'].filter((id) => id.includes(process.env.REC ?? ''));
const FRAME = 10;
const ms2s = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);

describe('coverage of annotated speech', () => {
  for (const id of IDS) {
    it(id, async () => {
      if (!existsSync(`${TD}/${id}.wav`)) { console.log(`skip ${id}`); return; }
      const truth = JSON.parse(readFileSync(`${TD}/${id}.truth.json`, 'utf8')) as { turns: Turn[] };
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
      const candidates = speechSpans(all, 800);
      const fg = selectForeground(candidates.map((s) => rms(audio.subarray(ms2s(s.startMs), ms2s(s.endMs)))));

      const n = Math.ceil(totalMs / FRAME);
      // Reference: number of annotated speakers per frame.
      const ref = new Uint8Array(n);
      for (const t of truth.turns) for (let f = Math.floor(t.startMs / FRAME); f < Math.min(n, Math.ceil(t.endMs / FRAME)); f++) ref[f] = (ref[f]! + 1) as number;
      // Hypothesis state per frame: 0 silence, 1 single (short), 2 single usable, 3 single dropped quiet, 4 overlap
      const hyp = new Uint8Array(n);
      for (const s of all) {
        const state = s.speakers.length === 0 ? 0 : s.speakers.length > 1 ? 4 : 1;
        for (let f = Math.floor(s.startMs / FRAME); f < Math.min(n, Math.ceil(s.endMs / FRAME)); f++) hyp[f] = state;
      }
      candidates.forEach((s, i) => {
        for (let f = Math.floor(s.startMs / FRAME); f < Math.min(n, Math.ceil(s.endMs / FRAME)); f++) hyp[f] = fg[i] ? 2 : 3;
      });
      const names = ['heard as silence', 'in a span under 0.8 s', 'attributed', 'dropped as too quiet', 'heard as overlap'];
      const table = (pred: (r: number) => boolean) => {
        const c = [0, 0, 0, 0, 0];
        for (let f = 0; f < n; f++) if (pred(ref[f]!)) c[hyp[f]!]!++;
        const tot = c.reduce((a, b) => a + b, 0);
        return c.map((v, i) => `${names[i]} ${(v * FRAME / 1000).toFixed(0).padStart(4)} s (${(100 * v / tot).toFixed(0).padStart(2)}%)`).join(' | ') + `  total ${(tot * FRAME / 1000).toFixed(0)} s`;
      };
      let fa = 0; for (let f = 0; f < n; f++) if (ref[f] === 0 && hyp[f] === 2) fa++;
      console.log([`\n=== ${id}`,
        `  annotated single speaker: ${table((r) => r === 1)}`,
        `  annotated overlap (2+):   ${table((r) => r >= 2)}`,
        `  attributed where annotation has silence: ${(fa * FRAME / 1000).toFixed(0)} s`,
      ].join('\n'));
    });
  }
});
