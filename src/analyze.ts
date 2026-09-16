import { diarize, type DiarizationResult } from './engine/diarize.js';
import { loadModels, SAMPLE_RATE } from './engine/models.js';
import { createTranslator } from './ui/i18n.js';
import { currentLocale, mountPrefs } from './ui/prefs.js';

const locale = currentLocale();
const t = createTranslator(locale);
const $ = (id: string) => document.getElementById(id);
const setText = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };

setText('analyse-body', t('analyseBody'));
setText('count-label', t('countLabel'));
setText('count-hint', t('countHint'));
setText('names-label', t('namesLabel'));
setText('names-hint', t('namesHint'));
setText('bg-voices-label', t('backgroundVoicesLabel'));
setText('bg-voices-hint', t('backgroundVoicesHint'));
setText('choose', t('chooseFile'));
setText('example', t('tryExample'));
setText('go', t('analyse'));
setText('results-title', t('results'));
setText('center-label', t('spokenTime'));
setText('version', `Ronda ${__RONDA_VERSION__}`);
setText('diagnostics-title', t('technicalDetails'));
const footer = document.getElementById('footer');
if (footer) mountPrefs(footer, locale);

const PALETTE = ['#B8552E', '#2F6B5E', '#C9932B', '#41497C', '#8C4067', '#5C6B32', '#3C7A99', '#9C3D3D'];

const fileInput = $('file') as HTMLInputElement | null;
const namesInput = $('names') as HTMLInputElement | null;
const goButton = $('go') as HTMLButtonElement | null;
const chooseButton = $('choose') as HTMLButtonElement | null;
const exampleButton = $('example') as HTMLButtonElement | null;

const countInput = $('count') as HTMLInputElement | null;

let chosen: File | null = null;

/** See the note in live.ts: the head count is the one input Ronda insists on. */
function headCount(): number | null {
  const n = Number(countInput?.value);
  return Number.isInteger(n) && n >= 2 ? n : null;
}
const typedNames = () => (namesInput?.value ?? '').split(',').map((n) => n.trim()).filter(Boolean);
function refreshReady() {
  if (goButton) goButton.disabled = !chosen || headCount() === null;
}
countInput?.addEventListener('input', refreshReady);
namesInput?.addEventListener('input', () => {
  if (countInput && !countInput.value && typedNames().length >= 2) countInput.value = String(typedNames().length);
  refreshReady();
});

// The controls start disabled in the markup and are enabled here, so a button
// is never clickable before its listener exists. Clicking a live-looking
// control that does nothing is worse than waiting for it.
chooseButton?.addEventListener('click', () => fileInput?.click());
if (chooseButton) chooseButton.disabled = false;

// A bundled recording, so trying Ronda does not require going and finding an
// audio file first. Its true answer is stated on the page, which makes the
// result checkable rather than merely plausible.
exampleButton?.addEventListener('click', async () => {
  if (!exampleButton) return;
  exampleButton.disabled = true;
  showProgress(t('exampleLoading'));
  try {
    const url = `${import.meta.env.BASE_URL}example/meeting.wav`;
    const blob = await (await fetch(url)).blob();
    chosen = new File([blob], 'meeting.wav', { type: 'audio/wav' });
    setText('filename', 'meeting.wav');
    // The example is a four-person meeting; say so, as a user would.
    if (countInput && !countInput.value) countInput.value = '4';
    const note = $('example-note');
    if (note) {
      note.textContent = `${t('exampleNote')} ${t('exampleCredit')}`;
      note.hidden = false;
    }
    refreshReady();
    const p = $('progress');
    if (p) p.hidden = true;
  } catch {
    showError(t('analyseFailed'));
  } finally {
    exampleButton.disabled = false;
  }
});
if (exampleButton) exampleButton.disabled = false;
fileInput?.addEventListener('change', () => {
  chosen = fileInput.files?.[0] ?? null;
  setText('filename', chosen?.name ?? '');
  refreshReady();
});

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function showProgress(msg: string) {
  const el = $('progress');
  if (el) { el.textContent = msg; el.hidden = false; }
}

