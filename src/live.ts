import { startCapture, startFakeCapture, type Capture } from './audio/capture.js';
import { startLiveSession, type LiveSession, type LiveState } from './engine/live.js';
import { loadModels } from './engine/models.js';
import { resolveLocale, createTranslator } from './ui/i18n.js';

const t = createTranslator(resolveLocale(navigator.languages ?? [navigator.language]));
const $ = (id: string) => document.getElementById(id);
const setText = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };

setText('live-body', t('liveBody'));
setText('names-label', t('namesLabel'));
setText('names-hint', t('namesHint'));
setText('center-label', t('spokenTime'));
setText('badge-text', t('waiting'));
setText('hint', t('tellTheTable'));

const PALETTE = ['#B8552E', '#2F6B5E', '#C9932B', '#41497C', '#8C4067', '#5C6B32', '#3C7A99', '#9C3D3D'];

const toggle = $('toggle') as HTMLButtonElement | null;
const namesInput = $('names') as HTMLInputElement | null;

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
if (toggle) toggle.disabled = false;

function formatTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showError(msg: string) {
  const el = $('error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

function render(state: LiveState) {
  const segments = $('segments');
  const legend = $('legend');
  if (!segments || !legend) return;

  const circumference = 2 * Math.PI * 100;
  segments.innerHTML = '';
  let cumulative = 0;
  state.speakers.forEach((sp, i) => {
    const raw = sp.share * circumference;
    const gap = state.speakers.length > 1 ? 3 : 0;
    const len = Math.max(0, raw - gap);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'dial-seg');
    c.setAttribute('cx', '120'); c.setAttribute('cy', '120'); c.setAttribute('r', '100');
    c.setAttribute('stroke', PALETTE[i % PALETTE.length]!);
    c.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    c.setAttribute('stroke-dashoffset', String(-cumulative));
    segments.appendChild(c);
    cumulative += raw;
  });

  setText('center-time', formatTime(state.spokenMs));
  setText('center-elapsed', `${formatTime(state.elapsedMs)} ${t('listen') === 'Listen' ? 'at the table' : 'en la mesa'}`);

  const typed = (namesInput?.value ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  legend.innerHTML = '';
  state.speakers.forEach((sp, i) => {
    const li = document.createElement('li');
    li.className = sp.active ? 'legend-row active' : 'legend-row';
    const name = typed[i] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${i + 1}`;
    li.innerHTML =
      `<span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>` +
      `<span class="name">${name}</span><span class="leader"></span>` +
      `<span class="stat">${formatTime(sp.totalMs)}</span>` +
      `<span class="pct">${Math.round(sp.share * 100)}%</span>`;
    legend.appendChild(li);
  });

  const active = state.speakers.find((s) => s.active);
  const badge = $('badge');
  if (badge) {
    badge.classList.toggle('on', Boolean(active));
    const label = active
      ? (typed[state.speakers.indexOf(active)] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${state.speakers.indexOf(active) + 1}`)
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
      <dt>listening for</dt><dd>${(state.elapsedMs / 1000).toFixed(0)} s</dd>
      <dt>speaker count from</dt><dd>${state.countHint.source}</dd>
      <dt>reliability</dt><dd>${state.reliability}</dd>
    </dl>`;
    diagWrap.hidden = false;
  }
}

async function start() {
  const err = $('error');
  if (err) err.hidden = true;
  if (toggle) { toggle.disabled = true; }
  setText('badge-text', t('preparing'));
  setText('hint', t('loadingModels'));

  try {
    await loadModels();
  } catch {
    showError(t('analyseFailed'));
    if (toggle) toggle.disabled = false;
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
    setText('badge-text', t('waiting'));
    setText('hint', t('tellTheTable'));
    if (toggle) toggle.disabled = false;
    return;
  }

  const names = (namesInput?.value ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  session = await startLiveSession({ names });
  session.onUpdate(render);
  capture.onAudio((samples) => session?.push(samples));

  running = true;
  if (namesInput) namesInput.disabled = true;
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

  setText('toggle', t('listen'));
  toggle?.classList.remove('stopping');
  $('badge')?.classList.remove('on');
  setText('badge-text', t('waiting'));
  setText('hint', t('tellTheTable'));
  if (namesInput) namesInput.disabled = false;
  if (toggle) toggle.disabled = false;
}

toggle?.addEventListener('click', () => { void (running ? stop() : start()); });
