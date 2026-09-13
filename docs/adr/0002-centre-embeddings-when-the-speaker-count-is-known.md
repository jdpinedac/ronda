# 2. Centre embeddings when the speaker count is known

Date: 2026-09-13

## Status

Accepted

## Context

The first real-world test of Ronda reported that it found only one speaker.

Investigation reproduced it by degrading a two-speaker recording in four ways and
measuring the resulting split:

| Degradation | Share of the floor |
|---|---|
| None | 55/45 |
| Volume reduced to 15% | 51/49 |
| Pink noise added | 54/46 |
| Echo | 51/49 |
| **Band-limited to 300–3400 Hz** | **91/9** |

Only band-limiting broke it — which is precisely what a phone codec, a voice note or a
cheap microphone does to a recording. Neither quiet audio nor noisy audio was a problem.

The failure was not what the symptom suggested. The clustering had not decided one
person did all the talking; it had stopped separating people at all. With the segments
labelled in time order, the assignment read `000000100001`: average-linkage clustering
had isolated two outlier segments and left *both* speakers together in the other
cluster. Band-limiting weakens the discriminative signal enough that the distance
between two outliers becomes smaller than the distance between two people.

Three hypotheses were investigated and discarded before the cause was understood:
float32 accumulation in the FFT, a missing Kaldi-style energy floor, and fidelity of
the fbank front end generally. Correcting the front end to match the reference exactly
— its 32768 sample scaling, its Nyquist bin, its energy clamp — changed no measured
result. The fbank was not the problem.

## Decision

Subtract the mean of all embeddings in a session before clustering, and renormalise.
Apply this only when the number of speakers is known.

## Consequences

Measured across ten recordings, the two broken cases recover and nothing else moves:

| Recording | Before | After |
|---|---|---|
| Clean, two speakers | 55/45 | 55/45 |
| Band-limited | **91/9** | **58/42** |
| Simulated phone on a table | **95/5** | **62/38** |
| Echo, noise, quiet, long reverb | 51/49 … 62/38 | unchanged |
| Four speakers, clean and band-limited | 42/24/21/14 | unchanged |

**Only when K is known, and that restriction is load-bearing.** Centring widens every
distance — mean pairwise distance rose from 0.75 to 1.09 — which destroys the
calibration of `DEFAULT_THRESHOLD`. Measured in centred space, the largest
within-speaker distance exceeded the smallest between-speaker distance in four of five
recordings, so no single threshold separates them. Cutting the dendrogram at a known K
does not care about absolute distances; a threshold cares about nothing else. In
automatic mode the calibrated threshold is worth more than the outlier resistance.

This strengthens the case for naming the people at the table, already the conclusion of
[ADR 0001](0001-neural-speaker-embeddings-in-the-browser.md). It is now not merely more
accurate but a different, more robust algorithm.

**The regression test uses real embeddings.** Every synthetic fixture attempted
reproduced the arithmetic without reproducing the failure: a uniform additive bias
compresses all distances by the same factor and leaves their ordering, and therefore
the clustering, unchanged. Whatever band-limiting does to embedding space, it is not a
uniform shift. `test/fixtures/channel-embeddings.json` holds twelve real vectors from
the failing recording.

**An unexplained discrepancy remains.** On band-limited audio this implementation's
fbank differs from the reference by up to 4.35e-2 in the mel bins the filter emptied,
against 7.2e-5 on clean audio. Matching the reference's scaling, Nyquist bin and energy
clamp each left it unchanged. It is carried rather than chased: applying all three
corrections left every measured speaking share identical to the percentage point.
