/**
 * Grouping speaker embeddings into speakers.
 *
 * ADR 0001 measured the key fact driving this module: the embedding models
 * separate voices with a wide margin, but picking a distance threshold to cut
 * at is fragile — the correct answer sits in a narrow band that moves with
 * quantization. When the number of people is known, cutting the dendrogram at
 * exactly K is reliable where thresholding is not. Hence resolveSpeakerCount.
 */

/** Distance in [0, 2]: 0 identical direction, 1 orthogonal, 2 opposite. */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return 1 - dot;
}

/** Unit-normalises a vector so cosine distance is a plain dot product. */
export function normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const n = Math.sqrt(sum);
  if (n === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

/**
 * Cosine distance threshold used when the speaker count is unknown.
 * ADR 0001 swept this: the correct count appears between 0.7 and 0.8 across
 * test recordings, with 0.7 the safer end (it splits rather than merges, and a
 * split is recoverable by the user while a merge silently loses a person).
 */
export const DEFAULT_THRESHOLD = 0.7;

export interface ClusterOptions {
  /** Cut at exactly this many clusters. Takes precedence over threshold. */
  k?: number;
  /** Stop merging once the closest pair exceeds this distance. */
  threshold?: number;
}

/**
 * Average-linkage agglomerative clustering. Returns a label per input vector.
 *
 * Sized for conversation: a one-hour session yields a couple of thousand
 * segments, and the O(n^3) worst case is milliseconds at that scale.
 */
export function agglomerative(vectors: readonly Float32Array[], opts: ClusterOptions): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  let groups: number[][] = vectors.map((_, i) => [i]);

  const groupDistance = (g: readonly number[], h: readonly number[]): number => {
    let sum = 0;
    for (const i of g) for (const j of h) sum += cosineDistance(vectors[i]!, vectors[j]!);
    return sum / (g.length * h.length);
  };

  const targetK = opts.k !== undefined ? Math.max(1, Math.min(opts.k, n)) : 1;
  const threshold = opts.threshold;

  for (;;) {
    if (opts.k !== undefined && groups.length <= targetK) break;
    if (groups.length === 1) break;

    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = groupDistance(groups[i]!, groups[j]!);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    if (opts.k === undefined && threshold !== undefined && best > threshold) break;

    groups[bi] = groups[bi]!.concat(groups[bj]!);
    groups.splice(bj, 1);
  }

  // Label by first appearance so output is stable and readable.
  groups = groups.sort((a, b) => Math.min(...a) - Math.min(...b));
  const labels = new Array<number>(n);
  groups.forEach((g, k) => g.forEach((i) => { labels[i] = k; }));
  return labels;
}

/**
 * Below this many segments the mean is dominated by whoever happens to be in
 * it, so subtracting it would remove speaker identity rather than channel.
 */
const MIN_FOR_CENTRING = 3;

/**
 * Removes the component every embedding shares, which is the recording channel.
 *
 * A phone codec, a band-limited microphone or a room all colour every segment
 * of a recording the same way. That shared colouring appears as a large common
 * component in every embedding, and because it is identical everywhere it
 * dominates the cosine distances and buries the differences between people. The
 * symptom is unmistakable: one speaker is credited with nearly the whole
 * conversation.
 *
 * Measured on a band-limited copy of a two-speaker recording: 91%/9% before
 * centring, 58%/42% after, with the clean original unchanged at 55%/45%.
 *
 * Note that this widens distances overall, so a threshold calibrated on
 * uncentred embeddings no longer applies — see how diarize.ts uses this.
 */
export function centreEmbeddings(vectors: readonly Float32Array[]): Float32Array[] {
  if (vectors.length < MIN_FOR_CENTRING) return [...vectors];
  const dim = vectors[0]!.length;
  const mean = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] = mean[i]! + v[i]! / vectors.length;
  return vectors.map((v) => normalise(Float32Array.from(v, (x, i) => x - mean[i]!)));
}

export interface AbsorbOptions {
  minSegments: number;
  minDurationMs: number;
}

