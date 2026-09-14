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

Optionally, each person can introduce themselves for a few seconds beforehand. This is
worth doing: it attaches real names, and more importantly it tells Ronda how many
people are in the room, which turns out to matter more than any model parameter.

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
| **Diarization error rate** | **0.219** |
| Speakers found | 4 of 4 |
| Time share | 35/31/21/13 against a true 32/32/19/16 |
| Speech attributed to the wrong person | 3.2 s of 170 s (1.9%) |
| Speech not attributed at all | 27.7 s |

That 0.219 is up from 0.199, and deliberately so. Ronda now clusters with room for
voices that are not participants and keeps only the busiest groups, which occasionally
discards real speech — the two points of DER. It buys a much worse failure being fixed:
cutting at exactly the number of people present forces a television into somebody's
tally, and to free the slot it merges two real people into one. On a recording with
chatter under a four-person meeting, the split went from 31/31/20/18 to 35/23/22/20
against a true 34/23/22/21.

Most of the remaining error is not confusion but omission, and most of that omission is
deliberate: 20.6 s of it is people talking over each other, which Ronda detects but
does not attribute, because an embedding taken from two mixed voices belongs to
neither. Another 5.9 s is stretches too short to identify reliably.

So the time each person is credited with is close to right, and what Ronda misses, it
mostly misses on purpose. Reproduce with `spike/08-fetch-ami.py` and
`src/metrics/der.ts`.

## Limitations, stated plainly

- Voices in the same range — siblings, similar timbres — are the most common confusion.
- Speech from outside the conversation — the next table, a television — is handled two
  ways: rejected by loudness when it is distant, and given its own group and discarded
  when it is close enough to be loud. Neither is perfect. A soft-spoken person at the
  table can be mistaken for background, and someone who barely speaks can be discarded
  as a non-participant.
- A single microphone at a large table is the hardest case. Expect approximation, not
  accounting.
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
