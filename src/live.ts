import { startCapture, startFakeCapture, type Capture } from './audio/capture.js';
import { startLiveSession, type LiveSession, type LiveState } from './engine/live.js';
import { loadModels } from './engine/models.js';
import { createTranslator } from './ui/i18n.js';
import { currentLocale, mountPrefs } from './ui/prefs.js';

const locale = currentLocale();
const t = createTranslator(locale);
const $ = (id: string) => document.getElementById(id);
const setText = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };

setText('live-body', t('liveBody'));
setText('count-label', t('countLabel'));
setText('count-hint', t('countHint'));
setText('names-label', t('namesLabel'));
setText('names-hint', t('namesHint'));
setText('bg-voices-label', t('backgroundVoicesLabel'));
setText('bg-voices-hint', t('backgroundVoicesHint'));
setText('center-label', t('spokenTime'));
setText('badge-text', t('waiting'));
setText('hint', t('tellTheTable'));
setText('version', `Ronda ${__RONDA_VERSION__}`);
setText('diagnostics-title', t('technicalDetails'));
const footer = document.getElementById('footer');
if (footer) mountPrefs(footer, locale);

const PALETTE = ['#B8552E', '#2F6B5E', '#C9932B', '#41497C', '#8C4067', '#5C6B32', '#3C7A99', '#9C3D3D'];

const toggle = $('toggle') as HTMLButtonElement | null;
const resetButton = $('reset') as HTMLButtonElement | null;
const namesInput = $('names') as HTMLInputElement | null;
const countInput = $('count') as HTMLInputElement | null;

/**
 * The head count is the one input Ronda insists on. Without it the speaker
 * count is guessed from a distance threshold, and on a real table that guess
 * grows with the length of the conversation — a four-person meeting reached
 * ten "voices" after a quarter of an hour. See ADR 0004.
 */
function headCount(): number | null {
  const n = Number(countInput?.value);
  return Number.isInteger(n) && n >= 2 ? n : null;
}

const typedNames = () => (namesInput?.value ?? '').split(',').map((n) => n.trim()).filter(Boolean);

function refreshReady() {
  if (toggle && !running) toggle.disabled = headCount() === null;
}
countInput?.addEventListener('input', refreshReady);
// Typing names is a natural way to say how many there are; offer it as the count.
namesInput?.addEventListener('input', () => {
  if (countInput && !countInput.value && typedNames().length >= 2) countInput.value = String(typedNames().length);
  refreshReady();
});

let capture: Capture | null = null;
let session: LiveSession | null = null;
let meterTimer: number | null = null;
let running = false;
let wakeLock: WakeLockSentinel | null = null;

/**
 * A phone in the middle of the table will blank its screen within a minute, and
 * a blanked screen suspends the audio graph. Holding a wake lock is what makes
 * the intended use — set it down and talk — actually work. Not every browser
 * offers one; where it is missing, listening still works while the screen is on.
 */
async function holdScreenAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Denied or unsupported; not worth interrupting the user over.
  }
}

