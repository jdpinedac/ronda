# Prior art

Date: 2026-09-14

A survey of what already exists, prompted by the obvious question: is someone giving
this away for free already? The short answer is that both halves of Ronda exist
separately — the technique as a library, the intention as a manual tally — and nothing
found puts them together.

## Apps that count who talks

A cluster of these appeared between 2015 and 2017 and most of them are now abandoned.

| | What it does | Why it is not this |
|---|---|---|
| [GenderTimer](https://www.bustle.com/articles/81824-gendertimer-app-tracks-how-often-men-and-women-speak-in-the-workplace-and-its-scarily-illuminating) | iOS/Android/web | You press a button. Manual, and by gender |
| [GA Tally](https://medium.com/@GenderAvenger/you-can-time-whos-talking-more-men-or-women-with-the-updated-ga-tally-app-6f11815a9fd0) | Counts panel speakers | Manual, by gender |
| [progressive-timekeeper](https://github.com/yourcelf/progressive-timekeeper) | Open source, tallies by identity category | Manual. Closest in intention, furthest in method |
| [GenderEQ](https://www.fastcompany.com/3068794/this-app-uses-ai-to-track-mansplaining-during-your-meetings) | Listens, classifies male/female airtime live | Classifies by pitch, not by person |
| [Time To Talk](https://www.lookwhostalking.se/) | Same, iOS, claimed no recording | By gender. Domain is now a solar-panel blog |
| [Woman Interrupted](https://www.adweek.com/agencies/this-agency-dropped-an-app-on-international-womens-day-that-detects-when-men-interrupt-women/) | Counted male interruptions of women | Agency campaign, 2017, dormant |
| [Talk-o-Meter](https://www.good.is/articles/the-talk-o-meter-measure-the-give-and-take-in-your-conversations) | Phone on the table, per person | Two people only, dissimilar voices, quiet room. A decade old |

Classifying by pitch is not a shortcut to classifying by person: it fails
systematically on low-voiced women and high-voiced men, and it cannot tell two women
apart at all — which is the case Ronda finds hardest and reports honestly.

For video calls there is live commercial tooling — [Equal Time](https://equaltime.io/2024/04/21/how-to-use-equal-time-to-track-speaking-time-by-gender-in-meetings/)
for Zoom and Meet, and a [speaking-time tracker](https://marketplace.zoom.us/apps/eiC_JnA4Qee2b42zT6sTKw)
in the Zoom marketplace. These rely on the platform already supplying one audio stream
per participant, which is the easy version of the problem. None of them addresses a
table with a single microphone.

## Libraries that do the technique

The pipeline is not novel and is not the moat.

- [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — the closest technical
  relative: speaker diarization compiled to WASM, same skeleton as Ronda (pyannote
  segmentation plus embeddings, ONNX). It is a library; its browser demos process an
  uploaded file. **Worth benchmarking against our single-threaded numbers.**
- [thiswillbeyourgithub/parakeet_web](https://github.com/thiswillbeyourgithub/parakeet_web) —
  builds on sherpa-onnx's WASM engine, fully local, but it is transcription with
  speaker labels.
- [beekmarks/whisper-real-time-speaker-diarization](https://github.com/beekmarks/whisper-real-time-speaker-diarization) —
  plain HTML/JS, Transformers.js, pyannote-segmentation-3.0 ONNX. An example, not a tool.
- [meetily](https://github.com/Zackriya-Solutions/meetily), [whisperX](https://github.com/m-bain/whisperx),
  diart, NeMo — all diarize well, all are meeting assistants that transcribe and summarize.

## What is not taken

No one found combines: per person rather than per gender; automatic rather than tapped;
one microphone at one table rather than one stream per caller; in a browser tab with
nothing installed; audio discarded within seconds; no speech recognition anywhere; and
an error rate published alongside the limitations.

The gap is the crossing, not any one of the pieces.

## Low-latency and overlap-aware diarization

Date: 2026-09-16. Prompted by two field observations — the "who is speaking now"
indicator lags and flips — and by the measurement in ADR 0005 that three embedding
models share the same accuracy floor, so a better embedding is not the lever. A bounded
survey of what would be; primary sources linked, figures as stated by them.

| Approach | Year | Size | Licence | ONNX | Latency | DER | Fit for a browser |
|---|---|---|---|---|---|---|---|
| [Diart](https://github.com/juanmc2005/diart) — pyannote segmentation + embeddings, incremental centroid clustering ([paper](https://arxiv.org/abs/2109.06483)) | 2021, maintained | the two models Ronda ships | MIT | yes | 0.5–5 s, tunable | AMI 27.5% at 5 s, 30.4% at 1 s | **High**: same models, only the clustering and buffering differ |
| [pyannote community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) | 2025 | not stated | CC-BY-4.0, gated | not stated | offline | AMI 17.0% | Medium: offline, but adds an "exclusive" one-speaker-at-a-time stream |
| [Streaming Sortformer](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1) | 2025 | 117 M params | NVIDIA Open Model | no, export broken | ~1 s | AMI 16.7% | **Low**: size, four speakers max, no export |
| [LS-EEND](https://arxiv.org/abs/2410.06670) — frame-in frame-out online EEND | 2024–25 | not stated | not stated | no | 1.07 s; CPU RTF 0.028 | AMI 20.8% | Medium: promising numbers, nothing exportable yet |
| [DiaPer](https://arxiv.org/abs/2312.04324) | 2023–24 | 4.6 M params | paper CC-BY-SA | no | offline | AMI array 37.5% | Medium: tiny but offline and worse than today |
| TS-VAD family ([PET-TSVAD](https://arxiv.org/abs/2309.12521), Seq2Seq-TSVAD) | 2022–23 | 12 M (PET) | not stated | no | offline | not stated | Low: no public weights found |
| [sherpa-onnx WASM](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html) | 2024–25 | 8 + 28 MB | Apache-2.0 | yes | offline | not stated | Runs in a browser already, offline only |

No project was found doing streaming diarization client-side; the browser examples are
offline or segmentation-only.

**What follows for Ronda.** The reusable idea is Diart's, and it needs no new model:
slide the segmentation window often, match each local speaker to a global centroid,
update a centroid only after enough new speech from that speaker, create one only
past a distance, and weight embedding frames by how exclusively one speaker holds
them. The first half of that is what the fast path in `live.ts` now does for the
indicator; the frame weighting is the candidate for crediting overlap to both voices
rather than to the floor holder (ADR 0006). LS-EEND is the one end-to-end model worth
a spike if its checkpoint can be exported; Sortformer and TS-VAD are not, for now.

Not verified: Diart's DER below 1 s of latency, LS-EEND's parameter count and licence,
model file sizes for pyannote community-1.
