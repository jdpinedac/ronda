import { describe, it, expect } from 'vitest';
import { parseNames, nextCountValue } from '../src/ui/headcount.js';

/**
 * One question, not two. Typing the names of who is present says how many
 * there are; the number field follows the names until the user takes it over,
 * because somebody may stay silent or a visitor may join (ADR 0004).
 */
describe('parseNames', () => {
  it('splits on commas and drops blanks', () => {
    expect(parseNames(' Ana, Juan ,, Marta ')).toEqual(['Ana', 'Juan', 'Marta']);
    expect(parseNames('')).toEqual([]);
  });
});

describe('nextCountValue', () => {
  it('follows the number of names while the user has not touched the count', () => {
    expect(nextCountValue({ names: ['Ana', 'Juan', 'Marta'], current: '', edited: false })).toBe('3');
    expect(nextCountValue({ names: ['Ana', 'Juan', 'Marta', 'Pedro'], current: '3', edited: false })).toBe('4');
  });

  it('clears a count that came from names once fewer than two names remain', () => {
    expect(nextCountValue({ names: ['Ana'], current: '3', edited: false })).toBe('');
    expect(nextCountValue({ names: [], current: '2', edited: false })).toBe('');
  });

  it('leaves a count the user typed alone, whatever the names say', () => {
    expect(nextCountValue({ names: ['Ana', 'Juan', 'Marta'], current: '5', edited: true })).toBe('5');
    expect(nextCountValue({ names: [], current: '5', edited: true })).toBe('5');
  });
});