function releaseScreen() {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Wake locks are dropped when a tab is hidden and must be re-taken on return.
document.addEventListener('visibilitychange', () => {
  if (running && document.visibilityState === 'visible') void holdScreenAwake();
});

setText('toggle', t('listen'));
setText('reset', t('reset'));
refreshReady();

function formatTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showError(msg: string) {
  const el = $('error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

/** A legend row built from text nodes: the name is whatever the user typed. */
function legendRow(className: string, colour: string, name: string, stat: string, pct: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = className;
  const cell = (cls: string, text = '') => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  };
  const dot = cell('dot');
  dot.style.background = colour;
  li.append(dot, cell('name', name), cell('leader'), cell('stat', stat), cell('pct', pct));
  return li;
}

function render(state: LiveState) {
  const segments = $('segments');
  const legend = $('legend');
  if (!segments || !legend) return;

  const circumference = 2 * Math.PI * 100;
  segments.innerHTML = '';
  let cumulative = 0;
  // Speakers come in identity order, which never changes during a session,
  // so a person's colour, row and name stay put while their share moves.
  state.speakers.forEach((sp) => {
    const raw = sp.share * circumference;
    const gap = state.speakers.length > 1 ? 3 : 0;
    const len = Math.max(0, raw - gap);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'dial-seg');
    c.setAttribute('cx', '120'); c.setAttribute('cy', '120'); c.setAttribute('r', '100');
    c.setAttribute('stroke', PALETTE[sp.id % PALETTE.length]!);
    c.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    c.setAttribute('stroke-dashoffset', String(-cumulative));
    segments.appendChild(c);
    cumulative += raw;
  });

  setText('center-time', formatTime(state.spokenMs));
  setText('center-elapsed', `${formatTime(state.elapsedMs)} ${t('listen') === 'Listen' ? 'at the table' : 'en la mesa'}`);

  const typed = typedNames();
  legend.innerHTML = '';
  state.speakers.forEach((sp) => {
    const name = typed[sp.id] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${sp.id + 1}`;
    legend.appendChild(legendRow(sp.active ? 'legend-row active' : 'legend-row',
      PALETTE[sp.id % PALETTE.length]!, name, formatTime(sp.totalMs), `${Math.round(sp.share * 100)}%`));
  });

  const active = state.speakers.find((s) => s.active);
  const badge = $('badge');
  if (badge) {
    badge.classList.toggle('on', Boolean(active));
    const label = active
      ? (typed[active.id] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${active.id + 1}`)
      : (running ? t('listening') : t('waiting'));
    setText('badge-text', label);
  }

  const warn = $('warning');
  if (warn) {
    if (state.samples > 0 && state.reliability !== 'good') {
      warn.textContent = state.reliability === 'insufficient' ? t('insufficient') : t('lowConfidence');
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  const diag = $('diagnostics');
  const diagWrap = $('diagnostics-wrap');
  if (diag && diagWrap) {
    diag.innerHTML = `<dl>
      <dt>voice samples</dt><dd>${state.samples}</dd>
      <dt>speakers</dt><dd>${state.speakers.length}</dd>
      <dt>speech heard</dt><dd>${(state.spokenMs / 1000).toFixed(1)} s</dd>
      <dt>too far away, dropped</dt><dd>${(state.backgroundMs / 1000).toFixed(1)} s</dd>
      <dt>not a participant</dt><dd>${(state.otherVoicesMs / 1000).toFixed(1)} s</dd>
      <dt>listening for</dt><dd>${(state.elapsedMs / 1000).toFixed(0)} s</dd>
      <dt>speaker count from</dt><dd>${state.countHint.source}</dd>
      <dt>reliability</dt><dd>${state.reliability}</dd>
    </dl>`;
    diagWrap.hidden = false;
  }
}

/**
 * Listen, or resume. Stopping pauses: the session and its tally survive, and
 * pressing the button again adds to the same conversation. Reset starts over.
 */
async function start() {
  const err = $('error');
  if (err) err.hidden = true;
  if (toggle) { toggle.disabled = true; }
  if (resetButton) resetButton.disabled = true;
  setText('badge-text', t('preparing'));
  setText('hint', t('loadingModels'));

  try {
    await loadModels();
  } catch {
    showError(t('analyseFailed'));
    afterStopControls();
    return;
  }

  try {
    // ?demo=1 feeds the bundled recording instead of the microphone, so the
    // live path can be checked without a room full of people.
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo) {
      const bytes = await (await fetch(`${import.meta.env.BASE_URL}example/meeting.wav`)).arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 16000 });
      const decoded = await ctx.decodeAudioData(bytes);
      await ctx.close();
      capture = await startFakeCapture(decoded.getChannelData(0));
    } else {
      capture = await startCapture();
    }
  } catch {
    showError(t('micDenied'));
    setText('badge-text', session ? t('paused') : t('waiting'));
    setText('hint', session ? t('pausedHint') : t('tellTheTable'));
    afterStopControls();
    return;
  }

  if (!session) {
    const count = headCount();
    const bgVoices = ($('bg-voices') as HTMLInputElement | null)?.checked ?? false;
    session = await startLiveSession({
      names: typedNames(),
      ...(count !== null ? { speakerCount: count } : {}),
      backgroundVoices: bgVoices,
    });
    session.onUpdate(render);
  }
  capture.onAudio((samples) => session?.push(samples));

  running = true;
  if (resetButton) resetButton.hidden = true;
  if (namesInput) namesInput.disabled = true;
  if (countInput) countInput.disabled = true;
  setText('toggle', t('stop'));
  toggle?.classList.add('stopping');
  setText('badge-text', t('listening'));
  setText('hint', t('firstResultWait'));
  if (toggle) toggle.disabled = false;

  const badge = $('badge');
  badge?.classList.add('on');
  void holdScreenAwake();

  meterTimer = window.setInterval(() => {
    const fill = $('meter-fill');
    if (fill && capture) fill.style.width = `${Math.round(capture.level() * 100)}%`;
    const state = session?.state();
    if (state) render(state);
  }, 250);
}

async function stop() {
  running = false;
  if (toggle) toggle.disabled = true;
  if (meterTimer !== null) { clearInterval(meterTimer); meterTimer = null; }
  releaseScreen();
  await capture?.stop();
  capture = null;
  await session?.flush();
  const state = session?.state();
  if (state) render(state);

  toggle?.classList.remove('stopping');
  $('badge')?.classList.remove('on');
  setText('badge-text', t('paused'));
  setText('hint', t('pausedHint'));
  afterStopControls();
}

/** Buttons for a paused session, or for none. */
function afterStopControls() {
  const paused = session !== null;
  setText('toggle', paused ? t('resume') : t('listen'));
  if (resetButton) { resetButton.hidden = !paused; resetButton.disabled = false; }
  if (namesInput) namesInput.disabled = paused;
  if (countInput) countInput.disabled = paused;
  refreshReady();
}

/** Forget the conversation and start clean. */
function reset() {
  session?.dispose();
  session = null;
  const segments = $('segments');
  const legend = $('legend');
  if (segments) segments.innerHTML = '';
  if (legend) legend.innerHTML = '';
  setText('center-time', '0:00');
  setText('center-elapsed', '');
  const warn = $('warning');
  if (warn) warn.hidden = true;
  const diagWrap = $('diagnostics-wrap');
  if (diagWrap) diagWrap.hidden = true;
  setText('badge-text', t('waiting'));
  setText('hint', t('tellTheTable'));
  afterStopControls();
}

toggle?.addEventListener('click', () => { void (running ? stop() : start()); });
resetButton?.addEventListener('click', reset);
