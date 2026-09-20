# Changelog

All notable changes to Ronda. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). Until a release candidate
has survived real tables, versions carry an `-rc.N` suffix.

## [0.1.0-rc.11] — 2026-09-20

Eleventh candidate. Two long sessions survived; the page now says when talk-over
or noise is carrying the tally.

### Added
- Both pages warn when more than three tenths of the time shown is overlap
  credited to whoever held the floor. Real meetings read 2–13 %; a table of six
  in a shop with music read 42 %, and there the four smallest shares moved by
  five points from one minute to the next while the two largest held. The
  warning says the shares of those who spoke least are approximate. Technical
  details show the figure on both pages
  ([ADR 0013](docs/adr/0013-say-when-overlap-credit-dominates.md)).
- The accuracy bench prints the credited share for every recording.

### Fixed
- The field report re-clustered exported sessions with the wrong policy when the
  television switch was on, and reported 356 of 486 samples agreeing where the
  shipped clustering agrees on all 486. Its "with one more or one fewer person"
  lines had the same fault.

### Documented
- [ADR 0003](docs/adr/0003-what-field-testing-changed.md) records what a
  79-minute table of three with introductions and a 36-minute table of six in a
  noisy shop taught: introductions hold up over an hour, the shares of a large
  table are reproducible but the small ones churn, and every field file so far
  is Android Chrome.

## [0.1.0-rc.10] — 2026-09-18

Tenth candidate. Someone can join late, and a session that goes wrong says so.

### Added
- *Someone joined* on the live page, once the conversation is being counted
  against profiles: adds a row (name optional) and has the newcomer introduce
  themselves for ten seconds like everyone else. Before, a late arrival was
  credited to whoever they sounded most like.
- The session keeps a log — windows analysed, errors, audio dropped,
  recoveries, what the browser did to the capture, introductions, people
  added — exported with the diagnostics and summarised by the field report.
- *Resume analysis* appears when audio has been arriving for 30 seconds
  without being analysed; it drops a stuck inference, keeps the last window
  of audio and carries on, and nudges a suspended audio context. Coming back
  to the page does the nudge as well.
- `bench/newcomer.report.ts` measures whether a voice that never introduced
  itself can be noticed automatically. It cannot, reliably: 0–3 of 4 hidden
  voices on the annotated meetings, minutes late, with 1–8 false suggestions
  an hour. Runs of far samples are logged instead of asked about
  ([ADR 0012](docs/adr/0012-someone-joins-and-the-session-keeps-a-log.md)).

### Changed
- A profile learns only from voice samples clearly its own (within 0.75), so
  a voice nobody introduced cannot pull a profile towards itself. Measured to
  cost nothing in attribution accuracy.
- A window that keeps failing is skipped after three tries instead of retried
  for ever, and audio waiting for analysis is capped at two minutes.
- Technical details show audio waiting and log counts.

### Fixed
- The field report no longer replays sessions with introductions, where
  identities cannot change hands; it said they had.

## [0.1.0-rc.9] — 2026-09-17

Ninth candidate. The table introduces itself, and names mean something.

### Added
- A round of introductions on the live page. With names typed, Ronda says whose
  turn it is, fills a bar with the voice it has collected for them (ten seconds
  is the target, five the minimum), and moves on when you press Next. What is
  heard in a person's turn becomes their voice profile and is not counted. From
  the last Next on, every voice sample goes to the nearest profile and stays
  there: a name never changes hands, and everyone has a row from the start.
  Skip the round, or leave anyone under five seconds, and the conversation is
  grouped exactly as before, with the names as labels. See
  [ADR 0011](docs/adr/0011-ask-people-to-introduce-themselves.md).
- `bench/enrol.report.ts` measures the round against the annotated meetings.
  Introductions of 10 s per person put 96–100 % of scorable speech under the
  right name; the shipped grouping, with names handed out in order of
  appearance, managed 1–64 %.
- The diagnostics export carries the introduction samples apart from the
  conversation, and the field report says how much voice each profile had.

### Changed
- Technical details on the live page show the voice collected per person.

## [0.1.0-rc.8] — 2026-09-17

Eighth candidate. One question instead of two, and honest words about what the
names mean.

### Changed
- Names come first on both pages and the head count follows them: type three
  names and the number reads 3, add a fourth and it reads 4, until you edit the
  number yourself. The number stays required with fewer than two names, since a
  single name says nothing about the size of the table (ADR 0004).
- The hint under the names no longer promises that the first name goes to
  whoever speaks first or that everyone keeps their name. A field session showed
  all four names handed out within 17 seconds, to fragments of the first two
  voices, and 225 samples changing hands over the session. Ronda does not yet
  recognise who is who, and now says only that.

### Added
- The field report replays a diagnostics export window by window and prints
  what the user watched: when each identity (each name) first appeared, how
  many voices had actually been heard by then, how many samples changed identity
  between windows, and which final groups each identity held along the way.

## [0.1.0-rc.7] — 2026-09-16

Seventh candidate. Ronda says when the voices arrive muddled, and what to do.

### Added
- The live page measures how clearly the voices arrive — the spread of each
  person's samples — and warns when it is too high for moment-to-moment
  attribution to be trusted, with what to do about it: move the phone. The
  figure is in Technical details.
