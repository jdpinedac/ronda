# 10. Say when the voices arrive muddled

Date: 2026-09-16

## Status

Accepted

## Context

The first diagnostics file from the field (ADR 0009's export, a 37-minute session of
two people) had a share the tester agreed with and a "who is speaking now" indicator she
did not: it named the other person while the dominant one spoke. Its embeddings were
far more spread than any reference recording — each person's samples sat a median 0.79
and 0.68 from their own centroid, against 0.19–0.55 on the annotated tables — and the
conditions explained it: a phone 80 cm from each person on a low table, a small room
with a large window onto a street, and a phone browser applying its own audio
processing.

The tally survives that, because it averages minutes; the indicator does not, because
it reads one sample at a time (ADR 0008). And the spread is the one thing the people at
the table can change, by moving the phone.

## Decision

Measure the spread live — for each person with at least three samples, the median cosine
distance of their samples to their own centroid in centred space; the figure reported is
the worst person's — and above 0.6 warn that the voices arrive muddled, that the shares
still add up, that who is speaking at each moment will be less reliable, and what to do.

The threshold is calibrated on what is known:

| Recording | Spread | Verdict | Known to be |
|---|---|---|---|
| example, 90 s | 0.44 | clear | share error 2.5% |
| ami-meeting, 3 min | 0.44 | clear | 1.8% |
| ES2004a, 17.5 min | 0.51 | clear | 3.8% |
| two-women, 4 min | 0.56 | clear | 13.5%, similar voices |
| TS3003a, 24.6 min | 0.68 | muddled | 24.2%, dominant speaker mistaken |
| IS1009a, 13.4 min | 0.70 | muddled | 11.4% |
| field session, 37 min | 0.79 | muddled | indicator unreliable |

The two annotated meetings it flags are the two where Ronda does worst.

The diagnostics export now also records the browser and the audio processing the
microphone track reports — noise suppression, gain control, echo cancellation, sample
rate — so a muddled room can be told apart from a muddled phone.

## Consequences

A table that gets the warning has something to try. A session that does not is one
where the numbers behaved on every recording measured so far. The threshold will move
if field files say it should; it is a single constant with a table behind it.

The "who is speaking" badge is labelled *a moment ago*. It always was one; now it says
so.
