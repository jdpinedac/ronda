import { describe, it, expect } from 'vitest';
import embeddings from '../bench/fixtures/ami-ES2004a-embeddings.json' with { type: 'json' };
import truth from '../bench/fixtures/ami-ES2004a.truth.json' with { type: 'json' };
import {
  agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom, OTHER_VOICE,
} from '../src/engine/clustering.js';
import { diarizationErrorRate, type Turn } from '../src/metrics/der.js';

/**
 * The accuracy guard. The real diarization error rate of the shipped
 * clustering on a whole annotated meeting, from stored embeddings, in
 * milliseconds. A change that makes long conversations worse fails here
 * before anyone runs the models.
 *
 * The number is the clustering stage alone: overlap credit (ADR 0006) needs
 * the segmentation output, which the fixture does not carry, so the figure
 * here is higher than the one `npm run bench` reports for the same meeting.
 */
describe('DER on the whole of AMI ES2004a, from stored embeddings', () => {
  const vectors = centreEmbeddings((embeddings.vectors as number[][]).map((v) => Float32Array.from(v)));
  const durations = embeddings.spans.map((s) => s.endMs - s.startMs);
  const k = embeddings.people;
  const der = (labels: readonly number[]) => diarizationErrorRate(
    truth.turns as Turn[],
    embeddings.spans.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: labels[i]! })).filter((t) => t.speaker !== OTHER_VOICE),
    embeddings.totalMs,
  );

  it('stays at or under 0.32 with the shipped policy (measured 0.306 on 2026-09-15)', () => {
    const wide = agglomerative(vectors, { k: k + splinterHeadroom(vectors.length) });
    const r = der(placeSplinters(vectors, keepBusiest(wide, durations, k), durations));
    expect(r.der, `DER ${r.der.toFixed(3)}, confusion ${(r.confusionMs / 1000).toFixed(0)} s`).toBeLessThanOrEqual(0.32);
  });

  it('would fail at the pre-ADR-0005 policy of cutting at exactly k (measured 0.395)', () => {
    const r = der(keepBusiest(agglomerative(vectors, { k }), durations, k));
    expect(r.der).toBeGreaterThan(0.35);
  });
});
