# Ronda — Browser-Side Speaker Diarization

**Date:** 2026-09-13
**Status:** Approved, pending Phase 0 feasibility spike

## Problem

Measure how much of a conversation each person holds the floor for.

The content of the speech is irrelevant — there is no transcription, and adding one
would be a privacy liability with no benefit. What is required is *diarization*:
partitioning an audio stream by speaker identity. "Who spoke when", not "what was said".

A working prototype exists at `example/ronda.html`: a single 793-line file doing
`getUserMedia` capture, RMS-based voice activity detection, autocorrelation pitch
estimation, spectral centroid plus five band energies, and online nearest-centroid
clustering. It establishes the product's identity — warm palette, SVG dial, Spanish
copy, an explicit privacy promise — and it proves the interaction works.

Its ceiling is the feature set. Pitch and spectral brightness correlate with speaker
identity, but they also correlate with loudness, distance from the microphone, and
emotional state. In a real conversation around a table, one person splits across
several rows and two people merge into one.

## Goals

1. Distinguish 2–6 speakers reliably enough that the time split is trustworthy.
2. Run entirely in the browser. No audio leaves the device, ever.
3. Ship as a static site on GitHub Pages under the MIT license.
4. Stay maintainable by two people.

## Non-Goals

- Transcription, or any use of lexical content.
- Speaker identification against a global database.
- Server-side processing of any kind.
- Real-time performance beyond what a mid-range phone can sustain.

## Approach

Replace the hand-crafted feature vector with a learned speaker embedding, and keep
everything else about the prototype that already works.

A speaker embedding model compresses roughly two seconds of speech into 256 numbers,
trained so that the same person lands close together and different people land far
apart — invariant to what is said, to loudness, and to language. Comparison is cosine
distance. This is the representation pyannote, WhisperX, and comparable tools use.

### Pipeline

```
Main thread ─────────── UI, SVG dial, speaker list, ~10 fps render
    │ postMessage
AudioWorklet ────────── 16 kHz mono capture, energy VAD, silence trimming
    │ voiced frames (Float32Array)
Inference Worker ────── ONNX Runtime Web
    │                   ├─ pyannote-segmentation-3.0  (10 s window, 5 s hop)
    │                   └─ wespeaker-voxceleb-resnet34-LM → vector[256]
    │ {startMs, endMs, embedding}   ← audio is released here
Clustering engine ───── online while live · global agglomerative on stop
```

### Models

Sizes verified against the Hugging Face API on 2026-09-13:

| Model | fp32 | fp16 | int8 |
|---|---|---|---|
| `onnx-community/pyannote-segmentation-3.0` | 5.99 MB | 3.00 MB | 1.54 MB |
| `onnx-community/wespeaker-voxceleb-resnet34-LM` | 26.5 MB | 13.3 MB | 6.69 MB |

int8 by default (~8.2 MB total); fp32 behind a "high accuracy" setting. Weights are
served from the repository itself rather than a third-party CDN, and cached with the
Cache API so that the application works offline after the first visit.

### Execution backend

Probe in order: **WebGPU** → **multi-threaded WASM SIMD** → **single-threaded WASM**.

GitHub Pages cannot set `COOP`/`COEP` headers, so without mitigation there is no
`SharedArrayBuffer` and WASM falls back to a single thread. `coi-serviceworker` is
included from the start to recover multi-threading. WebGPU needs no such headers.

### Audio capture

- `new AudioContext({ sampleRate: 16000 })` — the browser resamples; no DSP needed.
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false,
  autoGainControl: false } })`.

  The prototype sets all three to `true`, which actively harms diarization: noise
  suppression and automatic gain control reshape timbre, which is precisely the signal
  the model depends on. Echo cancellation is kept because it removes the device's own
  output, which is never a speaker we want to count.
- `AudioWorkletNode`, replacing the deprecated `ScriptProcessorNode` the prototype
  runs on the main thread.

### Speaker assignment

**With calibration** (preferred path). Each participant speaks for about eight seconds;
four or five embeddings are averaged into a named profile. During the session each
segment is compared by cosine similarity against the profiles. Below an acceptance
threshold the segment is marked as a new voice and given an automatic profile, so a
visitor who was not calibrated still gets counted.

**Without calibration.** Incremental online clustering with an adaptive threshold — the
same idea as `commitSegment` in the prototype, but over 256 learned dimensions instead
of seven hand-chosen ones. Temporal smoothing is retained (turns last seconds, not
milliseconds), as is manual renaming and merging of rows, which already works well.

**On stop.** Average-linkage agglomerative clustering over every embedding from the
session, then label reassignment. This corrects the most common live-mode error: one
person split in two because their first samples were noisy.

### Memory: embeddings only

Audio is discarded immediately after its embedding is extracted. Only
`{startMs, endMs, embedding}` is retained.

One hour of 16 kHz mono audio is roughly 115 MB in memory. One hour of embeddings, at
one per ~1.5 s of speech, is roughly 2 MB. Beyond the obvious memory win, this makes
the privacy claim structural rather than procedural: there is no recording to leak,
because none exists two seconds after the words are spoken.

The cost is that turn *boundaries* are fixed by the live pass and cannot be recomputed
on stop. Only the *labels* are revised. This is an accepted trade-off.

### Turn and interruption metrics

Derived from the labelled segment sequence; no source separation involved.

- **Turn** — contiguous stretches from the same speaker separated by less than ~1.5 s.
- **Interruption** — A begins while B is speaking, and within ~3 s B stops while A
  continues. Distinguished from **cooperative overlap**, where both continue or the
  incoming speaker yields.

`pyannote-segmentation-3.0` emits powerset output covering up to three simultaneous
speakers, so overlap detection comes from the model rather than a heuristic.

## Testing

Pure logic — cosine distance, linkage, threshold selection, turn segmentation,
interruption detection, export — is unit tested with synthetic fixtures under Vitest.

The pipeline as a whole is measured by diarization error rate against a labelled
reference recording. This is the only test that says whether the thing works. A
synthetic two-tone fixture cannot validate a model trained on human speech.

Acceptance is calibrated on the team's own recordings rather than published numbers:
five minutes of real conversation at a table, with and without calibration, compared
against a hand-held stopwatch.

## Risks

- **Similar voices** — same vocal range, or family members — are the most common failure.
- **Distant microphone** at a large table degrades quality substantially. Published DER
  for single distant-source meeting audio sits in the 10–20% range.
- **Sustained simultaneous speech** is handled poorly. The model detects that overlap is
  occurring; attributing it correctly is a harder problem.
- **Ethics.** Nothing is recorded, but the voices of present people are still being
  analysed. The README must ask that the table be told, and must frame the tool as an
  instrument for collective reflection rather than individual assessment.
- **Biometrics.** Persisted voice profiles (v1.1) are biometric data even when they
  never leave the browser. Explicit opt-in, with a visible delete control.

## Scope

**v1.0** — live microphone, optional calibration, time-share dial, turns and
interruptions, JSON/CSV export, ES/EN interface, deployed to Pages.

**Deferred to v1.1** — session history in IndexedDB, voice profiles persisted across
sessions, and analysis of uploaded audio files. The storage interface is designed with
these in mind; the implementations are not built yet.
