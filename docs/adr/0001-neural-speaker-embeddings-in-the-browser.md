# 1. Neural speaker embeddings in the browser

Date: 2026-09-13

## Status

Accepted

## Context

Ronda measures how much of a conversation each person holds the floor for. It needs
to tell speakers apart, but deliberately does not transcribe: the content of the
speech is irrelevant to the measurement and would be a privacy liability.

The existing prototype (`example/ronda.html`) clusters a seven-dimensional hand-built
feature vector — autocorrelation pitch, spectral centroid, and five band energies.
These features correlate with speaker identity, but they also correlate with loudness,
distance from the microphone, and emotional state, so the same person splits across
rows and different people merge.

The question was whether a proper neural diarization pipeline could run entirely
client-side, and at what cost in download size and CPU.

## Decision

Use `pyannote/segmentation-3.0` for speech segmentation and
`wespeaker-voxceleb-resnet34-LM` for 256-dimensional speaker embeddings, both as ONNX
models executed in the browser through ONNX Runtime Web via transformers.js. Cluster
the embeddings with average-linkage agglomerative clustering on cosine distance.

Default to int8 quantization; offer fp32 behind a "high accuracy" setting.

**Prefer a known speaker count over a distance threshold.** When the number of
participants is known — the user typed their names, or they calibrated their voices —
cut the dendrogram at exactly K clusters instead of thresholding.

## Consequences

A Phase 0 spike (`spike/`) measured the following on real multi-speaker recordings.

**Separation quality** on a clip with two known speakers:

| | fp32 | int8 |
|---|---|---|
| Same-speaker cosine similarity | 0.66 – 0.77 | 0.64 – 0.73 |
| Different-speaker cosine similarity | 0.01 – 0.14 | 0.02 – 0.17 |
| Separation gap | **0.52** | **0.47** |

The gap is an order of magnitude wider than the noise, and int8 costs only about 10%
of it. This is a qualitatively different regime from the prototype's hand-built
features.

**Cross-lingual transfer holds.** The embedding model is trained mostly on English
VoxCeleb, yet it recovered exactly four speakers from a 57-second Chinese recording.
This is the evidence that it will work for Spanish.

**Threshold-based clustering is the weak link, not the models.** Sweeping the distance
threshold, the correct speaker count appears at 0.7–0.8 — but the window is narrow and
moves with quantization: under int8 the two-speaker clip yielded three speakers at
every threshold tested. With K supplied, every clip clustered correctly under int8,
including a perfect `S1 S1 S2 S2` match against ground truth.

This is why calibration earns its place in the design. It is not merely a convenience
for attaching real names; it supplies K, which is the single most valuable piece of
information in the pipeline. The prototype's existing "who is at the table" name field
already collects it.

**Cost is not a constraint.** Measured in Chrome, WASM backend, int8:

| | |
|---|---|
| Model download | 8.2 MB (1.54 + 6.69), cached after first visit |
| Segmentation, 10 s window | 93 ms |
| Embedding, 2 s segment | 67 ms |
| **Live budget per 5 s hop** | **160 ms = 3.2% of one core** |

A mid-range phone an order of magnitude slower still lands around 32%, so real-time
operation is comfortable. The earlier concern that neural diarization would be too
heavy for the browser is simply wrong at these model sizes.

**Accepted limitations.** Turn boundaries are fixed by the live pass and cannot be
recomputed on stop, because audio is discarded immediately after embedding extraction.
Segments shorter than about 0.8 s produce unreliable embeddings and are dropped.
Sustained simultaneous speech is detected as overlap but not attributed.
