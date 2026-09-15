# 6. Credit overlap to the floor holder

Date: 2026-09-15

## Status

Accepted

## Context

ADR 0005 accounted for the third of the speech that Ronda gets wrong or misses over a
whole meeting, and found that most of it is missed rather than misattributed. The
largest single piece is overlap: stretches where the segmentation model hears two
voices at once. Ronda detected it and deliberately left it out, because an embedding of
two mixed voices belongs to neither and would poison the clustering. ADR 0003 already
noted that attributing it "would buy more than any further improvement to clustering".

Overlap cannot be clustered, but it can be credited without clustering, using time
instead of timbre. Five rules were measured against human annotation on four
recordings, with the real diarization error rate (`bench/overlap.report.ts`):

| Rule | ES2004a | IS1009a | TS3003a | ami-meeting, 3 min |
|---|---|---|---|---|
| leave it out (before) | 0.306 | 0.367 | 0.487 | 0.207 |
| **to the speaker before** | **0.244** | **0.280** | **0.479** | **0.111** |
| to the speaker after | 0.254 | 0.317 | 0.480 | 0.138 |
| to the nearer in time | 0.245 | 0.299 | 0.480 | 0.115 |
| first half before, second half after | 0.248 | 0.296 | 0.480 | 0.124 |
| to the speaker before, only within 1 s | 0.260 | 0.310 | 0.481 | 0.120 |

The simplest rule wins everywhere. On the three-minute excerpt it halves the error.

## Decision

Every overlap span is credited to the speaker of the attributed span that ended most
recently before it: whoever held the floor when the second voice came in. In the live
path, overlap before the first voice of a block goes to the last voice of the previous
block. Overlap before any voice at all stays unattributed.

The total overlap heard is still reported separately, so a table can see how much of
its time was people talking over each other.

## Consequences

Measured with the pipeline as shipped, head count given:

| Recording | ADR 0005 | Now |
|---|---|---|
| ES2004a, 17.5 min | 0.306 | **0.244** |
| IS1009a, 13.4 min | 0.367 | **0.280** |
| TS3003a, 24.6 min | 0.487 | **0.479** |
| two-women, 4 min | 0.330 | **0.312** |
| ami-meeting, 3 min | 0.207 | **0.111** |
| example, 90 s | 0.196 | **0.119** |

On the three-minute excerpt the time share is now 33/31/21/15 against a true
32/32/19/16; on the 90-second example, 35/23/23/19 against 34/23/22/21. The live path
gives the same speaker count everywhere and shares within a few points of the file
path.

**Part of the gain is the metric's convention.** Where the annotation has two people
speaking, the error rate scores the frame as the longer-running turn, which is usually
the person who was already talking. A rule that credits the speaker before therefore
agrees with the scorer by construction. It is also the natural reading — the person
already speaking is still speaking — but the interrupter's words are still not
counted, and someone who mostly speaks over others will still be under-credited. That
is the honest residual, and it is what a two-speaker attribution would buy.

**A one-second guard was measured and rejected.** Restricting the credit to overlap
starting within a second of the previous voice was worse on every recording. Misses
cost more than the occasional wrong guess across a long pause.

**Speech the model hears as silence is the other large piece**, 10–15% of annotated
single-speaker speech on the long meetings, and half of it more than two seconds from
any turn edge, so it is not the annotation being generous. One cheap lever was
measured and not adopted (`bench/silence-bias.report.ts`): subtracting a penalty from
the silence class before the argmax. It trades almost one for one — on ES2004a a
penalty of 1 recovers 26 s of annotated speech and claims 22 s more inside annotated
silence; on TS3003a, 67 s for 36 s — and the recovered speech would still have to be
attributed correctly to count. The segmentation model is not hearing silence too
readily by a margin that a bias can fix; what it misses on these recordings, it misses
with confidence.
