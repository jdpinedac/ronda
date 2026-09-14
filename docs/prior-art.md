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