/**
 * Folds clusters too small to be a real participant into their nearest
 * neighbour. A cluster survives if it has enough segments OR enough total
 * speech: someone who said one long thing counts, and so does someone who
 * chipped in briefly many times.
 */
export function absorbTinyClusters(
  vectors: readonly Float32Array[],
  labels: readonly number[],
  durationsMs: readonly number[],
  opts: AbsorbOptions,
): number[] {
  const members = new Map<number, number[]>();
  labels.forEach((l, i) => {
    const arr = members.get(l);
    if (arr) arr.push(i); else members.set(l, [i]);
  });
  if (members.size <= 1) return [...labels];

  const totalMs = (idxs: readonly number[]) => idxs.reduce((s, i) => s + (durationsMs[i] ?? 0), 0);
  const centroid = (idxs: readonly number[]): Float32Array => {
    const dim = vectors[idxs[0]!]!.length;
    const c = new Float32Array(dim);
    for (const i of idxs) for (let d = 0; d < dim; d++) c[d] = c[d]! + vectors[i]![d]!;
    return normalise(c);
  };

  const healthy = [...members.entries()].filter(
    ([, idxs]) => idxs.length >= opts.minSegments || totalMs(idxs) >= opts.minDurationMs);
  const tiny = [...members.entries()].filter(
    ([, idxs]) => !(idxs.length >= opts.minSegments || totalMs(idxs) >= opts.minDurationMs));

  // Nothing to absorb into: leave the partition untouched rather than collapse it.
  if (healthy.length === 0 || tiny.length === 0) return [...labels];

  const healthyCentroids = healthy.map(([label, idxs]) => ({ label, c: centroid(idxs) }));
  const out = [...labels];
  for (const [, idxs] of tiny) {
    const c = centroid(idxs);
    let bestLabel = healthyCentroids[0]!.label;
    let bestDist = Infinity;
    for (const h of healthyCentroids) {
      const d = cosineDistance(c, h.c);
      if (d < bestDist) { bestDist = d; bestLabel = h.label; }
    }
    for (const i of idxs) out[i] = bestLabel;
  }
  return out;
}

/**
 * Extra clusters allowed when the room is known to contain voices that are not
 * participants — a television, the next table.
 *
 * This is off by default, and that default is measured. Against human
 * annotation, headroom makes things worse when there are no intruders: a
 * two-woman conversation went from 62/38 to 72/28 against a true 60/40, and a
 * four-person meeting's error rate rose from 0.199 to 0.219. Surplus groups are
 * usually not intruders — they are one person who sounded different for a while
 * — and discarding them throws away real speech.
 *
 * When there really is a television, the picture reverses. Cutting at exactly
 * the number of people forces those voices into somebody's tally, and to free a
 * slot it merges two real people into one. On a recording with chatter under a
 * four-person meeting, headroom moved the split from 31/31/20/18 to 35/23/22/20
 * against a true 34/23/22/21.
 *
 * Nothing in the audio reliably distinguishes the two situations — surplus
 * groups in the two-woman case sat further from the main groups (1.181) than
 * genuine intruders did (0.865). The person in the room knows; Ronda does not.
 * So it is asked, not guessed.
 */
export const CLUSTER_HEADROOM = 2;

export const OTHER_VOICE = -1;

/**
 * Keeps the `k` clusters with the most speech and marks the rest as other
 * voices. Labels are renumbered 0..k-1 by how much each speaks.
 */
