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

export type SpeakerCountSource = 'calibration' | 'names' | 'automatic';

export interface SpeakerCountHint {
  /** Null means "work it out from the audio". */
  k: number | null;
  source: SpeakerCountSource;
  confident: boolean;
}

/**
 * The tiered strategy: use the most reliable signal available.
 *
 * Calibrated profiles are ground truth — those people demonstrably exist.
 * Typed names are a strong hint, though someone may stay silent or a visitor
 * may join. A single name tells us nothing about the size of the group, so it
 * is ignored. With nothing to go on, fall back to thresholding and tell the
 * user the result is approximate.
 */
export function resolveSpeakerCount(opts: {
  names?: readonly string[];
  calibratedProfiles?: number;
}): SpeakerCountHint {
  if (opts.calibratedProfiles !== undefined && opts.calibratedProfiles >= 2) {
    return { k: opts.calibratedProfiles, source: 'calibration', confident: true };
  }
  const named = (opts.names ?? []).map((n) => n.trim()).filter(Boolean);
  if (named.length >= 2) return { k: named.length, source: 'names', confident: true };
  return { k: null, source: 'automatic', confident: false };
}
