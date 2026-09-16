# 8. "Who is speaking now" is bounded by the window

Date: 2026-09-16

## Status

Accepted

## Context

From real use: the indicator that names the current speaker lags when someone else
starts, and sometimes jumps to another person while the same one keeps talking. Both
observations were confirmed by measurement before anything was changed.

The indicator had no path of its own. It showed the identity of the last voice sample
in the last analysed window: updated every 5 s, about audio that ended 2.5 s earlier,
and only when a sample of at least 0.8 s arrived. `bench/now.report.ts` scores it
against human annotation at every update — is the shown speaker the annotated one;
how long after a turn change does the new speaker appear; how often does it change
while the annotation has the same person speaking. On the three-minute AMI excerpt:

| | As shipped |
|---|---|
| Right at the verdict | 27 of 35 (77%) |
| Switch latency, median / p90 | 3.8 s / 6.3 s |
| Turn changes never shown within the turn | 6 of 21 |
| False flips while the same person spoke | 5 of 19 |

## What was tried

**A fast path for the indicator.** Every 2 s, segment the latest window again, embed
the most recent stretch of one voice (0.8–3 s, ignoring the last second where the
model has no context), place it against the known people's centroids, and switch only
with a distance lead or a second confirmation. Five settings were measured:

| Fast path | Right | Latency median / p90 | Never | Flips |
|---|---|---|---|---|
| off | 27/35 | 3.8 / 6.3 | 6 | 5/19 |
| probe ≥0.8 s, lead 0.1 | 27/49 | 3.1 / 4.5 | 5 | 16/31 |
| probe ≥1.5 s, lead 0.2 | 27/44 | 3.8 / 6.2 | 7 | 11/26 |
| probe ≥1.5 s, lead 0.2, ignore probes further than 0.7 | 27/41 | 3.8 / 6.3 | 6 | 9/23 |
| probe ≥2 s, lead 0.25, ignore further than 0.6 | 27/39 | 3.8 / 6.3 | 6 | 7/21 |

In every setting it added exactly zero correct verdicts and some wrong ones. The
loosest bought 0.7 s of median latency for three times the flips; tightening gave the
latency back and still flipped more. A short probe against a centroid is the same
unreliable object as the short segments ADR 0005 measured. Refuted and removed.

**Which sample names the speaker.** Three rules within the existing window: the last
sample (as shipped), the last sample of at least 1.5 s, the longest in the window.
27, 26 and 25 right of 35; 5, 4 and 7 flips. Within noise of each other. Unchanged.

**The literature.** A bounded survey is in `docs/prior-art.md`. Nothing found runs
streaming diarization in a browser. The transferable idea is Diart's: slide the window
every half second, match local speakers to global centroids, update a centroid only
after enough new speech, and weight embedding frames by how exclusively one speaker
holds them. Its reported accuracy at 1 s of latency is worse than at 5 s, which is the
same trade this measurement found.

## Decision

The indicator stays as it was, and its limits are stated: it shows who held the floor
about 2.5 to 7.5 seconds ago, and it is right about three times in four on a table
microphone. The measurement stays in the benchmark. `LiveState.coveredToMs` says how
far a verdict reaches, so an interface can say "a moment ago" honestly.

## Consequences

Latency is structural to trusting only the middle of a 10-second window, which is what
makes the tally accurate; the two goals pull against each other. Flips come from short
samples whose embeddings are unreliable, which no rule downstream can fix.

What would move this is a different design, not a tuning: Diart-style incremental
clustering with frame weighting, which also attacks crediting overlap to both voices
(ADR 0006), or an end-to-end streaming model if one becomes exportable at a size a
browser can carry (LS-EEND is the one to watch). Either is a project. Until then the
honest cheap change is in the interface: present the indicator as trailing, not live.
