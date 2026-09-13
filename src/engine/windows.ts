/**
 * Sliding-window plan for segmentation.
 *
 * pyannote/segmentation-3.0 is trained on 10-second chunks, so long audio is
 * analysed in overlapping windows. Overlap creates a problem: the same moment
 * is covered by two windows, which may disagree.
 *
 * Rather than reconcile disagreements, each window is trusted only where it has
 * the most context — the middle. The first window is also trusted at its start
 * and the last at its end, because nothing else covers those. The trust regions
 * tile the timeline exactly once, so every moment has one and only one verdict.
 */

export interface AnalysisWindow {
  startMs: number;
  endMs: number;
  /** Region of this window whose verdict is used. */
  trustFromMs: number;
  trustToMs: number;
}

export function windowPlan(totalMs: number, windowMs: number, hopMs: number): AnalysisWindow[] {
  if (totalMs <= 0) return [];
  if (totalMs <= windowMs) {
    return [{ startMs: 0, endMs: totalMs, trustFromMs: 0, trustToMs: totalMs }];
  }

  const starts: number[] = [];
  for (let s = 0; s + windowMs <= totalMs; s += hopMs) starts.push(s);

  // A tail shorter than the hop would otherwise go unanalysed; cover it with a
  // final window ending exactly at the end of the audio.
  const lastStart = starts[starts.length - 1]!;
  if (lastStart + windowMs < totalMs) starts.push(totalMs - windowMs);

  // The boundary between two windows is the midpoint of the stretch they both
  // cover, which is where their contexts are equally good. Deriving it this way
  // rather than from a fixed margin keeps the trust regions tiling exactly even
  // when the tail window does not land on the hop grid.
  const boundary = (i: number) => (starts[i]! + (starts[i - 1]! + windowMs)) / 2;

  return starts.map((startMs, i) => ({
    startMs,
    endMs: startMs + windowMs,
    trustFromMs: i === 0 ? 0 : boundary(i),
    trustToMs: i === starts.length - 1 ? totalMs : boundary(i + 1),
  }));
}
