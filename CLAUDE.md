# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Ronda is

Speaker diarization that runs entirely in the browser tab: it measures how much of a
conversation each person speaks for. It never transcribes and never keeps audio. Two ONNX
models (pyannote segmentation-3.0, WeSpeaker ResNet34 embeddings) run on onnxruntime-web,
WASM backend, single-threaded on purpose. Published to GitHub Pages at `/ronda/`; versions
are `vX.Y.Z-rc.N` until one survives real tables. README.md carries the measured numbers
and the stated limitations; keep them in sync when the pipeline changes.

## Commands

    npm run dev              # fetch models (cached, checksummed) then Vite on :5173
    npm test                 # vitest, test/**/*.test.ts, fake models, no browser
    npx vitest run test/overlap.test.ts          # one test file
    npx vitest run -t "pause"                    # tests matching a name
    npm run coverage         # same tests with per-file coverage (CI runs this)
    npm run lint             # eslint . && tsc --noEmit
    npm run build            # fetch models, tsc, vite build -> dist/
    npm run test:e2e         # Playwright against dist/ served like Pages; run build first, ~1 min
    npm run bench            # real pipeline on real recordings in Node; minutes
    npm run bench:offline    # clustering only, on 227 stored embeddings; seconds
    npm run bench -- bench/field.report.ts       # one report (needs FILE=… for this one)

Node 22+. CI runs lint, coverage, build, e2e, and `npm audit --omit=dev --audit-level=high`.
Every push to `main` deploys to Pages, so `main` must always be releasable.

## Architecture

**Three pages, one engine.** `index.html`/`src/main.ts` (capability check and links),
`analyze.html`/`src/analyze.ts` (a file), `live.html`/`src/live.ts` (the microphone). Page
scripts only translate, wire DOM, and call the engine. Shared UI: `src/ui/i18n.ts`
(es/en, every user-visible string goes here), `src/ui/prefs.ts` (locale and theme, the
only thing stored in the browser).

**The engine (`src/engine/`) is one pipeline taken two ways.** `diarize.ts` runs it over a
whole file; `live.ts` runs it over audio arriving a second at a time and re-clusters all
embeddings from scratch after every window. Both use identical constants (10 s window,
5 s hop, trust regions from `windows.ts`, 800 ms minimum span) and the identical sequence
of clustering steps. This is deliberate: the benchmark measures the file path, and the
live path is only trustworthy if it matches. `test/live-matches-file.test.ts` guards that
equivalence. If you change a stage in one, change it in the other.

The stages, in order: segmentation per window (`segmentation.ts` decodes logits into
spans with 0, 1 or 2+ speakers) → single-speaker spans of 800 ms or more →
optional loudness filter for intruders (`levels.ts`, only when the user ticked
"background voices") → fbank features (`fbank.ts`) → embedding → L2-normalise →
agglomerative clustering, then the head-count-aware steps in `clustering.ts`
(`centreEmbeddings`, `keepBusiest`, `placeSplinters`, `absorbTinyClusters`,
`carryIdentities` for stable live ids) → overlap credited to the floor holder
(`creditOverlap`) → shares and a `Reliability` verdict.

**`models.ts` is the only module that touches ONNX Runtime**, and it is the seam that
everything else swaps out:

- Tests: `vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'))`.
  Speakers are tones (A = 200 Hz, B = 2 kHz); `conversation([['A', 4], ['-', 1], …])`
  builds audio. The fake segmenter deliberately calls the first and last second of every
  window silence, so a path that skips the trust regions fails.
- Bench: the same mock pointing at `bench/node-models.ts`, which runs the real weights
  under the ORT node build and records every embedding produced.

ORT is imported lazily from the `onnxruntime-web/wasm` subpath (the default entry pulls in
a 28 MB WebGPU binary). Model weights are fetched into `public/models/` by
`scripts/fetch-models.mjs` with SHA-256 verification; they are not committed.

**Why the head count is an input, not an output.** Without it the cluster count grows
with the length of the conversation (ADR 0004). Everything in `clustering.ts` past
`agglomerative` exists to use that number well. `CLUSTER_HEADROOM` and `OTHER_VOICE` are
the mechanism for discarding intruder voices, and they are off unless the user says
intruders exist (ADR 0007), because turning them on for clean tables measurably hurts.

## Measurement is part of the definition of done

Every accuracy claim in README and the ADRs comes from `bench/*.report.ts`. Reports print;
they do not assert. `bench/offline.report.ts` is where a clustering change is tried
first, because it runs in seconds on `bench/fixtures/ami-ES2004a-embeddings.json`.
`test/long-meeting-der.test.ts` pins the DER on that same fixture (≤ 0.32) so a
regression fails `npm test`, not just the bench.

Recordings for the full bench live in `public/testdata/` (gitignored); fetch them with
`spike/08-fetch-ami.py` and `spike/10-fetch-ami-meeting.py`. Useful bench knobs:
`REC=<substring>` filters recordings, `BENCH_DUMP=1|only` writes embeddings to
`bench/out/`, `BENCH_ONLY_COUNT=1`, `BENCH_BG=1`, `BG_RATIO=<n>`, `EMB_MODEL=int8|fp32|campplus`.

Field diagnostics exported from the live page (embeddings and timings of real people, no
audio) go in `diagnostics/`, which is gitignored and must stay that way. Analyse one with
`FILE=diagnostics/<file>.json npm run bench -- bench/field.report.ts`.

## Decisions and history

`docs/adr/` holds numbered Nygard-style ADRs (Context / Decision / Consequences, with the
measurements that motivated them). A pipeline change that alters the numbers in README
gets an ADR, and the README figures are updated in the same change. Things that were tried
and not adopted are recorded too (ADRs 0005, 0006, 0009); ADR 0003 sums up what field testing changed. `docs/superpowers/specs/` has the original
design spec. `spike/` is the throwaway feasibility probe kept only so ADR 0001 is
reproducible; it is excluded from lint and CodeQL and is not application code.

## Releases

A release candidate is a tag `vX.Y.Z-rc.N` on `main` with a matching CHANGELOG.md entry
(Keep a Changelog) and the version bumped in `package.json` in the same commit; the
footer of every page shows that version via `__RONDA_VERSION__`. Commits use conventional
commits (`feat(live):`, `fix(ui):`, `chore(release):`, `docs:`).

## Conventions worth knowing

- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`;
  index into arrays with `!` only where a bound was just checked.
- Imports use `.js` extensions (`./clustering.js`) even for `.ts` sources.
- No audio is ever retained past the window that needs it, in either path. Preserve that
  when adding features; it is the privacy claim.
- DOM output for user-provided text (names) is built from text nodes, never innerHTML
  (see the e2e smoke test, which feeds `<b>Ana</b>` as a name).
- The interface is bilingual. A new string means a new key in `i18n.ts` in both languages.
