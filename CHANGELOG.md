# Changelog

All notable changes to Ronda. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). Until a release candidate
has survived real tables, versions carry an `-rc.N` suffix.

## [Unreleased]

### Changed
- Clustering computes pairwise distances once and updates them on each merge
  (Lance–Williams, average linkage). Same labels, verified on every stored
  embedding set; a whole meeting clusters in under 100 ms instead of 8 s, which
  the live path does after every block.

### Added
- CI measures test coverage on every run, runs CodeQL, and Dependabot keeps
  dependencies current. A unit test guards the whole-meeting error rate.

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

[0.1.0-rc.1]: https://github.com/jdpinedac/ronda/releases/tag/v0.1.0-rc.1
