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
  analyseCta: { es: 'Analizar una grabación', en: 'Analyse a recording' },
  analyseCtaBody: {
    es: 'Ya funciona: elige un archivo de audio de una conversación y Ronda te dice cuánto habló cada quien. Todo en tu navegador.',
    en: 'This works now: pick an audio file of a conversation and Ronda tells you how much each person spoke. All in your browser.',
  },
  buildingTitle: { es: 'En construcción', en: 'Under construction' },
  buildingBody: {
    es: 'Escuchar en vivo desde el micrófono todavía no está listo. Mientras tanto puedes usar la versión antigua, que sí escucha en directo, aunque se equivoca bastante más.',
    en: 'Listening live from the microphone is not ready yet. In the meantime you can use the old version, which does listen live, though it makes considerably more mistakes.',
  },
  tryPrototype: { es: 'Probar la versión antigua', en: 'Try the old version' },
  thisDevice: { es: 'Este dispositivo', en: 'This device' },
  deviceReady: {
    es: 'Tu navegador puede ejecutar Ronda.',
    en: 'Your browser can run Ronda.',
  },
  analyseTitle: { es: 'Analizar una grabación', en: 'Analyse a recording' },
  analyseBody: {
    es: 'Elige un archivo de audio de una conversación. Se analiza aquí mismo, en tu navegador: no se sube a ningún servidor.',
    en: 'Choose an audio file of a conversation. It is analysed right here in your browser and never uploaded.',
  },
  chooseFile: { es: 'Elegir archivo', en: 'Choose file' },
  analyse: { es: 'Analizar', en: 'Analyse' },
  namesHint: {
    es: 'Si escribes quiénes hablan, acierta bastante más.',
    en: 'Telling it who is speaking makes it considerably more accurate.',
  },
  segmenting: { es: 'Buscando dónde habla cada quien…', en: 'Finding who speaks where…' },
  identifying: { es: 'Comparando las voces…', en: 'Comparing voices…' },
  loadingTheModels: { es: 'Descargando los modelos (solo la primera vez)…', en: 'Downloading the models (first time only)…' },
  results: { es: 'Reparto de la palabra', en: 'Share of the floor' },
  countFromNames: { es: 'Usando los nombres que escribiste', en: 'Using the names you typed' },
  countAutomatic: {
    es: 'Sin nombres: el número de personas es una estimación, puede fallar.',
    en: 'No names given: the number of people is a guess and may be wrong.',
  },
  overlap: { es: 'hablando a la vez', en: 'talking at once' },
  inSilence: { es: 'en silencio', en: 'in silence' },
  noSpeech: {
    es: 'No encontré voz suficiente en esa grabación.',
    en: 'I could not find enough speech in that recording.',
  },
  analyseFailed: { es: 'No pude analizar ese archivo.', en: 'I could not analyse that file.' },
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
