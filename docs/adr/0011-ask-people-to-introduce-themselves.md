# 11. Ask people to introduce themselves

Date: 2026-09-17

## Status

Accepted

## Context

A field session of four people, 16.6 minutes, exported as diagnostics: the head count
was right, the names were typed in the order people would speak, and each person spoke
in turn at the start so that Ronda "would learn who was who". The tester reported the
second person shown under the fourth name before that person had spoken, the fourth
name later moving back, and the first person's speech landing on the third name, whose
owner had barely spoken.

The export reproduced the screen exactly (190/190 samples) and the four voices were
reasonably separated (each person's samples a median 0.30–0.51 from their own centroid;
"clear" by ADR 0010). The final grouping was not the failure. Replaying the session
window by window, as the live page runs it, showed what the tester watched:

| What happened | Measured |
|---|---|
| All four identities — and so all four names — existed by | 17.5 s, with four samples, when at most two people had spoken |
| Samples that changed identity from one window to the next, over the session | 225, of 190 samples |
| Identities that at some point held samples of three or four different people | all four |
| Order in which the final identities first appeared | #1 at 1 s, #2 at 14 s, #4 at 92 s, #3 at 261 s |

The mechanism is structural, not a matter of tuning. With the head count k given, the
dendrogram is cut at k from the very first window, so k groups are made out of whatever
has been heard — fragments of the first voice or two. `carryIdentities` then keeps each
identity with the group it shares the most speech with, which is the best that can be
done, and is not enough: the groups are not people yet. Names attach to identities, so
by the time the third person speaks the third and fourth names are already in use.

The names-as-shown accuracy on the annotated meetings — the i-th identity to appear
gets the i-th name, the i-th person to speak owns it — says how general this is
(`npm run bench -- bench/enrol.report.ts`):

| Recording | Shipped grouping, best possible name mapping | Shipped grouping, names as shown | Relabellings |
|---|---|---|---|
| ES2004a, 17.5 min | 97.7 % | 24.6 % | 776 |
| IS1009a, 13.4 min | 85.9 % | 1.2 % | 245 |
| TS3003a, 24.6 min | 70.1 % | 13.1 % | 3833 |
| ami-meeting, 3 min | 99.1 % | 63.8 % | 7 |
| two-women, 4 min | 98.0 % | 2.0 % | 28 |

(Accuracy is the time-weighted share of single-speaker speech with a definite annotated
speaker that carries the right name; speech annotated as overlapping or uncertain,
11–16 % of the total, is not scored. It stays wrong for every method here; ADR 0003.)

The head count cannot be made to grow with the evidence without a threshold, and
ADR 0001 and 0004 measured how fragile those are. What the tester did by instinct is the
answer: a round of introductions, where each person speaks alone for a few seconds while
the page knows whose turn it is.

## What was measured

On the same recordings, each annotated speaker's first N seconds of voice samples were
taken as their profile — as if they had introduced themselves — and every later sample
was attributed to the nearest profile centroid. Variants: raw or centred embedding
space; profiles fixed, or updated with what they are given; one pass, or a final sweep.

| Recording | 5 s, raw, updated | 10 s, raw, updated | 10 s, raw, fixed | 10 s, centred, updated |
|---|---|---|---|---|
| ES2004a | 99.4 % | 98.9 % | 98.9 % | 98.0 % |
| IS1009a | 99.0 % | 98.7 % | 98.7 % | 96.2 % |
| TS3003a | 97.7 % | 97.5 % | 96.2 % | 79.1 % |
| ami-meeting | 100 % | 100 % | 100 % | 98.6 % |
| two-women | 100 % | 99.1 % | 99.1 % | 95.8 % |

Raw space wins clearly on TS3003a, the recording with one dominant speaker; centring
subtracts a mean that is mostly that speaker. Updating the profiles helps at 5 s and is
neutral at 10 s; the final sweep changes nothing. Beyond 10 s per person there is nothing
left to gain. DER, which ignores names, moves from 0.306 to 0.296 on ES2004a: the
partition was already close to the oracle floor of ADR 0005.

## Decision

When names are typed, the live page starts with a round of introductions: it names who
should speak, fills a bar with the voice it has collected for them (target 10 s, Next
enabled from 5 s), and moves on when the person holding the phone says so. Every
single-speaker sample heard in a person's turn goes into their profile and not into the
tally. When the last person is done, the conversation is attributed sample by sample to
the nearest profile, in raw embedding space, and the profile keeps learning from what it
is given. The identity of a sample is the index of its profile, so a name never changes
hands and every named person has a row from the start.

The round can be skipped, and is treated as skipped if anyone gave less than 5 s. Then the
conversation is grouped exactly as before and the page says the names are labels. The
file page has no introductions; the live/file equivalence (`test/live-matches-file`)
is a statement about that path.

Turns are marked in the conversation's clock when Next is pressed, and each sample is
routed by where its midpoint falls, so the lag between hearing and analysing does not
matter; the bar simply fills a few seconds late, and the page says so.

## Consequences

Names now mean something: on the annotated meetings, 96–100 % of scorable speech under
the right name, against 1–64 % before. Identities are fixed by construction; the field
report's replay should show zero relabellings on an introduced session.

The shares are not much more accurate than they were. The oracle floor stands, and
overlapping speech — a tenth to a sixth of these meetings — still belongs to nobody.
The README says this.

The round costs the table about ten seconds per person before the conversation counts,
and a person who joins late has no profile: their speech goes to whoever they sound most
like. Adding a person mid-session is the obvious next feature and is not in this change.

Profiles are embeddings, never audio, and die with the session. The export carries them
apart from the conversation samples, so a field file can say how much voice each profile
had and whether it was clean.
