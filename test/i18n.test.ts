import { describe, it, expect } from 'vitest';
import { resolveLocale, createTranslator, LOCALES } from '../src/ui/i18n.js';

describe('resolveLocale', () => {
  it('picks the first supported language from the preference list', () => {
    expect(resolveLocale(['es-CO', 'en-US'])).toBe('es');
    expect(resolveLocale(['en-GB'])).toBe('en');
  });

  it('skips unsupported languages rather than failing', () => {
    expect(resolveLocale(['pt-BR', 'fr', 'es'])).toBe('es');
  });

  it('falls back to English when nothing matches', () => {
    expect(resolveLocale(['ja', 'ko'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });

  it('is case insensitive', () => {
    expect(resolveLocale(['ES-co'])).toBe('es');
  });
});

describe('createTranslator', () => {
  it('returns strings in the requested locale', () => {
    expect(createTranslator('es')('listen')).toBe('Escuchar');
    expect(createTranslator('en')('listen')).toBe('Listen');
  });

  it('has every string in every locale', () => {
    const keys = ['tagline', 'namesLabel', 'listen', 'stop', 'reset', 'waiting',
      'silence', 'spokenTime', 'loadingModels', 'unsupported'] as const;
    for (const locale of LOCALES) {
      const t = createTranslator(locale);
      for (const k of keys) expect(t(k), `${k} in ${locale}`).toBeTruthy();
    }
  });
});
