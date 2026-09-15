# 4. Ask for the number of people

Date: 2026-09-15

## Status

Accepted

## Context

Users reported that Ronda showed up to ten voices for a table of four. The report
was reproduced by running the unmodified pipeline in Node against the whole of AMI
meeting ES2004a — four people, 17.5 minutes, one distant microphone — and against
the shorter recordings the project had been measured on until then.

With the number of people supplied, every recording came out with exactly that many
speakers. Without it, the count depends on the length of the conversation:

| Minutes of the same meeting | Speakers shown without a head count |
|---|---|
| 3 | 4 |
| 5 | 7 |
| 8 | 9 |
| 11 | 16 |
| 17.5 | 15 (by file), 10 (live) |

Two of the four people were each spread across eight groups. The README's
measurements were all taken on 90- and 180-second excerpts, which is precisely where
the automatic mode still happens to land on the right answer.

The mechanism is the one ADR 0001 already suspected. `DEFAULT_THRESHOLD` was calibrated
on clean, close-microphone clips where one person's segments sit 0.23–0.34 apart. On
a table microphone the same person spreads much further: over the full meeting a
quarter of all same-speaker pairs are more than 0.7 apart, and two different people
come as close as 0.50. No fixed threshold separates these. Sweeping it on the stored
embeddings, 0.9 gives four speakers on the long meeting but two on a clean
four-speaker clip. The tiny-cluster absorber does not act as a bound either: any
group with two segments, or two seconds, survives, and a long conversation produces
plenty of those.

The surplus groups are not intruders. On a recording with chatter under the meeting,
five of the nine groups shown were single segments of people who were at the table.

## Decision

Ronda asks how many people are at the table before it starts, and will not start
without an answer. Names remain optional and are labels only.

The engine keeps its automatic mode, reached when no count is given, because the
benchmark uses it to show why the question is asked. The interface never reaches it.

A benchmark now runs the real pipeline against the whole meeting (`npm run bench`),
and a copy of the 227 embeddings it extracts is committed so clustering changes can be
tried in seconds without running the models (`npm run bench:offline`).

## Consequences

The reported failure cannot occur from the interface: the number of speakers shown
is never more than the number typed.

Asking is a cost. It is one more thing to do before pressing Listen, and someone who
does not know how many people will join has to guess. The measurement says the guess
is still worth more than the alternative.

The harder problem is now visible. With the count known, the full meeting still comes
out at 47/28/22/4 against a true 42/29/18/11: two real people are merged into one
group and a fourth group is filled with leftovers. DER is 0.395, against the 0.199
the three-minute excerpt gives. The published accuracy was an excerpt's accuracy, and
the README now says so. Average-linkage clustering makes one partition and never
revisits it; a reassignment step after the cut is the first thing to try, on the
stored embeddings, before anything else.

Two smaller findings from the same investigation are recorded here rather than fixed:
the level filter that rejects distant speech drops 5.7 s of real speech from a clean
four-speaker clip, costing the automatic mode a person; and names typed by the user
are attached to groups in order of speaking time, not identity, which the hint under
the field now says plainly.
