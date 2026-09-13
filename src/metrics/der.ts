/**
 * Diarization error rate: the standard way to say how wrong a diarization is.
 *
 * The timeline is sliced into short frames. Each frame has a reference speaker
 * (from human annotation) and a hypothesis speaker (from Ronda). Because system
 * labels are arbitrary — Ronda's "speaker 1" is not the annotator's "FEE013" —
 * the two label sets are matched optimally before counting errors.
 *
 * DER = (missed speech + false alarm + speaker confusion) / total reference speech
 *
 * A DER of 0.20 means a fifth of the spoken time is attributed wrongly. Values
 * are conventionally reported as a fraction, not a percentage.
 */

export interface Turn {
  startMs: number;
  endMs: number;
  speaker: string | number;
}

export interface DerResult {
  der: number;
  missedMs: number;
  falseAlarmMs: number;
  confusionMs: number;
  correctMs: number;
  referenceSpeechMs: number;
  /** Which hypothesis label was matched to which reference label. */
  mapping: Record<string, string>;
}

const FRAME_MS = 10;

/**
 * Frame-level speaker at each instant. Where the reference has overlapping
 * speech, the longest-running turn wins: Ronda never attributes overlap, so
 * scoring it as a separate class would only measure a capability it does not
 * claim.
 */
function rasterise(turns: readonly Turn[], durationMs: number): (string | null)[] {
  const frames = new Array<string | null>(Math.ceil(durationMs / FRAME_MS)).fill(null);
  const ordered = [...turns].sort((a, b) => (a.endMs - a.startMs) - (b.endMs - b.startMs));
  for (const t of ordered) {
    const from = Math.max(0, Math.floor(t.startMs / FRAME_MS));
    const to = Math.min(frames.length, Math.ceil(t.endMs / FRAME_MS));
    for (let i = from; i < to; i++) frames[i] = String(t.speaker);
  }
  return frames;
}

/** Greedy optimal-ish assignment: repeatedly take the highest-overlap pair. */
function matchLabels(
  ref: readonly (string | null)[],
  hyp: readonly (string | null)[],
): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i];
    const h = hyp[i];
    if (r === null || r === undefined || h === null || h === undefined) continue;
    const row = counts.get(h) ?? new Map<string, number>();
    row.set(r, (row.get(r) ?? 0) + 1);
    counts.set(h, row);
  }

  const pairs: { hyp: string; ref: string; n: number }[] = [];
  for (const [h, row] of counts) for (const [r, n] of row) pairs.push({ hyp: h, ref: r, n });
  pairs.sort((a, b) => b.n - a.n);

  const mapping: Record<string, string> = {};
  const usedRef = new Set<string>();
  for (const p of pairs) {
    if (mapping[p.hyp] !== undefined || usedRef.has(p.ref)) continue;
    mapping[p.hyp] = p.ref;
    usedRef.add(p.ref);
  }
  return mapping;
}

export function diarizationErrorRate(
  reference: readonly Turn[],
  hypothesis: readonly Turn[],
  durationMs: number,
): DerResult {
  const ref = rasterise(reference, durationMs);
  const hyp = rasterise(hypothesis, durationMs);
  const mapping = matchLabels(ref, hyp);

  let missed = 0;
  let falseAlarm = 0;
  let confusion = 0;
  let correct = 0;
  let refSpeech = 0;

  for (let i = 0; i < ref.length; i++) {
    const r = ref[i] ?? null;
    const h = hyp[i] ?? null;
    if (r !== null) refSpeech++;
    if (r !== null && h === null) missed++;
    else if (r === null && h !== null) falseAlarm++;
    else if (r !== null && h !== null) {
      if (mapping[h] === r) correct++;
      else confusion++;
    }
  }

  const toMs = (frames: number) => frames * FRAME_MS;
  return {
    der: refSpeech === 0 ? 0 : (missed + falseAlarm + confusion) / refSpeech,
    missedMs: toMs(missed),
    falseAlarmMs: toMs(falseAlarm),
    confusionMs: toMs(confusion),
    correctMs: toMs(correct),
    referenceSpeechMs: toMs(refSpeech),
    mapping,
  };
}
