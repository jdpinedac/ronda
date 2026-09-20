# 13. Say when overlap credit dominates the tally

Date: 2026-09-20

## Status

Accepted

## Context

Overlap — audio the segmentation model hears as two voices at once — cannot be
clustered, so it is credited to whoever held the floor when it began (ADR 0006). On
the annotated meetings that is right far more often than wrong, and it is a small part
of the tally: 2–13 % of the time shown.

A 36-minute field session on rc.10 — six people at a table in a shop, music behind the
voices, the television switch on, introductions skipped — read 42 %. The pipeline ran
clean and the final shares were reproducible, but the tally had two kinds of number in
it. The two largest voices (35 % and 30 %) sat 1.72 apart in centred embedding space and
held steady all session. The four smallest (4–14 %) sat 0.84–0.92 from each other and
traded time from one window to the next: one fell from 20 % to 4 %, another rose from
3 % to 15 %, and between minutes 30 and 35 one lost six points while another gained
five, on sixty new samples. Half the samples were under 1.5 s. With music behind the
voices the model hears a second voice much of the time, and every second of it goes to
the last person heard alone — so whoever spoke briefly just before a noisy stretch
inherits the stretch. The tester found the result excellent. The ranking and the two
large shares deserve that; the four small ones do not, and nothing on the page said so.
The clarity warning (ADR 0010) did fire — the worst spread was 0.69 — but it speaks
about who is speaking now, not about the shares.

## Decision

Measure, on both paths, the share of the time shown that is credited overlap, leaving
out samples that belong to no participant. Above 0.3 warn that much of the time counted
was people talking at once or noise alongside a voice, that it goes to whoever had the
floor, and that the shares of those who spoke least are approximate. The live page shows
it together with the clarity warning when both apply; the file page shows it when
reliability is otherwise good. Technical details show the figure on both pages.

The threshold sits between everything known to behave and the one session known not to:

| Recording | Credited share | Known to be |
|---|---|---|
| ami-TS3003a, 24.6 min | 2 % | share error 24.2 %, for other reasons (ADR 0010) |
| two-women, 4 min | 5 % | 13.5 %, similar voices |
| ami-ES2004a, 17.5 min | 10 % | 3.8 % |
| example and ami-meeting, 90 s and 3 min | 12 % | 2.5 % and 1.8 % |
| ami-IS1009a, 13.4 min | 13 % | 11.4 % |
| distant-voice fixtures, 90 s | 16–18 % | synthetic intruders mixed in |
| field, five clean sessions, 7–37 min | 3–8 % | shares the tables agreed with |
| field, three people, 79 min, introductions | 18 % | re-clustering within 4 points of screen |
| field, four people, 7 min, no introductions | 24 % | short; not judged |
| field, six people in a shop, 36 min | 42 % | small shares moved ±5 points minute to minute |

The annotation itself says real meetings contain 0–20 % overlap, so a reading in the
teens is a real table, not a fault. The gap between 24 % and 42 % is wide; the constant
sits in it and will move when field files say so.

## Consequences

A table that gets the warning knows which numbers to trust: the order and the large
shares, not the small ones. The lever is the same as for muddled voices — the phone's
position — plus a round of introductions so at least the names are right.

The measurement is a share of what is on screen, so a session with much overlap and
little single-speaker speech reads high even when the overlap is genuine talk-over. That
is intended: crediting is a convention, and when the convention is most of the tally the
tally is mostly convention.

The field report prints the figure, and re-clusters exported sessions with the shipped
policy for the television switch, which it did not before; on the shop session that
changed the agreement it reported from 356 to 486 of 486 samples, and removed an
apparent split of one voice that was the wrong policy, not the data.
