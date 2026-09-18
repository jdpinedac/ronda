# Ronda

**See who holds the floor.** Ronda listens to a conversation and measures how much of
it each person speaks for. It never transcribes, and the audio never leaves the device.

> **Status: release candidate, not a production release.** Ronda is published at
> [jdpinedac.github.io/ronda](https://jdpinedac.github.io/ronda/) so people can try it
> at a real table and tell us what breaks. Both modes work end to end, the measurements
> below are real, and the numbers on screen should be read with the limitations further
> down in mind. Versions are tagged `vX.Y.Z-rc.N` until one earns a release; see
> [CHANGELOG.md](CHANGELOG.md).

## Why it does not record you

Most tools that analyse conversation upload your audio to a server. Ronda cannot,
because the audio does not survive long enough to upload.

Every couple of seconds of speech is converted into 256 numbers — an embedding that
captures *how* a voice sounds, not *what* it said — and the audio is discarded
immediately. The embeddings are enough to tell speakers apart and to tally their time,
and they cannot be turned back into speech. Nothing is written to disk, and nothing is
sent anywhere. The entire pipeline, models included, runs inside the browser tab.

This is a property of the architecture, not a promise in a privacy policy.

The one thing you can take out of a session, if you choose to, is a diagnostics file:
the embedding of each stretch of speech, when it was heard, how long it lasted and who
it was assigned to. No audio, no names. It exists so that when Ronda gets a table wrong,
the session can be reproduced exactly in the benchmark and the mistake fixed. Export it
from the live page after stopping, and analyse it with
`FILE=… npm run bench -- bench/field.report.ts`.

## How it tells people apart

Not by what they say — there is no speech recognition anywhere in Ronda.

Two neural models do the work, both running locally. The first,
[pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), finds
where speech is and where speaker changes happen, including up to three people talking
at once. The second,
[WeSpeaker ResNet34](https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM),
turns each stretch of speech into an embedding, trained so that the same person's
voice lands in the same place regardless of volume, mood, or language. Grouping those
embeddings gives you the speakers.

Before it starts, Ronda asks who is at the table: type the names and the head count
follows, or give the number alone. It will not start without a number. That number
matters more than any model parameter: without it the grouping step guesses, and the
guess gets worse the longer the conversation runs — a four-person meeting reached ten
"voices" after a quarter of an hour. See
[ADR 0004](docs/adr/0004-ask-for-the-number-of-people.md).

With names, the live page starts with a round of introductions: it says whose turn it
is, each person speaks alone for about ten seconds, and what is heard becomes their
voice profile. From then on every stretch of speech goes to the nearest profile and
stays there, so a name follows a voice and never changes hands. On the annotated
meetings this puts 96–100% of scorable speech under the right name; without it, names
went to the voice groups in the order they happened to form — the right name on 1–64%
of speech, and groups changing hands as the conversation was re-grouped
([ADR 0011](docs/adr/0011-ask-people-to-introduce-themselves.md)). Skip the round, and
the names are labels of groups, nothing more; the file page has no round and its names
are always labels.

## What it costs to run

Measured in Chrome on an 8-core desktop, int8 models, WASM backend:

| | |
|---|---|
| First visit download | ~11.7 MB compressed (3.4 MB runtime + 8.2 MB models), then cached |
| 34 s of audio, analysed end to end | under 10 s, single-threaded, models cached |
| Segmentation, 10 s window | 93 ms (multi-threaded; see the note below) |
| Embedding, 2 s segment | 67 ms (multi-threaded) |

Inference runs single-threaded. GitHub Pages cannot send the COOP/COEP headers that
multi-threaded WASM needs, and under the service-worker substitute ORT's threads hang
instead of starting. One thread is the only setting that works everywhere.

Full methodology and the separation-quality measurements are in
[ADR 0001](docs/adr/0001-neural-speaker-embeddings-in-the-browser.md).

## How accurate it is

Measured against the [AMI Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), three
minutes of a four-person meeting recorded on a single distant microphone — the hardest
case Ronda is built for — scored against human annotation of who spoke when:

| | |
|---|---|
| **Diarization error rate** | **0.111** |
| Speakers found | 4 of 4 |
| Time share | 33/31/21/15 against a true 32/32/19/16 |

People talking over each other are credited to whoever held the floor when the second
voice came in — an embedding of two mixed voices belongs to neither, but time says who
was already speaking, and measured against annotation that rule halves the error
([ADR 0006](docs/adr/0006-credit-overlap-to-the-floor-holder.md)). What remains is
mostly stretches too short to identify and speech the segmentation model does not
hear.

Whole meetings are harder. Measured over three complete AMI meetings, four people
each, with the head count given:

| Meeting | Length | Diarization error rate | Time share against the truth |
|---|---|---|---|
| ES2004a | 17.5 min | **0.244** | 45/25/18/12 against 42/29/18/11 |
| IS1009a | 13.4 min | 0.280 | 57/20/17/6 against 62/20/9/9 |
| TS3003a | 24.6 min | 0.479 | 59/14/14/14 against 70/13/11/5 |

A quarter to a half of the speech is attributed wrongly or not at all over a long
meeting, against a tenth over three minutes. Until [ADR 0005](docs/adr/0005-place-splinters-back-when-the-head-count-is-known.md)
it was worse: cutting at exactly the head count merged two real people on every one of
these meetings. Nobody is merged now, but the three-minute figure above is the best
case, not the typical one. Where the remaining error comes from, and what was tried
against it, is in ADRs 0005 and 0006. All numbers come from `npm run bench`, which runs the real
pipeline against these recordings; `npm run bench:offline` repeats the clustering on
stored embeddings in seconds. Fetch the recordings with `spike/08-fetch-ami.py` and
`spike/10-fetch-ami-meeting.py`.

## Limitations, stated plainly

- Voices in the same range are the most common confusion, and the effect is large. On
  a two-woman conversation from the AMI corpus, Ronda got the time split nearly right —
  62/38 against a true 60/40 — while misattributing 40% of the moment-to-moment speech
  between them. The totals can be trustworthy while who-said-what is not.
- If a television, radio or nearby table is audible, tick the box that says so. Ronda
  then leaves room for those voices instead of crediting them to someone at the table.
  Leave it unticked otherwise: measured against annotated recordings, turning it on
  when there are no intruders makes results worse (a two-woman split went from 62/38 to
  72/28, and meeting error rose from 0.199 to 0.219). Nothing in the audio distinguishes
  the two situations reliably, so the person in the room is asked rather than guessed at.
- Speech from outside the conversation — the next table, a television — is handled only
  when you tick the box that says it is there: quiet speech is then rejected by loudness,
  and louder intruders get their own group and are discarded. Neither is perfect. With
  the box ticked, a soft-spoken person at the table can be mistaken for background, and
  someone who barely speaks can be discarded as a non-participant. With it unticked,
  nothing is dropped, and a nearby voice is credited to whoever it most resembles
  ([ADR 0007](docs/adr/0007-drop-distant-speech-only-when-told-about-intruders.md)).
- A single microphone at a large table is the hardest case. Expect approximation, not
  accounting.
- Accuracy falls with length. Over three minutes of a four-person meeting a tenth of the
  speech is misattributed or missed; over a whole meeting it is a quarter or more. Trust
  short sessions more than long ones.
- When people talk over each other, the time goes to whoever already had the floor.
  Someone who mostly speaks over others is under-credited.
- When several people talk over each other for a long stretch, Ronda knows it is
  happening but cannot say who else joined in.
- The introductions fix the names, not the shares. Overlapping and uncertain speech,
  a tenth to a sixth of a real meeting, still belongs to nobody, and the share error of
  the long meetings stands.
- Someone who joins after the round has no profile until you press *Someone joined*
  and they introduce themselves; until then their speech goes to whoever they sound
  most like. Ronda does not add people on its own: measured on the annotated meetings,
  noticing a new voice automatically works in 0–3 cases of 4, minutes late, with 1–8
  false alarms an hour ([ADR 0012](docs/adr/0012-someone-joins-and-the-session-keeps-a-log.md)).
- It measures speaking time. It does not measure who contributed, who was listening,
  or who was right.

## When the voices arrive muddled

Ronda measures how tightly each person's voice samples cluster. On the annotated
recordings that spread sits between 0.19 and 0.55; when it goes above 0.6 the shares
still add up but who is speaking at each moment becomes unreliable, and the live page
says so. Distance to the phone, echo from windows, street noise and the phone's own
audio processing all raise it. Moving the phone closer to the people, and away from
noise and glass, is the one lever that reliably lowers it. The "who is speaking" badge
is labelled *a moment ago* because that is what it is: a verdict about audio a few
seconds old (ADR 0008).

## Language and theme

The interface is in Spanish and English, light and dark. It follows the browser's
language and the system's colour scheme unless you choose otherwise in the footer of
any page; the choice is remembered by the browser, and it is the only thing Ronda
stores.

## Please tell the table

Ronda analyses the voices of everyone present. Even though nothing is recorded, being
measured without knowing is not a nice thing to have happen to you. Say it is running.

It is built for a group to look at together — to notice that one person has held the
floor for two thirds of a meeting, and to decide as a group what to do about that. It
is not built for assessing individuals, and it would be bad at it.

## Development

    npm install
    npm run dev      # http://localhost:5173
    npm test
    npm run coverage   # same tests, with a per-file coverage table
    npm run test:e2e   # the built site in a real browser; needs npm run build first
    npm run lint
    npm run build
    npm run bench          # real pipeline against real recordings; see bench/
    npm run bench:offline  # clustering experiments on stored embeddings, seconds

Requires Node 22+. The model weights are downloaded into `public/models/` by
`scripts/fetch-models.mjs`, which runs automatically before `dev` and `build` and checks
each file against its published SHA-256; they are not committed. The `onnxruntime-web`
WASM runtime is bundled by Vite from the `onnxruntime-web/wasm` subpath, so nothing else
needs copying.

Cross-origin isolation is needed for multi-threaded WASM. The dev server sets the
headers itself; GitHub Pages cannot, so production restores it with
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker).

