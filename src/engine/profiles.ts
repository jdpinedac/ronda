/**
 * Speaker profiles: what an introduction leaves behind.
 *
 * When the people at the table introduce themselves in turn, every voice
 * sample heard while a person speaks goes into that person's profile — the
 * embeddings and their durations, summarised as a duration-weighted centroid.
 * Attribution then asks which centroid a new sample is nearest to, instead of
 * grouping blind and handing names out by the order the groups happened to
 * form (ADR 0011). The identity of a sample is the index of its profile, so a
 * name never changes hands.
 *
 * A profile holds embeddings, never audio; it lives as long as the session.
 */
import { cosineDistance, normalise } from './clustering.js';

export interface SpeakerProfile {
  vectors: Float32Array[];
  durationsMs: number[];
  /** Duration-weighted, unit-length mean of the vectors; null until one arrives. */
  centroid: Float32Array | null;
}

export function createProfile(): SpeakerProfile {
  return { vectors: [], durationsMs: [], centroid: null };
}

export function profileMs(p: SpeakerProfile): number {
  return p.durationsMs.reduce((s, d) => s + d, 0);
}

export function addToProfile(p: SpeakerProfile, vector: Float32Array, durationMs: number): void {
  p.vectors.push(vector);
  p.durationsMs.push(durationMs);
  const c = new Float32Array(vector.length);
  p.vectors.forEach((v, i) => { const w = p.durationsMs[i]!; for (let d = 0; d < c.length; d++) c[d] = c[d]! + v[d]! * w; });
  p.centroid = normalise(c);
}

export interface ProfileMatch {
  index: number;
  distance: number;
  /** Runner-up's distance minus the winner's; Infinity with a single candidate. */
  margin: number;
}

/** The profile whose centroid is nearest, among those that have heard anyone. */
export function nearestProfile(vector: Float32Array, profiles: readonly SpeakerProfile[]): ProfileMatch | null {
  let best = -1, bestDist = Infinity, second = Infinity;
  profiles.forEach((p, i) => {
    if (!p.centroid) return;
    const d = cosineDistance(vector, p.centroid);
    if (d < bestDist) { second = bestDist; bestDist = d; best = i; } else if (d < second) second = d;
  });
  if (best < 0) return null;
  return { index: best, distance: bestDist, margin: second - bestDist };
}
