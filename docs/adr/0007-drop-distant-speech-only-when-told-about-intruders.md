# 7. Drop distant speech only when told about intruders

Date: 2026-09-16

## Status

Accepted

## Context

Since the field test recorded in ADR 0003, speech much quieter than the table's
median level has been dropped before embedding, on the reasoning that a voice from
across the room arrives far quieter than one at the table. The threshold was set from
one constructed recording, where distant conversation fell in the gaps of a meeting,
and the commit that introduced it said clean recordings lost nothing.

Two things changed. The head count became mandatory (ADR 0004), which removed the
failure the filter was mostly protecting against — distant voices inventing
participants — since the number of groups is now fixed by the user. And the benchmark
grew whole meetings and human annotation, which allowed the filter to be measured
instead of eyeballed (`BG_RATIO=… BENCH_ONLY_COUNT=1 npm run bench`).

| Recording | Filter off | Filter at 0.45 (as shipped) | Speech dropped |
|---|---|---|---|
| example, 90 s | 0.119 | 0.119 | 0 s |
| ami-meeting, 3 min | 0.111 | 0.111 | 0 s |
| two-women, 4 min | 0.312 | 0.312 | 0 s |
| ES2004a, 17.5 min | 0.243 | 0.244 | 1 s |
| **IS1009a, 13.4 min** | **0.271** | 0.280 | **9 s** |
| TS3003a, 24.6 min | 0.479 | 0.479 | 0 s |
| four-speakers-zh, 57 s, clean | — | — | **5.7 s of 28 s** |
| with-distant-voices, chatter under speech | 0.341 | 0.341 | 0 s |
| **distant-in-gaps, the case it was built for** | 0.510 | **0.497** | 5.3 s |

On the meetings, the filter either did nothing or dropped real speech: nine seconds
on IS1009a, a fifth of all speech on the clean four-speaker clip. It helped only on
the constructed recording it was tuned on, and there the user already has a better
tool: ticking "a television, radio or nearby table is audible" adds cluster headroom
(ADR 0005) and, with the filter, brings that recording to 0.483.

Nothing in the audio tells a soft-spoken participant from a voice at the next table.
This is the same conclusion ADR 0003 reached about cluster headroom, and it gets the
same answer.

## Decision

The level filter runs only when the user has declared intruders. With the switch off,
no speech is dropped for being quiet. With it on, quiet speech is dropped and the
surplus groups are discarded, as before.

## Consequences

IS1009a improves from 0.280 to 0.271 and the clean four-speaker clip keeps all of its
speech. The distant-in-gaps recording gets worse when the user does not tick the switch
despite intruders (0.497 → 0.510) and better when they do (0.483).

The live path judges loudness against what it has heard so far, so with the switch on
it lets the first quiet stretches through before the table's level is established, and
drops less than the file path does. That is inherent to listening as it happens.

`BACKGROUND_LEVEL_RATIO` keeps its measured value; only when it applies has changed.