- The diagnostics export records the browser and the audio processing the
  device reported applying (noise suppression, gain control, echo cancellation,
  sample rate), so a muddled session can be told apart from a muddled phone.

### Changed
- The "who is speaking" badge says *a moment ago*: its verdict is about audio a
  few seconds old, and now reads that way.

## [0.1.0-rc.6] — 2026-09-16

Sixth candidate. A session Ronda got wrong can now be handed over without its
audio.

### Added
- "Export diagnostics" on the live page, after stopping: a file with the
  embedding, timing and assignment of every voice sample the session kept.
  No audio, no names. `bench/field.report.ts` reads it and reproduces the
  session, so a table Ronda got wrong can be studied without recording it.
- The benchmark reports the share error: how much of the floor is credited to
  the wrong person, against annotated shares that count overlap for everyone
  speaking. Crediting overlap to both voices was built and measured with it,
  moved the shares by at most 1.4 points either way, and was not adopted
  (ADR 0009). The fake models used in tests can now produce overlap.
- Temporal smoothing of assignments (Viterbi with a switching penalty) was
  measured on the stored embeddings: small gains on three recordings, worse
  on the one where a dominant speaker is mistaken for others. Not adopted;
  `bench/smooth.report.ts`.
- The live state says how far into the audio its verdict reaches. A benchmark
  report scores "who is speaking now" against annotation: accuracy, switch
  latency and false flips. A fast path for the indicator and two alternative
  rules were measured and did no better; ADR 0008 has the numbers, and
  `docs/prior-art.md` a survey of low-latency diarization.

## [0.1.0-rc.5] — 2026-09-16

Fifth candidate. Dark, bilingual, and a stop that is a pause.

### Added
- A dark theme, and switches in every page's footer for language (Español,
  English) and theme (light, dark, or follow the system). Both are remembered
  by the browser; they are the only thing Ronda stores.

- Stopping the live mode is a pause. The tally stays on screen, Resume keeps
  adding to the same conversation with the same people, and Reset starts over.

### Fixed
- "Technical details" is translated.

## [0.1.0-rc.4] — 2026-09-16

Fourth candidate. People keep their place on screen.

### Changed
- In the live mode a person keeps their colour, row and name for the whole
  session. Groups used to be renumbered by speaking time after every update,
  so when one person overtook another their colours and names swapped.
  Identities are now carried across re-clusterings by the speech each group
  shares with the previous one. Both pages number people by who spoke first.

### Fixed
- Names typed by the user are shown as text on both pages; they were being
  interpreted as markup. Found by CodeQL in CI.

## [0.1.0-rc.3] — 2026-09-16

Third candidate. Nothing is dropped for being quiet unless you say there is a
television.

### Changed
- Quiet speech is dropped as coming from outside the conversation only when
  "a television, radio or nearby table is audible" is ticked. Measured on
  whole meetings, the filter dropped real speech wherever it acted — nine
  seconds on one meeting, a fifth of a clean clip — and helped only where
  intruders were present (ADR 0007).

## [0.1.0-rc.2] — 2026-09-16

Second candidate. Same measurement on the table as on a file, and a build
that checks itself.

### Changed
- The live path now analyses the same sliding window as the file path — 10 s
  every 5 s, trusting only the middle of each — instead of disjoint 10 s
  blocks. On the same audio both paths give the same shares; before, the live
  path lost the model's least reliable seconds at every block edge and could
  show a different speaker count. Results still arrive every 5 s, covering
  audio up to 2.5 s ago.
- Clustering computes pairwise distances once and updates them on each merge
  (Lance–Williams, average linkage). Same labels, verified on every stored
  embedding set; a whole meeting clusters in under 100 ms instead of 8 s, which
  the live path does after every block.

### Added
- CI measures test coverage on every run, runs CodeQL, opens the built site in
  a real browser and analyses the bundled example, and Dependabot keeps
  dependencies current. A unit test guards the whole-meeting error rate.

### Fixed
- Development tooling moved to vitest 5 and ESLint 10, clearing the two
  moderate advisories `npm audit` reported.

## [0.1.0-rc.1] — 2026-09-15

First version published for people to try. Not a production release.

### Added
- Two modes, both running entirely in the browser: listen to a live conversation, or
  analyse a recording. Nothing is recorded or uploaded.
- A mandatory head count before starting. Without it the speaker count grows with the
  length of the conversation (ADR 0004).
- Overlapping speech credited to whoever held the floor when the second voice came in
  (ADR 0006).
- A benchmark against three whole annotated AMI meetings (`npm run bench`) and stored
  embeddings for experiments in seconds (`npm run bench:offline`).
- The version shown in every page's footer.

### Changed
- With the head count known, the clustering cuts wider and places splinter groups back
  instead of merging two real people (ADR 0005).
- Names are optional labels; Ronda does not yet recognise who is who.

### Removed
- The original hand-built prototype and its "old version" page.

### Known limitations
- Over a whole meeting a quarter to a half of the speech is still misattributed or
  missed; over three minutes, about a tenth. Trust short sessions more than long ones.
- Voices in the same range are confused most; someone who mostly speaks over others is
  under-credited.
- Not yet tried on a phone at a real table by anyone other than the authors.

[0.1.0-rc.10]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.10
[0.1.0-rc.9]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.9
[0.1.0-rc.8]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.8
[0.1.0-rc.7]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.7
[0.1.0-rc.6]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.1
