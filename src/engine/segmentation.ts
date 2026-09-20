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

/**
 * Above this share of the time shown, crediting overlap stops being a rounding
 * error and becomes the result. The annotated meetings contain 0–20 % true
 * overlap and the model hears 2–13 % on them; clean field sessions read 3–8 %,
 * a 79-minute table of three read 18 %, and a 36-minute table of six in a shop
 * with music read 42 %, where the four smaller shares moved by five points
 * from one minute to the next. See ADR 0013.
 */
export const OVERLAP_LIMIT = 0.3;

/**
 * How much of the time on screen is overlap credited to whoever held the floor,
 * as a fraction, leaving out samples that belong to no participant. Credit is
 * right on average (ADR 0006) and wrong in detail: a second voice the model
 * hears can be music or the next table, and every second of it goes to the
 * last person heard alone. When that is most of the tally, the shares of the
 * people who spoke least are the least trustworthy.
 */
export function assessOverlap(
  durationsMs: readonly number[],
  creditedMs: readonly number[],
  identities: readonly number[],
): { share: number; heavy: boolean } {
  let own = 0;
  let credited = 0;
  for (let i = 0; i < durationsMs.length; i++) {
    if ((identities[i] ?? -1) < 0) continue;
    own += durationsMs[i] ?? 0;
    credited += creditedMs[i] ?? 0;
  }
  const share = own + credited > 0 ? credited / (own + credited) : 0;
  return { share, heavy: share > OVERLAP_LIMIT };
}
