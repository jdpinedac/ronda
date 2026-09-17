/** Minimal bilingual string table. No dependency; the app has few strings. */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const STRINGS = {
  tagline: {
    es: 'Ponla en el centro de la mesa y pulsa Escuchar. Distingue voces por su timbre, nunca por lo que dicen.',
    en: 'Put it in the middle of the table and press Listen. It tells voices apart by their timbre, never by what they say.',
  },
  countLabel: {
    es: '¿Cuántas personas hay en la mesa?',
    en: 'How many people are at the table?',
  },
  countHint: {
    es: 'Es el dato que más ayuda. Sin él, Ronda parte a una misma persona en varias voces.',
    en: 'This helps more than anything else. Without it, Ronda splits one person into several voices.',
  },
  namesLabel: {
    es: 'Nombres (opcional, separados por comas)',
    en: 'Names (optional, comma separated)',
  },
  listen: { es: 'Escuchar', en: 'Listen' },
  stop: { es: 'Detener', en: 'Stop' },
  reset: { es: 'Reiniciar', en: 'Reset' },
  resume: { es: 'Reanudar', en: 'Resume' },
  exportDiagnostics: { es: 'Exportar diagnóstico', en: 'Export diagnostics' },
  aMomentAgo: { es: 'hace un momento', en: 'a moment ago' },
  unclearVoices: {
    es: 'Las voces llegan poco nítidas. El reparto se calcula igual, pero quién habla en cada momento será menos fiable. Acerca el teléfono a las personas, o aléjalo del ruido y de las ventanas.',
    en: 'The voices are arriving muddled. The shares still add up, but who is speaking at each moment will be less reliable. Move the phone closer to the people, or away from noise and windows.',
  },
  exportHint: {
    es: 'Descarga un archivo con la huella de timbre de cada fragmento de voz, sus tiempos y a quién se asignó. No contiene audio ni nombres, y sirve para reproducir esta sesión y corregir errores.',
    en: 'Downloads a file with the timbre fingerprint of each stretch of speech, its timing and who it was assigned to. It holds no audio and no names, and lets this session be reproduced to fix mistakes.',
  },
  paused: { es: 'En pausa', en: 'Paused' },
  pausedHint: {
    es: 'El reparto se conserva. Reanudar sigue sumando sobre la misma conversación; Reiniciar empieza de cero.',
    en: 'The tally is kept. Resume keeps adding to the same conversation; Reset starts over.',
  },
  waiting: { es: 'En espera', en: 'Waiting' },
  silence: { es: 'Silencio', en: 'Silence' },
  spokenTime: { es: 'tiempo hablado', en: 'time spoken' },
  loadingModels: { es: 'Cargando modelos…', en: 'Loading models…' },
  liveCta: { es: 'Escuchar la mesa', en: 'Listen to the table' },
  liveCtaBody: {
    es: 'Pon el celular o el portátil en el centro de la mesa y pulsa Escuchar. Vas viendo en vivo cuánto habla cada quien. No graba nada: el audio se analiza y se descarta al instante.',
    en: 'Put your phone or laptop in the middle of the table and press Listen. You see who is holding the floor as it happens. Nothing is recorded: audio is analysed and discarded at once.',
  },
  analyseCta: { es: 'Analizar una grabación', en: 'Analyse a recording' },
  analyseCtaBody: {
    es: 'Ya funciona: elige un archivo de audio de una conversación y Ronda te dice cuánto habló cada quien. Todo en tu navegador.',
    en: 'This works now: pick an audio file of a conversation and Ronda tells you how much each person spoke. All in your browser.',
  },
  releaseNotice: {
    es: 'Versión de prueba {version}. Se publica para que la pruebes: todavía no es una versión final.',
    en: 'Trial version {version}. Published so you can try it; not a final release yet.',
  },
  thisDevice: { es: 'Este dispositivo', en: 'This device' },
  deviceReady: {
    es: 'Tu navegador puede ejecutar Ronda.',
    en: 'Your browser can run Ronda.',
  },
  liveTitle: { es: 'Escuchar la mesa', en: 'Listen to the table' },
  liveBody: {
    es: 'Pon el aparato en el centro de la mesa y pulsa Escuchar. Distingue las voces por su timbre, nunca por lo que dicen, y no graba nada.',
    en: 'Put the device in the middle of the table and press Listen. It tells voices apart by their timbre, never by what they say, and records nothing.',
  },
  micDenied: {
    es: 'No pude acceder al micrófono. Revisa los permisos del navegador y vuelve a intentarlo.',
    en: 'I could not reach the microphone. Check the browser permissions and try again.',
  },
  preparing: { es: 'Preparando…', en: 'Getting ready…' },
  listening: { es: 'Escuchando', en: 'Listening' },
  firstResultWait: {
    es: 'El primer resultado aparece a los 10 segundos.',
    en: 'The first result appears after 10 seconds.',
  },
  tellTheTable: {
    es: 'Avísale a la mesa que está escuchando.',
    en: 'Let the table know it is listening.',
  },
  analyseTitle: { es: 'Analizar una grabación', en: 'Analyse a recording' },
  analyseBody: {
    es: 'Elige un archivo de audio de una conversación. Se analiza aquí mismo, en tu navegador: no se sube a ningún servidor.',
    en: 'Choose an audio file of a conversation. It is analysed right here in your browser and never uploaded.',
  },
  tryExample: { es: 'Probar con un ejemplo', en: 'Try an example' },
  exampleLoading: { es: 'Cargando el ejemplo…', en: 'Loading the example…' },
  exampleNote: {
    es: 'Ejemplo: 90 segundos de una reunión real de cuatro personas, grabada con un solo micrófono en medio de la mesa — el caso más difícil. El reparto verdadero es 34% / 23% / 22% / 21%.',
    en: 'Example: 90 seconds of a real four-person meeting recorded on a single microphone in the middle of the table — the hardest case. The true split is 34% / 23% / 22% / 21%.',
  },
  exampleCredit: {
    es: 'Audio del AMI Corpus (CC-BY-4.0).',
    en: 'Audio from the AMI Corpus (CC-BY-4.0).',
  },
  backgroundVoicesLabel: {
    es: 'Hay una TV, radio o mesa vecina que se oye',
    en: 'A television, radio or nearby table is audible',
  },
  backgroundVoicesHint: {
    es: 'Ignora el habla mucho más baja que la mesa y deja sitio para esas voces, para que no se las atribuya a nadie. Si no las hay, déjalo sin marcar: activarlo puede quitarle tiempo a quien habla bajito.',
    en: 'Ignores speech much quieter than the table and leaves room for those voices so they are not credited to anyone. If there are none, leave it unticked — turning it on can cost a soft-spoken person their time.',
  },
  chooseFile: { es: 'Elegir archivo', en: 'Choose file' },
  analyse: { es: 'Analizar', en: 'Analyse' },
  namesHint: {
    es: 'Los nombres son etiquetas: van a los grupos de voz en el orden en que Ronda los forma, que no siempre es el orden en que habla la gente. Ronda todavía no reconoce quién es quién.',
    en: 'Names are labels: they go to the voice groups in the order Ronda forms them, which is not always the order people speak in. Ronda does not yet recognise who is who.',
  },
  countFromNamesHint: {
    es: 'Según los nombres. Cambiálo si alguien se va a quedar callado o si hay más gente de la que nombraste.',
    en: 'From the names. Change it if someone will stay silent or there are more people than you named.',
  },
  segmenting: { es: 'Buscando dónde habla cada quien…', en: 'Finding who speaks where…' },
  identifying: { es: 'Comparando las voces…', en: 'Comparing voices…' },
  loadingTheModels: { es: 'Descargando los modelos (solo la primera vez)…', en: 'Downloading the models (first time only)…' },
  results: { es: 'Reparto de la palabra', en: 'Share of the floor' },
  countFromCount: { es: 'Usando el número de personas que indicaste', en: 'Using the head count you gave' },
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
  lowConfidence: {
    es: 'Encontré pocos fragmentos de voz claros, así que este reparto es poco fiable. Suele pasar con grabaciones cortas, con mucho ruido de fondo, o cuando alguien habla muy poco.',
    en: 'I found few clear stretches of speech, so this split is not reliable. That usually means a short recording, a lot of background noise, or someone who barely spoke.',
  },
  insufficient: {
    es: 'No encontré suficientes fragmentos de voz claros para separar a las personas. Prueba con una grabación más larga, o con menos ruido de fondo.',
    en: 'I could not find enough clear speech to tell people apart. Try a longer recording, or one with less background noise.',
  },
  technicalDetails: { es: 'Detalles técnicos', en: 'Technical details' },
  language: { es: 'Idioma', en: 'Language' },
  theme: { es: 'Tema', en: 'Theme' },
  themeLight: { es: 'Claro', en: 'Light' },
  themeDark: { es: 'Oscuro', en: 'Dark' },
  themeAuto: { es: 'Automático', en: 'Auto' },
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

/**
 * The locale to use: what the user chose in the footer, if they chose one
 * and it is still a language Ronda has; otherwise what the browser prefers.
 */
export function chooseLocale(stored: string | null | undefined, preferred: readonly string[]): Locale {
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  return resolveLocale(preferred);
}

export function createTranslator(locale: Locale) {
  return (key: StringKey): string => STRINGS[key][locale];
}