Architecture decisions live in [`docs/adr/`](docs/adr/), the design spec in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the throwaway feasibility
probe in [`spike/`](spike/). The original hand-built prototype that ADR 0001 measured
against was removed once the neural pipeline replaced it; it is in the history before
`v0.1.0-rc.1`.

### Releases

Every push to `main` deploys to GitHub Pages. A release candidate is a tag `vX.Y.Z-rc.N`
on `main` with a matching entry in [CHANGELOG.md](CHANGELOG.md) and a GitHub
pre-release; the version in `package.json` is what the pages show in their footer, so
bump it in the same commit as the changelog. A version drops the `-rc` suffix when a
candidate has been used at real tables without a reported failure.

## Credits

The bundled example recording in `public/example/` is 90 seconds of meeting ES2004a
from the [AMI Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), recorded on a single
distant microphone, used under CC-BY-4.0.

## Authors

- **Juan Pineda** ([@jdpinedac](https://github.com/jdpinedac)) — design and code.
- **Ana Lopez** ([@amarlo](https://github.com/amarlo)) — field testing: puts Ronda on real
  tables and reports what breaks, which is where every fix so far has started.

## License

MIT. See [LICENSE](LICENSE).

Models are downloaded from Hugging Face and carry their own licenses: pyannote
segmentation-3.0 is MIT, WeSpeaker VoxCeleb ResNet34 is Apache-2.0.
