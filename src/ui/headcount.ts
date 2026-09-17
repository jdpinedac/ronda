/**
 * The head count and the names are one question asked two ways. Typing who is
 * present says how many there are, so the number follows the names — until
 * the user edits the number, which they may need to when somebody will stay
 * silent or a visitor is expected (ADR 0004). Shared by the live and file pages.
 */

export function parseNames(text: string): string[] {
  return text.split(',').map((n) => n.trim()).filter(Boolean);
}

/**
 * What the count field should show after the names changed. A count the user
 * typed is theirs; one that came from the names tracks them, and goes away
 * with them, since a single name says nothing about the size of the table.
 */
export function nextCountValue(opts: { names: readonly string[]; current: string; edited: boolean }): string {
  if (opts.edited) return opts.current;
  return opts.names.length >= 2 ? String(opts.names.length) : '';
}
