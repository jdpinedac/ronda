# 5. Place splinters back when the head count is known

Date: 2026-09-15

## Status

Accepted

## Context

ADR 0004 left the harder problem visible: with the head count given, the whole of
AMI meeting ES2004a — four people, 17.5 minutes, one distant microphone — came out
with two real people merged into one group and a fourth group full of leftovers.
Two more whole meetings were fetched to make sure this was not one recording's
quirk (`spike/10-fetch-ami-meeting.py`). It was not:

| Meeting | People | Minutes | DER, cut at exactly k | People merged |
|---|---|---|---|---|
| ES2004a | 4 | 17.5 | 0.395 | 2 |
| IS1009a | 4 | 13.4 | 0.450 | 2 |
| TS3003a | 4 | 24.6 | 0.511 | 2 |
| two-women | 2 | 4.1 | 0.402 | — |

The geometry of the embeddings says why. In centred space, the two men in ES2004a
sit 0.88 apart with compact segments (90th percentile 0.55 and 0.60 from their own
centroid). The two women spread much further: 90th percentile 0.84 and 0.86, with nine
segments closer to another person's centroid than their own. Average linkage, cutting
at four, isolates those outliers as a group and pays for the slot by merging the men.

## What was tried

Every variant was scored with the real diarization error rate on stored embeddings
(`npm run bench -- bench/score.report.ts`), which takes seconds, and the promising ones
on the real pipeline.

**A floor to measure against.** Assigning every segment to its *annotated* speaker's
centroid — an oracle, not a method — gives the best result any centroid-based
clustering could reach with these embeddings: 0.306, 0.292 and 0.385 on the three
meetings. Anything near that is done; anything the oracle cannot fix is not a
clustering problem.

**Refuted, clustering.** Reassigning segments to the nearest centroid after the cut
(one, three or ten rounds), cutting wider and merging the closest centroids, and
weighting the linkage by segment duration all left ES2004a within a hundredth of 0.395
with the men still merged. Clustering only segments of two seconds or more and placing
the rest reached 0.313 on ES2004a and 0.330 on two-women, but collapsed back to 0.377
at a 2.2-second cutoff and to 0.388 at 2.5: too sensitive to a threshold to trust.

**Refuted, embeddings.** Fixed windows of 2 s (hop 1 s) or 3 s (hop 1.5 s) inside each
span, the common practice in diarization, raised the oracle floor on every recording
(ES2004a 0.306 → 0.331 → 0.339; TS3003a 0.385 → 0.505 → 0.471). Shorter embeddings
are noisier embeddings; one per span is right. The fp32 WeSpeaker model left the
floors unchanged (0.306, 0.291, 0.382). CAM++ with mean normalisation, the candidate
from spike 09, also left them unchanged (0.317, 0.296, 0.381). Three models with the
same floor means the limit is not the weights.

**Kept.** Cutting wider than k, keeping the k busiest groups — which `keepBusiest`
already did for the television case — and then placing each surplus group's segments
onto the nearest kept centroid instead of discarding them. With a fixed headroom of
eight this reached the oracle on ES2004a but was catastrophic on short sessions: the
first three minutes of the same meeting, one person presenting, went from 0.400 to
0.554, because with few samples the busiest groups are splinters of the presenter
rather than the other people. Scaling the headroom with the evidence — one extra group
per 25 samples, capped at eight, so nothing changes below 25 samples — removed those
failures.

## Decision

When the head count is known and no intruders were declared, cut the dendrogram at
k + `splinterHeadroom(samples)`, keep the k busiest groups, and place every remaining
segment onto the nearest kept group by distance to its duration-weighted centroid.

When intruders were declared, keep the previous behaviour: cut at k + 2 and discard the
surplus. Nothing in the audio says whether a surplus group is a television or a
participant's outliers; the person in the room does.

## Consequences

Measured against human annotation, int8 models, the pipeline as shipped:

| Recording | Before | After | Oracle floor |
|---|---|---|---|
| ES2004a, 17.5 min | 0.395, two merged | **0.306** | 0.306 |
| IS1009a, 13.4 min | 0.450, two merged | **0.367** | 0.292 |
| TS3003a, 24.6 min | 0.511, two merged | **0.487** | 0.385 |
| two-women, 4 min | 0.402 | **0.330** | 0.345 |
| ami-meeting, 3 min | 0.200 | 0.207 | 0.207 |
| example, 90 s | 0.196 | 0.196 | 0.196 |

Nobody is merged any more on the three meetings. The costs are honest: one second of
extra confusion on the three-minute excerpt, and on prefixes of ES2004a the change is
worse at three minutes (0.400 → 0.465) and at fourteen (0.426 → 0.433) while much
better at eight (0.513 → 0.412), eleven (0.511 → 0.408) and the whole (0.395 →
0.306). Those prefixes are one meeting's opening, not independent recordings.

The floor itself is the next problem, and it is not in the clustering. On TS3003a the
dominant speaker has 62 of 206 segments closer to someone else's centroid; the oracle
cannot fix that and neither can a better model, since three of them agree. Either the
segmentation hands the embedder mixed or misattributed audio the annotation does not
mark as overlap, or this speaker genuinely sounds like different people from where the
microphone sits. Telling those apart needs listening to the segments, not another
sweep.

`bench/embedding.report.ts` re-embeds recordings with a different strategy or model,
`bench/score.report.ts` scores any dump against the annotation with the oracle
alongside, and `test/long-meeting-regression.test.ts` pins the whole-meeting result
with the stored embeddings, in milliseconds.
