/**
 * Language and theme, chosen in the footer and remembered by the browser.
 *
 * Language is applied by reloading: every string on a page is set once at
 * load, and a reload is simpler and safer than re-rendering a live session's
 * text in place. Theme applies at once. Both live in localStorage, which is
 * the one thing Ronda stores — two words, no audio, no measurements.
 */
import { chooseLocale, createTranslator, LOCALES, type Locale } from './i18n.js';

export const LOCALE_KEY = 'ronda.locale';
export const THEME_KEY = 'ronda.theme';
export type Theme = 'light' | 'dark' | 'auto';
const THEMES: readonly Theme[] = ['light', 'dark', 'auto'];
const THEME_COLOUR = { light: '#F2E8D6', dark: '#1C1712' } as const;

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode; the choice lasts the page */ }
};

/** The locale for this page load. Also sets <html lang>. */
export function currentLocale(): Locale {
  const locale = chooseLocale(read(LOCALE_KEY), navigator.languages ?? [navigator.language]);
  document.documentElement.lang = locale;
  return locale;
}

export function storedTheme(): Theme {
  const t = read(THEME_KEY);
  return (THEMES as readonly string[]).includes(t ?? '') ? (t as Theme) : 'auto';
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** Resolves 'auto' against the system and paints. Safe to call before the body exists. */
export function applyTheme(theme: Theme) {
  const resolved: 'light' | 'dark' = theme === 'auto' ? (systemDark()?.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset['theme'] = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOUR[resolved]);
}

let following: MediaQueryList | null = null;
function followSystem(theme: Theme) {
  const mq = systemDark();
  if (!mq) return;
  if (following) following.removeEventListener('change', onSystemChange);
  following = null;
  if (theme === 'auto') { mq.addEventListener('change', onSystemChange); following = mq; }
}
function onSystemChange() { applyTheme('auto'); }

/**
 * Renders the two switches into `container` and wires them. Call once per
 * page, after the strings are set.
 */
export function mountPrefs(container: HTMLElement, locale: Locale) {
  const t = createTranslator(locale);
  const theme = storedTheme();
  applyTheme(theme);
  followSystem(theme);

  const group = (label: string, name: 'locale' | 'theme', options: readonly { value: string; text: string }[], current: string, onPick: (v: string) => void) => {
    const wrap = document.createElement('div');
    wrap.className = 'pref';
    const caption = document.createElement('span');
    caption.className = 'pref-label';
    caption.textContent = label;
    wrap.appendChild(caption);
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', label);
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.text;
      b.dataset[name] = o.value;
      b.setAttribute('aria-pressed', String(o.value === current));
      b.addEventListener('click', () => {
        for (const other of seg.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        onPick(o.value);
      });
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    return wrap;
  };

  const nav = document.createElement('nav');
  nav.id = 'prefs';
  nav.className = 'prefs';
  nav.appendChild(group(t('language'), 'locale',
    LOCALES.map((l) => ({ value: l, text: l === 'es' ? 'Español' : 'English' })), locale,
    (v) => { write(LOCALE_KEY, v); location.reload(); }));
  nav.appendChild(group(t('theme'), 'theme',
    [{ value: 'light', text: t('themeLight') }, { value: 'dark', text: t('themeDark') }, { value: 'auto', text: t('themeAuto') }], theme,
    (v) => { write(THEME_KEY, v); applyTheme(v as Theme); followSystem(v as Theme); }));
  container.appendChild(nav);
}
