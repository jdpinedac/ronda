/**
 * Decoding pyannote/segmentation-3.0 output.
 *
 * The model does not emit one probability per speaker. It emits one class from
 * a "powerset": every combination of up to three simultaneous speakers,
 * including none. That is what lets a single argmax express overlap, which is
 * why overlap detection here comes from the model rather than a heuristic.
 *
 * Speaker indices are local to the analysed window — speaker 0 in one window is
 * not speaker 0 in the next. Identity across a conversation comes from the
 * embeddings, not from here.
 */

/** The seven classes, in the order the model's output channels use. */
export const POWERSET: readonly (readonly number[])[] = [
  [],       // 0: silence
  [0],      // 1: speaker A alone
  [1],      // 2: speaker B alone
  [2],      // 3: speaker C alone
  [0, 1],   // 4: A and B
  [0, 2],   // 5: A and C
  [1, 2],   // 6: B and C
];

export interface Span {
  startMs: number;
  endMs: number;
  /** Local speaker indices active during this span; empty means silence. */
  speakers: number[];
}

const sameSet = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Turns per-frame logits into contiguous spans.
 *
 * `logits` is row-major [frame][class]. The returned spans tile the whole
 * duration with no gaps, so silence is represented explicitly rather than by
 * absence — callers computing turn boundaries need to see the pauses.
 */
export function decodeSegmentation(
  logits: Float32Array,
  numClasses: number,
  durationMs: number,
): Span[] {
  if (logits.length === 0 || numClasses <= 0) return [];
  const numFrames = Math.floor(logits.length / numClasses);
  if (numFrames === 0) return [];

  const frameMs = durationMs / numFrames;
  const spans: Span[] = [];

  for (let f = 0; f < numFrames; f++) {
    let bestClass = 0;
    let best = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[f * numClasses + c]!;
      if (v > best) { best = v; bestClass = c; }
    }
    const speakers = POWERSET[bestClass] ?? [];
    const last = spans[spans.length - 1];
    if (last && sameSet(last.speakers, speakers)) {
      last.endMs = (f + 1) * frameMs;
    } else {
      spans.push({ startMs: f * frameMs, endMs: (f + 1) * frameMs, speakers: [...speakers] });
    }
  }

  // Absorb float drift so the last span ends exactly on the duration.
  const last = spans[spans.length - 1];
  if (last) last.endMs = durationMs;
  return spans;
}

/**
 * The spans worth embedding: exactly one speaker, and long enough that the
 * embedding is stable. Overlapped speech is excluded — a mixture of two voices
 * produces an embedding that belongs to neither, which would poison the
 * clustering. Overlap is still visible in the full span list, where the
 * interruption metrics read it.
 */
export function speechSpans(spans: readonly Span[], minDurationMs: number): Span[] {
  return spans
    .filter((s) => s.speakers.length === 1 && s.endMs - s.startMs >= minDurationMs)
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs, speakers: [...s.speakers] }));
}