function showError(msg: string) {
  const el = $('error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

/** Decodes any browser-supported audio file to 16 kHz mono. */
async function decodeTo16kMono(file: File): Promise<Float32Array> {
  const bytes = await file.arrayBuffer();
  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(bytes);
  await probe.close();

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function render(result: DiarizationResult) {
  const segments = $('segments');
  const legend = $('legend');
  if (!segments || !legend) return;

  const spokenMs = result.speakers.reduce((s, x) => s + x.totalMs, 0);
  const circumference = 2 * Math.PI * 100;
  segments.innerHTML = '';
  let cumulative = 0;

  // Number people by who spoke first, as the live page does, so "Speaker 1"
  // means the same thing on both pages and a typed name goes to the same seat.
  const firstHeard = new Map<number, number>();
  for (const s of result.spans) if (!firstHeard.has(s.speaker)) firstHeard.set(s.speaker, s.startMs);
  const speakers = [...result.speakers].sort((a, b) => (firstHeard.get(a.id) ?? Infinity) - (firstHeard.get(b.id) ?? Infinity));

  speakers.forEach((sp, i) => {
    const raw = sp.share * circumference;
    const gap = result.speakers.length > 1 ? 3 : 0;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'dial-seg');
    circle.setAttribute('cx', '120');
    circle.setAttribute('cy', '120');
    circle.setAttribute('r', '100');
    circle.setAttribute('stroke', PALETTE[i % PALETTE.length]!);
    circle.setAttribute('stroke-dasharray', `${Math.max(0, raw - gap)} ${circumference - Math.max(0, raw - gap)}`);
    circle.setAttribute('stroke-dashoffset', String(-cumulative));
    segments.appendChild(circle);
    cumulative += raw;
  });

  setText('center-time', formatTime(spokenMs));

  const typed = typedNames();
  legend.innerHTML = '';
  speakers.forEach((sp, i) => {
    const name = typed[i] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${i + 1}`;
    const li = document.createElement('li');
    li.className = 'legend-row';
    // Text nodes, not markup: the name is whatever the user typed.
    const cell = (cls: string, text = '') => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      return span;
    };
    const dot = cell('dot');
    dot.style.background = PALETTE[i % PALETTE.length]!;
    li.append(dot, cell('name', name), cell('leader'), cell('stat', formatTime(sp.totalMs)), cell('pct', `${Math.round(sp.share * 100)}%`));
    legend.appendChild(li);
  });

  setText('meta',
    `${formatTime(result.overlapMs)} ${t('overlap')} · ${formatTime(result.silenceMs)} ${t('inSilence')}`);
  const source = result.countHint.source;
  setText('count-note',
    source === 'count' ? t('countFromCount') : source === 'names' ? t('countFromNames') : t('countAutomatic'));

  const el = $('results');
  if (el) el.hidden = false;
}

function renderWarning(message: string) {
  const el = $('warning');
  if (el) { el.textContent = message; el.hidden = false; }
}

function renderDiagnostics(result: DiarizationResult) {
  const el = $('diagnostics');
  if (!el) return;
  const d = result.diagnostics;
  const rows: [string, string][] = [
    ['windows analysed', String(d.windows)],
    ['spans found', String(d.spansTotal)],
    ['one speaker only', String(d.spansSingleSpeaker)],
    ['long enough to use', String(d.spansLongEnough)],
    ['at the table', String(d.spansInForeground)],
    ['too far away, dropped', `${(d.backgroundMs / 1000).toFixed(1)} s`],
    ['not a participant', `${(d.otherVoicesMs / 1000).toFixed(1)} s`],
    ['talking at once, credited to the floor holder', `${(d.overlapCreditedMs / 1000).toFixed(1)} s`],
    ['voice prints taken', String(d.embeddings)],
    ['speech detected', `${(d.speechMs / 1000).toFixed(1)} s`],
    ['longest single stretch', `${(d.longestSpanMs / 1000).toFixed(1)} s`],
    ['dropped as too short', `${(d.discardedShortMs / 1000).toFixed(1)} s`],
    ['speaker count from', result.countHint.source],
  ];
  el.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const wrap = $('diagnostics-wrap');
  if (wrap) wrap.hidden = false;
}

goButton?.addEventListener('click', async () => {
  if (!chosen) return;
  goButton.disabled = true;
  const errorEl = $('error');
  if (errorEl) errorEl.hidden = true;
  const warnEl = $('warning');
  if (warnEl) warnEl.hidden = true;

  try {
    showProgress(t('loadingTheModels'));
    await loadModels();

    const audio = await decodeTo16kMono(chosen);
    const count = headCount();
    const bgVoices = ($('bg-voices') as HTMLInputElement | null)?.checked ?? false;
    const result = await diarize(audio, {
      names: typedNames(),
      ...(count !== null ? { speakerCount: count } : {}),
      backgroundVoices: bgVoices,
      onProgress: (fraction, stage) => {
        const label = stage === 'segmenting' ? t('segmenting') : t('identifying');
        showProgress(`${label} ${Math.round(fraction * 100)}%`);
      },
    });

    const progressEl = $('progress');
    if (progressEl) progressEl.hidden = true;

    (window as unknown as { __ronda?: unknown }).__ronda = result;
    renderDiagnostics(result);
    if (result.speakers.length === 0) {
      showError(t('noSpeech'));
    } else if (result.reliability === 'insufficient') {
      showError(t('insufficient'));
      renderWarning(t('insufficient'));
      render(result);
    } else {
      if (result.reliability === 'low') {
        renderWarning(t('lowConfidence'));
      }
      render(result);
    }
  } catch (err) {
    const progressEl = $('progress');
    if (progressEl) progressEl.hidden = true;
    showError(`${t('analyseFailed')} ${err instanceof Error ? err.message : ''}`);
  } finally {
    refreshReady();
  }
});
