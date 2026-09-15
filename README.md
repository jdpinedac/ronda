# Ronda

**See who holds the floor.** Ronda listens to a conversation and measures how much of
it each person speaks for. It never transcribes, and the audio never leaves the device.

> Status: early construction. The feasibility work is done and documented in
> [ADR 0001](docs/adr/0001-neural-speaker-embeddings-in-the-browser.md); the interface
> is not built yet. A working prototype of the original idea lives in
> [`example/ronda.html`](example/ronda.html) — open it in a browser to see where this
> came from.

## Why it does not record you

Most tools that analyse conversation upload your audio to a server. Ronda cannot,
because the audio does not survive long enough to upload.

Every couple of seconds of speech is converted into 256 numbers — an embedding that
captures *how* a voice sounds, not *what* it said — and the audio is discarded
immediately. The embeddings are enough to tell speakers apart and to tally their time,
and they cannot be turned back into speech. Nothing is written to disk, and nothing is
sent anywhere. The entire pipeline, models included, runs inside the browser tab.

This is a property of the architecture, not a promise in a privacy policy.

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

Before it starts, Ronda asks how many people are at the table, and it will not start
without an answer. That number matters more than any model parameter: without it the
grouping step guesses, and the guess gets worse the longer the conversation runs — a
four-person meeting reached ten "voices" after a quarter of an hour. See
[ADR 0004](docs/adr/0004-ask-for-the-number-of-people.md). Names can be typed too,
but they are labels for the list only; Ronda does not yet recognise who is who.

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
| **Diarization error rate** | **0.199** |
| Speakers found | 4 of 4 |
| Time share | 35/31/21/13 against a true 32/32/19/16 |
| Speech attributed to the wrong person | 3.2 s of 170 s (1.9%) |
| Speech not attributed at all | 27.7 s |

Most of the error is not confusion but omission, and most of that omission is
deliberate: 20.6 s of it is people talking over each other, which Ronda detects but
does not attribute, because an embedding taken from two mixed voices belongs to
neither. Another 5.9 s is stretches too short to identify reliably.

So on that excerpt the time each person is credited with is close to right, and what
Ronda misses, it mostly misses on purpose.

The whole meeting is a different story. Over all 17.5 minutes, with the head count
given:

| | |
|---|---|
| **Diarization error rate** | **0.395** |
| Time share | 47/28/22/4 against a true 42/29/18/11 |

Two of the four people end up merged into one group, and one person nearly
disappears. Long conversations on a single distant microphone are the open problem;
the three-minute figure above is the best case, not the typical one. Both numbers come
from `npm run bench`, which runs the real pipeline against these recordings, and
`npm run bench:offline` repeats the clustering on stored embeddings in seconds. Fetch
the recordings with `spike/08-fetch-ami.py`.

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
- Speech from outside the conversation — the next table, a television — is handled two
  ways: rejected by loudness when it is distant, and given its own group and discarded
  when it is close enough to be loud. Neither is perfect. A soft-spoken person at the
  table can be mistaken for background, and someone who barely speaks can be discarded
  as a non-participant.
- A single microphone at a large table is the hardest case. Expect approximation, not
  accounting.
- Accuracy falls with length. Measured on a four-person meeting, three minutes come out
  nearly right and the full seventeen merge two people. Until that is fixed, trust
  short sessions more than long ones.
- When several people talk over each other for a long stretch, Ronda knows it is
  happening but cannot reliably say who is who.
- It measures speaking time. It does not measure who contributed, who was listening,
  or who was right.

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
    npm run lint
    npm run build
    npm run bench          # real pipeline against real recordings; see bench/
    npm run bench:offline  # clustering experiments on stored embeddings, seconds

Requires Node 22+. The `onnxruntime-web` WASM binaries are copied into `public/ort/`
by `scripts/sync-ort-wasm.mjs`, which runs automatically before `dev` and `build`;
they are not committed.

Cross-origin isolation is needed for multi-threaded WASM. The dev server sets the
headers itself; GitHub Pages cannot, so production restores it with
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker).

Architecture decisions live in [`docs/adr/`](docs/adr/), the design spec in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the throwaway feasibility
probe in [`spike/`](spike/).

## Credits

The bundled example recording in `public/example/` is 90 seconds of meeting ES2004a
from the [AMI Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), recorded on a single
distant microphone, used under CC-BY-4.0.

## Authors

Ana Lopez and Juan Pineda.

## License

MIT. See [LICENSE](LICENSE).

Models are downloaded from Hugging Face and carry their own licenses: pyannote
segmentation-3.0 is MIT, WeSpeaker VoxCeleb ResNet34 is Apache-2.0.
