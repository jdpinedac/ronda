/**
 * Does the segmentation model hear silence too readily?
 *
 * Half of the annotated speech it hears as silence lies more than two seconds
 * from any turn edge, so it is not the annotation being generous. This report
 * decodes the same logits with a penalty subtracted from the silence class
 * before the argmax and measures what that buys and what it costs: annotated
 * single-speaker speech recovered, and speech claimed where the annotation has
 * silence.
 *
 *     REC=ES2004a npm run bench -- bench/silence-bias.report.ts
 */
import { describe, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
vi.mock('../src/engine/models.js', () => import('./node-models.js'));
import { loadModels, runSegmentation, SEGMENTATION_CLASSES, SAMPLE_RATE } from '../src/engine/models.js';
import { decodeSegmentation, speechSpans } from '../src/engine/segmentation.js';
import { windowPlan } from '../src/engine/windows.js';
import type { Turn } from '../src/metrics/der.js';
import { readAudio16k, ROOT } from './node-models.js';

const TD = `${ROOT}/public/testdata`;
const IDS = ['ami-ES2004a', 'ami-IS1009a', 'ami-TS3003a', 'ami-meeting'].filter((id) => id.includes(process.env.REC ?? ''));
const ms2s = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const FRAME = 10;
const BIASES = [0, 0.5, 1, 1.5, 2, 3];

describe('silence bias', () => {
  for (const id of IDS) {
    it(id, async () => {
      if (!existsSync(`${TD}/${id}.wav`)) { console.log(`skip ${id}`); return; }
      const truth = JSON.parse(readFileSync(`${TD}/${id}.truth.json`, 'utf8')) as { turns: Turn[] };
      const audio = readAudio16k(`${TD}/${id}.wav`);
      const totalMs = (audio.length / SAMPLE_RATE) * 1000;
      const { segmentation } = await loadModels();
      const plan = windowPlan(totalMs, 10_000, 5_000);
      const logitsPerWindow: Float32Array[] = [];
      for (const w of plan) logitsPerWindow.push(Float32Array.from(await runSegmentation(segmentation, audio.slice(ms2s(w.startMs), ms2s(w.endMs)))));

      const n = Math.ceil(totalMs / FRAME);
      const ref = new Uint8Array(n);
      for (const t of truth.turns) for (let f = Math.floor(t.startMs / FRAME); f < Math.min(n, Math.ceil(t.endMs / FRAME)); f++) ref[f] = (ref[f]! + 1) as number;
      const refSingle = [...ref].filter((r) => r === 1).length;
      const refSilence = [...ref].filter((r) => r === 0).length;

      const out = [`\n=== ${id}  (annotated single-speaker speech ${(refSingle * FRAME / 1000).toFixed(0)} s, annotated silence ${(refSilence * FRAME / 1000).toFixed(0)} s)`];
      for (const bias of BIASES) {
        const hyp = new Uint8Array(n); // 0 silence, 1 single, 2 overlap
        let usableCount = 0; let usableMs = 0;
        plan.forEach((w, wi) => {
          const logits = Float32Array.from(logitsPerWindow[wi]!);
          for (let f = 0; f < logits.length / SEGMENTATION_CLASSES; f++) logits[f * SEGMENTATION_CLASSES] = logits[f * SEGMENTATION_CLASSES]! - bias;
          const local = decodeSegmentation(logits, SEGMENTATION_CLASSES, w.endMs - w.startMs)
            .map((s) => ({ ...s, startMs: Math.max(s.startMs + w.startMs, w.trustFromMs), endMs: Math.min(s.endMs + w.startMs, w.trustToMs) }))
            .filter((s) => s.endMs > s.startMs);
          for (const s of local) for (let f = Math.floor(s.startMs / FRAME); f < Math.min(n, Math.ceil(s.endMs / FRAME)); f++) hyp[f] = s.speakers.length === 0 ? 0 : s.speakers.length === 1 ? 1 : 2;
          const usable = speechSpans(local, 800);
          usableCount += usable.length; usableMs += usable.reduce((a, s) => a + s.endMs - s.startMs, 0);
        });
        let singleAsSilence = 0, fa = 0, singleAsSingle = 0;
        for (let f = 0; f < n; f++) {
          if (ref[f] === 1 && hyp[f] === 0) singleAsSilence++;
          if (ref[f] === 1 && hyp[f] === 1) singleAsSingle++;
          if (ref[f] === 0 && hyp[f] !== 0) fa++;
        }
        out.push(`  bias ${String(bias).padEnd(4)} speech heard as silence ${(100 * singleAsSilence / refSingle).toFixed(1).padStart(4)}%  heard as one voice ${(100 * singleAsSingle / refSingle).toFixed(1)}%  claimed in annotated silence ${(fa * FRAME / 1000).toFixed(0).padStart(3)} s (${(100 * fa / refSilence).toFixed(1)}%)  usable spans ${usableCount} / ${(usableMs / 1000).toFixed(0)} s`);
      }
      console.log(out.join('\n'));
    });
  }
});
