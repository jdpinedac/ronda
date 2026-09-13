/** Minimal bilingual string table. No dependency; the app has few strings. */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const STRINGS = {
  tagline: {
    es: 'Ponla en el centro de la mesa y pulsa Escuchar. Distingue voces por su timbre, nunca por lo que dicen.',
    en: 'Put it in the middle of the table and press Listen. It tells voices apart by their timbre, never by what they say.',
  },
  namesLabel: {
    es: 'Quiénes están en la mesa (opcional, separados por comas)',
    en: 'Who is at the table (optional, comma separated)',
  },
  listen: { es: 'Escuchar', en: 'Listen' },
  stop: { es: 'Detener', en: 'Stop' },
  reset: { es: 'Reiniciar', en: 'Reset' },
  waiting: { es: 'En espera', en: 'Waiting' },
  silence: { es: 'Silencio', en: 'Silence' },
  spokenTime: { es: 'tiempo hablado', en: 'time spoken' },
  loadingModels: { es: 'Cargando modelos…', en: 'Loading models…' },
  unsupported: {
    es: 'Este navegador no puede ejecutar Ronda. Hace falta WebAssembly y acceso al micrófono.',
    en: 'This browser cannot run Ronda. WebAssembly and microphone access are required.',
  },
} as const;

export type StringKey = keyof typeof STRINGS;

/** Picks the best supported locale for a list of preferences (e.g. navigator.languages). */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base && (LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return 'en';
}

export function createTranslator(locale: Locale) {
  return (key: StringKey): string => STRINGS[key][locale];
}
