/**
 * Telling the table apart from the room.
 *
 * A microphone in the middle of a table also hears the next table, the corridor
 * and the television. The segmentation model correctly reports all of it as
 * speech — it is speech — but counting it gives a conversation more
 * participants than it has, and the people who were actually there get a
 * smaller share than they deserve.
 *
 * Distance is the discriminator available to us: a voice from across the room
 * arrives far quieter than one at the table. Measured on a recording with
 * distant conversation in the gaps, background stretches sat at 0.16-0.37 of
 * the session's median level while everyone at the table sat above 0.55; a
 * clean meeting's quietest stretch was 0.55.
 *
 * This is a real trade-off, not a free win. Someone soft-spoken at the table
 * can fall below the line, so the threshold is deliberately well clear of the
 * quietest legitimate speech observed, and how much was dropped is reported.
 */

/** Root-mean-square level of a block of samples. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * Fraction of the median level below which speech is treated as coming from
 * outside the conversation.
 */
export const BACKGROUND_LEVEL_RATIO = 0.45;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Marks which stretches are loud enough to be part of the conversation.
 *
 * With too few samples the median means little, so everything is kept: better
 * to count a distant voice than to discard a real participant on no evidence.
 */
export function selectForeground(
  levels: readonly number[],
  ratio: number = BACKGROUND_LEVEL_RATIO,
): boolean[] {
  if (levels.length < 4) return levels.map(() => true);
  const floor = median(levels) * ratio;
  return levels.map((l) => l >= floor);
}