export function keepBusiest(
  labels: readonly number[],
  durationsMs: readonly number[],
  k: number,
): number[] {
  if (k <= 0) return labels.map(() => OTHER_VOICE);

  const totals = new Map<number, number>();
  labels.forEach((l, i) => totals.set(l, (totals.get(l) ?? 0) + (durationsMs[i] ?? 0)));
  if (totals.size <= k) {
    // Nothing to discard, but still renumber by prominence.
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    const rank = new Map(order.map((l, i) => [l, i]));
    return labels.map((l) => rank.get(l) ?? OTHER_VOICE);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const rank = new Map(ranked.slice(0, k).map(([l], i) => [l, i]));
  return labels.map((l) => rank.get(l) ?? OTHER_VOICE);
}

/**
 * Extra groups to cut before keeping the busiest `k`, when the head count is
 * known and there is enough evidence for the extra groups to mean anything.
 *
 * Over a long conversation on a table microphone, a person's voice drifts:
 * they turn away, lean back, get animated. A few of their segments end up far
 * from the rest, and average linkage, cutting at exactly k, isolates those
 * outliers as a group of their own. To free the slot it merges two real people
 * — on a 17-minute four-person meeting, the two men. Cutting wider lets the
 * outliers form splinter groups that are then placed back onto the k main
 * groups (see placeSplinters) instead of costing a person.
 *
 * The headroom grows with the number of voice samples because with few
 * samples the busiest groups are not yet the real people: on the opening
 * minutes of that meeting, where one person presents and the others barely
 * speak, a fixed headroom of eight discarded a real participant's only group.
 * One extra group per 25 samples, capped at eight, leaves short sessions
 * exactly as they were and gives long ones the room they need. Measured in
 * ADR 0005.
 */
export function splinterHeadroom(samples: number): number {
  return Math.min(8, Math.floor(samples / 25));
}

/**
 * Gives every segment marked OTHER_VOICE to the nearest kept group, by
 * distance to that group's duration-weighted centroid. Kept labels are left
 * alone. With nothing kept there is nothing to place into, and the labels are
 * returned unchanged.
 */
export function placeSplinters(
  vectors: readonly Float32Array[],
  labels: readonly number[],
  durationsMs: readonly number[],
): number[] {
  const groups = new Map<number, number[]>();
  labels.forEach((l, i) => {
    if (l === OTHER_VOICE) return;
    const g = groups.get(l);
    if (g) g.push(i); else groups.set(l, [i]);
  });
  if (groups.size === 0 || !labels.includes(OTHER_VOICE)) return [...labels];

  const centroids = [...groups.entries()].map(([label, idxs]) => {
    const c = new Float32Array(vectors[idxs[0]!]!.length);
    for (const i of idxs) {
      const w = durationsMs[i] ?? 0;
      for (let d = 0; d < c.length; d++) c[d] = c[d]! + vectors[i]![d]! * w;
    }
    return { label, c: normalise(c) };
  });

  return labels.map((l, i) => {
    if (l !== OTHER_VOICE) return l;
    let best = centroids[0]!.label;
    let bestDist = Infinity;
    for (const { label, c } of centroids) {
      const d = cosineDistance(vectors[i]!, c);
      if (d < bestDist) { bestDist = d; best = label; }
    }
    return best;
  });
}

export type SpeakerCountSource = 'calibration' | 'count' | 'names' | 'automatic';

export interface SpeakerCountHint {
  /** Null means "work it out from the audio". */
  k: number | null;
  source: SpeakerCountSource;
  confident: boolean;
}

/**
 * The tiered strategy: use the most reliable signal available.
 *
 * Calibrated profiles are ground truth — those people demonstrably exist. An
 * explicit head count is the next best thing: it is the one fact the person in
 * the room knows for certain and the audio cannot supply (see ADR 0004). Typed
 * names are a weaker hint, though someone may stay silent or a visitor may
 * join. A single name or a count below two tells us nothing about the size of
 * the group, so it is ignored. With nothing to go on, fall back to thresholding
 * and tell the user the result is approximate.
 */
export function resolveSpeakerCount(opts: {
  names?: readonly string[];
  calibratedProfiles?: number;
  speakerCount?: number;
}): SpeakerCountHint {
  if (opts.calibratedProfiles !== undefined && opts.calibratedProfiles >= 2) {
    return { k: opts.calibratedProfiles, source: 'calibration', confident: true };
  }
  if (opts.speakerCount !== undefined && Number.isInteger(opts.speakerCount) && opts.speakerCount >= 2) {
    return { k: opts.speakerCount, source: 'count', confident: true };
  }
  const named = (opts.names ?? []).map((n) => n.trim()).filter(Boolean);
  if (named.length >= 2) return { k: named.length, source: 'names', confident: true };
  return { k: null, source: 'automatic', confident: false };
}
