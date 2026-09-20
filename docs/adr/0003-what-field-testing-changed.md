# 3. What field testing changed

Date: 2026-09-14, extended 2026-09-20

## Status

Accepted

## Context

Ronda was built against measurements and then handed to two people to use on real
conversations. Almost everything that broke in their hands had passed in ours, and the
reasons are worth recording — for whoever works on this next, and because two of the
lessons were about how we were testing, not about the code.

## What real use found that measurement did not

**A result with no evidence behind it looked exactly like one with evidence.** An
eight-second recording of one person yields two voice samples; ask for two speakers and
each sample becomes its own "speaker", producing a confident 65/35 dial. Ronda now
states reliability alongside the numbers and says when there is too little to judge.

**Speech from outside the conversation is still speech.** A television, the next table,
someone passing in the corridor. The segmentation model reports it correctly and the
tally then has more participants than the room. Two mechanisms address it: quiet
distant speech is rejected by level, and — when the user says a television is on —
extra clusters are allowed so those voices get their own group.

**Phone codecs break speaker separation.** Band-limiting to 300–3400 Hz, which is what
a voice note does, made clustering isolate two outlier segments instead of separating
people, crediting one person with 91% of a conversation. Centring the embeddings fixed
it. See [ADR 0002](0002-centre-embeddings-when-the-speaker-count-is-known.md).

## What we got wrong about testing

**A fixture we built ourselves is weak evidence.** Cluster headroom was added on the
strength of a synthetic mixture we made with ffmpeg and judged by eye. It looked like a
clear improvement. Measured against human annotation it was a regression — a two-woman
conversation went from 62/38 to 72/28 against a true 60/40, discarding 33 seconds of
real speech — and a user found it the next day. Annotated recordings settle questions
that constructed ones cannot.

**Some failures cannot be reproduced synthetically at all.** No synthetic fixture
reproduced the band-limiting failure, because a uniform additive bias compresses all
distances equally and leaves their ordering, and therefore the clustering, unchanged.
Whatever a codec does to embedding space, it is not a uniform shift. That regression
test uses real embeddings captured from the failing recording.

**Three hypotheses were wrong before one was right.** Float32 accumulation in the FFT,
a missing Kaldi energy floor, general fbank fidelity — each was plausible, each was
tested, each was refuted. The fbank corrections were real corrections that changed no
measured result. Being willing to reject your own fix is most of the work.

## What cannot be fixed by tuning

**Similar voices.** On a two-woman conversation, Ronda gets the time split nearly right
— 62/38 against a true 60/40 — while misattributing 40% of the moment-to-moment speech.
Totals can be trustworthy while who-said-what is not, and users should be told which
they are relying on.

**Overlapping speech.** 20.6 s of the 27.7 s of unattributed speech in the benchmark is
people talking over each other. An embedding of two mixed voices belongs to neither.
Attributing overlap would buy more than any further improvement to clustering.

**Telling a participant from an intruder.** Nothing in the audio does this reliably.
Surplus groups in the two-woman case sat further from the main groups (1.181) than
genuine intruders did (0.865). The person in the room knows; Ronda does not, so it
asks.

## Consequence

The single most valuable thing a user can do is type the names of who is present. It
supplies the speaker count, which matters more than any model parameter, and it is the
one piece of information the audio cannot provide. Every interface in Ronda asks for it
first.

## What two long sessions on rc.10 added (2026-09-19 and 2026-09-20)

Both on the same Android phone in Chrome, both with the television switch on, both
exported as diagnostics and read with `bench/field.report.ts`.

**Introductions hold up over an hour.** Three people, 79 minutes, one of them joining
at minute 8 through *Someone joined*. Each person's samples sat a median 0.48–0.58 from
their own centroid and the three centroids 1.40–1.53 apart. Re-clustering the exported
samples without the profiles lands within four points of what the screen showed
(33/35/32 against 37/33/30), and from minute 40 on the shares barely moved. The tester
called the result accurate. The page was hidden six times and the microphone track
ended once, at minute 48, despite the wake lock; the session recovered on its own with
one 10-second hole. The log cannot yet say whether the lock was granted or dropped.

**Six people in a shop with music, without introductions.** 36 minutes. The pipeline
ran clean — 432 windows, no errors — and the final shares are reproducible: the shipped
clustering, re-run on the exported samples, puts all 486 in the group the screen showed,
and asking for five or seven people leaves the six groups intact. But the shares were
not stable while the session ran. The two largest voices (35 % and 30 %) sat 1.72 apart
and held steady; the four smallest (4–14 %) sat 0.84–0.92 from each other and traded
time all session — one fell from 20 % to 4 %, another rose from 3 % to 15 %, and between
minutes 30 and 35 one lost six points while another gained five, on sixty new samples.
Half the samples were under 1.5 s. And 42 % of the time shown was overlap credited to
the floor holder, against 3–8 % in clean field sessions and 18 % in the 79-minute
table: with music behind the voices the segmentation model hears a second voice much of
the time, and every second of it goes to whoever was last heard alone. The tester found
the result excellent; the ranking and the two large shares deserve that, the four small
ones do not. ADR 0013 makes the page say so.

**Skipping the round still costs names.** By 37 seconds the page had minted six
identities for three voices heard. The proportions at the end are the clustering's;
which name sits on which bar is not guaranteed. The round is optional and was skipped.

**Every field file so far is Android Chrome.** Seven diagnostics, one browser. Nothing
is known about Safari on iOS, which handles a suspended audio context, a hidden page and
the microphone differently.
