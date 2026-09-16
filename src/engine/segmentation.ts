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

export interface OverlapCredit {
  /** Extra milliseconds credited to each attributed span, by index. */
  creditedMs: number[];
  /** Overlap with no attributed span before it. */
  unattributedMs: number;
  /** For each overlap span, the index of the attributed span it was credited to, or -1. */
  ownerOf: number[];
}

/**
 * Credits each overlap span to the attributed span that ended most recently
 * before it: whoever held the floor when the second voice came in.
 *
 * An embedding of two mixed voices belongs to neither, so overlap cannot be
 * clustered. It can still be counted. Measured against human annotation on
 * three whole meetings, crediting it to the speaker before beat every other
 * rule tried — the speaker after, the nearer of the two, splitting it — and
 * beat leaving it out by a wide margin: DER 0.306 → 0.244, 0.367 → 0.280 and
 * 0.207 → 0.111. Part of that is the convention that scores overlap as the
 * longer-running turn, but the reading is also the natural one: the person
 * already speaking is still speaking. See ADR 0006.
 *
 * Both lists must be in time order. Attributed spans never intersect overlap
 * spans, because both come from the same tiling of the timeline.
 */
export function creditOverlap(attributed: readonly Span[], overlaps: readonly Span[]): OverlapCredit {
  const creditedMs = attributed.map(() => 0);
  const ownerOf: number[] = [];
  let unattributedMs = 0;
  let j = 0;
  for (const o of overlaps) {
    while (j < attributed.length && attributed[j]!.endMs <= o.startMs + 1) j++;
    const ms = o.endMs - o.startMs;
    if (j === 0) { unattributedMs += ms; ownerOf.push(-1); }
    else { creditedMs[j - 1] = creditedMs[j - 1]! + ms; ownerOf.push(j - 1); }
  }
  return { creditedMs, unattributedMs, ownerOf };
}

export interface AttributedSpan {
  /** A single-speaker span that became a voice sample. */
  span: Span;
  /** Index of its voice sample, whose label or identity names the person. */
  vector: number;
}

export interface OverlapInWindow {
  span: Span;
  /** Every span of the window the overlap came from, in absolute time, trusted or not. */
  windowSpans: readonly Span[];
}

/**
 * Which voice samples an overlap span should be credited to.
 *
 * Both people talking at once are both talking. The segmentation model names
 * them as local speakers of the window, and the same window almost always
 * holds a stretch where each spoke alone. That stretch may lie outside the
 * part of the window that was trusted — the neighbouring window trusted it
 * instead — so a local speaker is tied to a person by time: the attributed
 * sample that most overlaps the stretches where that local speaker spoke
 * alone, whichever window embedded it.
 *
 * Returns one list per overlap span, in order. An empty list means neither
 * local speaker could be identified; callers fall back to whoever held the
 * floor (creditOverlap). Measured in ADR 0009.
 */
export function overlapCredits(
  attributed: readonly AttributedSpan[],
  overlaps: readonly OverlapInWindow[],
): number[][] {
  const overlapMs = (a: Span, b: Span) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  return overlaps.map((o) => {
    const out: number[] = [];
    for (const local of o.span.speakers) {
      const alone = o.windowSpans.filter((s) => s.speakers.length === 1 && s.speakers[0] === local);
      let best = -1; let bestMs = 0;
      for (const a of attributed) {
        const ms = alone.reduce((sum, s) => sum + overlapMs(s, a.span), 0);
        if (ms > bestMs) { bestMs = ms; best = a.vector; }
      }
      if (best >= 0 && !out.includes(best)) out.push(best);
    }
    return out;
  });
}
