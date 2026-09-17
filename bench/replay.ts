/**
 * Re-runs the live clustering, window by window, on the embeddings of a
 * diagnostics export. The export keeps only each sample's final identity; a
 * user watched the identities being handed out and moved around, and that
 * history is what this recovers: when each identity — and so each name —
 * first appeared, how many samples changed hands, and which final groups each
 * identity held along the way.
 *
 * The windowing is reconstructed from the sample times, assuming a single
 * stretch of listening from zero: the first window is trusted to 7.5 s and
 * each later one 5 s further, as in live.ts. A session with pauses will be
 * approximated, not reproduced.
 */
import {
  agglomerative, centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom, carryIdentities,
  CLUSTER_HEADROOM,
} from '../src/engine/clustering.js';

export interface ReplayInput {
  speakerCount: number | null;
  backgroundVoices: boolean;
  spans: readonly { startMs: number; endMs: number }[];
  durationsMs: readonly number[];
  vectors: readonly (readonly number[])[];
  /** Identities as exported; used to say which final groups each identity held. */
  identities: readonly number[];
}

export interface Replay {
  /** Identity of each sample after the last window, as the screen showed it. */
  identities: number[];
  /** When each identity first appeared, in ms of conversation (end of the trusted region). */
  firstSeenMs: Map<number, number>;
  /** Samples whose identity changed from one window to the next, summed over the session. */
  relabelled: number;
  /** For each identity, the set of exported (final) identities its samples ended up in. */
  heldFinal: Map<number, Set<number>>;
}

const FIRST_TRUST_TO_MS = 7500;
const HOP_MS = 5000;

export function replayLive(b: ReplayInput): Replay {
  const V = b.vectors.map((v) => Float32Array.from(v));
  const n = V.length;
  const k = b.speakerCount;
  const windowOf = (i: number) => Math.max(0, Math.ceil((b.spans[i]!.endMs - FIRST_TRUST_TO_MS) / HOP_MS));

  let identities: number[] = [];
  let nextId = 0;
  let previous: number[] = [];
  const firstSeenMs = new Map<number, number>();
  const heldFinal = new Map<number, Set<number>>();
  let relabelled = 0;

  let upto = 0;
  const lastWindow = n > 0 ? windowOf(n - 1) : -1;
  for (let w = 0; w <= lastWindow; w++) {
    while (upto < n && windowOf(upto) <= w) upto++;
    if (upto === 0) continue;
    const vectors = V.slice(0, upto);
    const durations = b.durationsMs.slice(0, upto);
    let labels: number[];
    if (k !== null) {
      // Same policy as clusterKnownCount in live.ts and diarize().
      const centred = centreEmbeddings(vectors);
      labels = b.backgroundVoices
        ? keepBusiest(agglomerative(centred, { k: k + CLUSTER_HEADROOM }), durations, k)
        : placeSplinters(centred, keepBusiest(agglomerative(centred, { k: k + splinterHeadroom(upto) }), durations, k), durations);
    } else {
      labels = agglomerative(vectors, { threshold: 0.7 });
    }
    ({ identities, nextId } = carryIdentities(labels, identities, durations, nextId));

    for (let i = 0; i < previous.length; i++) if (previous[i] !== identities[i]) relabelled++;
    const at = FIRST_TRUST_TO_MS + w * HOP_MS;
    identities.forEach((id, i) => {
      if (id < 0) return;
      if (!firstSeenMs.has(id)) firstSeenMs.set(id, at);
      const final = b.identities[i];
      if (final !== undefined && final >= 0) (heldFinal.get(id) ?? heldFinal.set(id, new Set()).get(id)!).add(final);
    });
    previous = [...identities];
  }
  return { identities, firstSeenMs, relabelled, heldFinal };
}
