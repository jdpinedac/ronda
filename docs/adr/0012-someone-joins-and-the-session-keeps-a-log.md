# 12. Someone joins, and the session keeps a log

Date: 2026-09-18

## Status

Accepted

## Context

Three field sessions on a phone (two, three and four people; the last without a round of
introductions) and one report without a file raised two problems with rc.9.

**Someone who joins after the introductions has no profile.** Their voice goes to
whoever they sound most like, and — worse — that profile learned from it and drifted
towards them. The gap was known (ADR 0011); the field made it concrete.

**A long, silence-heavy session on a desktop browser stopped hearing**, and left no
evidence. Nothing in the engine recorded what happened; a persistent failure in one
window would have retried it every second for ever while the audio piled up; the page
had no way to notice. Before changing anything, memory was measured where it could be:
ONNX Runtime's WASM heap is flat over 600 embedding inferences with varying input
shapes (314 MB after warm-up); the engine is flat over a simulated hour of mostly
silence; the built page is flat over 20 minutes in Chromium (JS heap 4–16 MB, DOM
nodes oscillating, listeners constant); a single failing inference is recovered from at
the next second. No leak was found. The cause of the field failure stays unknown, and
the honest response is instrumentation, bounds, and a way out.

## What was measured for newcomers

Can a voice that never introduced itself be noticed from its distance to the known
profiles? Offline, yes: on the annotated meeting with one person hidden from the
introductions, the hidden voice sits a median 0.79–0.89 from the nearest profile and
the known voices 0.42–0.57 from their own; a threshold at the known voices' 90th
percentile catches 81–100 % of the hidden samples. On the phone sessions, where the
known voices are already spread (90th percentile 0.70–0.74), a hidden voice would sit
at 0.65–0.95 depending on the person: sometimes separable, sometimes not.

Online, with a rule — several far samples, adding up to a few seconds, within a minute —
it is poor (`npm run bench -- bench/newcomer.report.ts`):

| Recording, one of four hidden | Noticed | After | False suggestions |
|---|---|---|---|
| ES2004a, far > 0.75, ≥ 3 samples, ≥ 4 s | 2 of 4 | 20 s and 8 min | 8 in 1.2 h |
| IS1009a | 0–2 of 4 | 3 s to 3 min | 0–2 in 0.9 h |
| TS3003a | 0–1 of 4 | 50 s | 0–1 in 1.6 h |

Two things bound it. Quiet participants never produce three far samples in a minute.
And a profile that learns from what it is given absorbs the newcomer: with learning
gated to samples within 0.75 of the profile, detection roughly doubles, and
`bench/enrol.report.ts` shows the gate costs nothing (identical accuracy on every
annotated meeting). The two phone sessions each produce one suggestion — at 7:29–7:38
and at 4:01 — which the tester can confirm or refute.

## Decision

**The person at the table adds the newcomer.** A button, *Someone joined*, adds a
profile and a row (a name is optional), and that person introduces themselves for ten
seconds as the others did; *Done* returns to the conversation. `introduce()` now works
mid-conversation; `addPerson()` raises the head count on the path without profiles.

**A profile learns only from samples clearly its own** (`LEARN_DISTANCE` = 0.75).

**Runs of far samples are logged, not acted on.** The rule that would have asked the
table (`NewVoiceWatch`) records a `far-run` event in the session log instead. Field
files will say how a real newcomer looks against real false alarms; the automatic
question waits for that evidence.

**The session keeps a log** of what happened — every window analysed, every error,
audio dropped, recoveries, what the page saw of the capture (context state changes,
track muted or ended, page hidden or shown), introductions and people added — and the
log travels with the diagnostics export and is summarised by the field report.

**Failures are bounded and visible.** A window that fails three times in a row is
skipped and logged. Audio waiting for analysis never exceeds `MAX_BUFFER_MS` (120 s);
beyond that the oldest is let go, logged once per episode. The page watches for audio
arriving without analysis for 30 s and offers *Resume analysis*, which abandons a stuck
inference, keeps the last window of audio and starts again from there, and nudges a
suspended audio context. Returning to the page does the nudge too.

**The fake models tell voices apart by distance.** The real features are mean-normalised
per bin, which erases each bin's level; the old fake embedding pointed every sample the
same way and only centring told voices apart, so no distance threshold could be tested.
A fake voice is now a pair of tones it alternates between every 100 ms, the embedding is
the per-bin spread with the leakage floor removed, and a third voice exists. Voices sit
0.85–1.05 apart, a voice's own samples at 0.00.

## Consequences

A newcomer costs one tap and ten seconds, and gets a row of their own. Nobody is
added by Ronda alone; the far-run events will show whether that caution was warranted.

The next session that stops hearing will say why: the export carries the log, and the
report prints its first error, drop, recovery and capture event. If the cause is a
suspended context or a muted track, the page now also recovers by itself when the user
comes back to it.

The field report no longer replays profile sessions, where identities are fixed by
construction; the replay stays for sessions without introductions.
