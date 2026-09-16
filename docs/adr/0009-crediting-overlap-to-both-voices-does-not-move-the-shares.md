# 9. Crediting overlap to both voices does not move the shares

Date: 2026-09-16

## Status

Accepted (the change was measured and not adopted)

## Context

ADR 0006 credits speech the model hears as two voices to whoever held the floor when
the second voice came in. Both people are talking, so the natural next step was to
credit both. The segmentation model names the two as local speakers of the window, and
a window almost always contains a stretch where each of them spoke alone; tying a local
speaker to a person by the sample that most overlaps those stretches in time — from
whichever window embedded it — identifies both, and the overlap can be added to each.
In the live path the second person's stretch alone often comes after the overlap, in
the next window, so unresolved overlaps waited one window before falling back to the
floor holder.

It was built for both paths, with deterministic fake models that produce overlap (two
tones at once, detected by Goertzel power at each frequency), and measured with a new
benchmark figure: the **share error**, half the L1 distance between the shares Ronda
shows and the annotated shares with overlap counted for everyone speaking. That is
what a table reads off the dial, and what the diarization error rate — one speaker per
instant — cannot score.

## What was measured

Head count given, file path:

| Recording | Share error before | after | Overlap heard | Credited to both |
|---|---|---|---|---|
| example, 90 s | 2.5% | 2.7% | 9.5 s | 6.4 s |
| ami-meeting, 3 min | 1.8% | 1.9% | 20.6 s | 10.2 s |
| two-women, 4 min | 13.5% | 12.1% | 8.8 s | 5.4 s |
| ES2004a, 17.5 min | 3.8% | 3.1% | | |
| IS1009a, 13.4 min | 11.4% | 12.8% | | |
| TS3003a, 24.6 min | 24.2% | 24.4% | | |

DER was identical everywhere, by construction. The change acted — half to two thirds of
the overlap heard was credited to both — and moved the shares by at most 1.4 points
either way, with no direction. Two things bound it: the model hears only 40–60% of the
annotated overlap as overlap (ADR 0005's coverage table), and the second voice is
identified only partly right, so what the correct credits gain the wrong ones lose.

## Decision

Not adopted. Overlap stays credited to the floor holder. The share-error figure stays in
the benchmark, and the fake models keep their overlap so the next attempt can be tested
without weights. The implementation is on the branch `feat/overlap-both-voices`.

## Consequences

The share error is now the figure to watch for the product, and it says where the
problem is: TS3003a shows 58% for a person who spoke 83% of the time. That is not
overlap; it is the dominant speaker's short segments landing near other people
(ADR 0005), and it is worth twenty-four points where overlap was worth one.

**Also measured, also not adopted: temporal smoothing.** A field report described a
person who talked a lot being shown as someone else while they spoke. Smoothing the
assignments over time — Viterbi over the sequence of samples, each costing its distance
to a group's centroid plus a penalty for every change of speaker, decaying with the gap
between samples — is the classic answer, and it had not been tried. On the stored
embeddings (`bench/smooth.report.ts`) it gained 0.004–0.016 of DER on three recordings
and lost 0.03 on TS3003a, the one that matches the report, taking its share error from
24% to 27%: where the dominant speaker's samples already sit near other centroids,
smoothing moves them there more consistently, not less. The fix for that case needs the
case itself, which is what the diagnostics export is for.

For the incremental redesign considered in ADR 0008, this sets the expectation for its
overlap half: whatever the clustering does, crediting the second voice is capped by how
much overlap the segmentation model hears and by how reliably a short stretch can be
tied to a person. Its "who is speaking now" half is the part with room.
