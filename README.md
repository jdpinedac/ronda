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

## Limitations, stated plainly

- Voices in the same range — siblings, similar timbres — are the most common confusion.
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

## Authors

Ana Lopez and Juan Pineda.

## License

MIT. See [LICENSE](LICENSE).

Models are downloaded from Hugging Face and carry their own licenses: pyannote
segmentation-3.0 is MIT, WeSpeaker VoxCeleb ResNet34 is Apache-2.0.
