import { startCapture, startFakeCapture, type Capture } from './audio/capture.js';
import { startLiveSession, MIN_INTRODUCTION_MS, TARGET_INTRODUCTION_MS, type LiveSession, type LiveState } from './engine/live.js';
import { loadModels } from './engine/models.js';
import { createTranslator } from './ui/i18n.js';
import { currentLocale, mountPrefs } from './ui/prefs.js';
import { parseNames, nextCountValue } from './ui/headcount.js';

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
setText('intro-label', t('introLabel'));
setText('intro-hint', t('introHint'));
setText('intro-skip', t('introSkip'));
setText('add-person', t('addPerson'));
setText('add-go', t('addPersonGo'));
setText('add-hint', t('addPersonHint'));
setText('recover', t('recoverAnalysis'));
($('add-name') as HTMLInputElement | null)?.setAttribute('placeholder', t('addPersonName'));
const footer = document.getElementById('footer');
if (footer) mountPrefs(footer, locale);

const PALETTE = ['#B8552E', '#2F6B5E', '#C9932B', '#41497C', '#8C4067', '#5C6B32', '#3C7A99', '#9C3D3D'];

const toggle = $('toggle') as HTMLButtonElement | null;
const resetButton = $('reset') as HTMLButtonElement | null;
const exportButton = $('export') as HTMLButtonElement | null;
const namesInput = $('names') as HTMLInputElement | null;
const countInput = $('count') as HTMLInputElement | null;
const introPanel = $('intro');
const introNext = $('intro-next') as HTMLButtonElement | null;
const introSkip = $('intro-skip') as HTMLButtonElement | null;
const addWrap = $('add-wrap');
const addForm = $('add-form');
const addName = $('add-name') as HTMLInputElement | null;
const stallWrap = $('stall-wrap');
/** Audio arriving this long without analysis is a stall worth telling the user about. */
const STALL_MS = 30_000;

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

const typedNames = () => parseNames(namesInput?.value ?? '');

function refreshReady() {
  if (toggle && !running) toggle.disabled = headCount() === null;
}
// One question asked two ways: the count follows the names until the user
// takes the number over. See headcount.ts.
let countEdited = false;
countInput?.addEventListener('input', () => {
  countEdited = countInput.value !== '';
  setText('count-hint', t('countHint'));
  refreshReady();
});
namesInput?.addEventListener('input', () => {
  if (countInput) {
    countInput.value = nextCountValue({ names: typedNames(), current: countInput.value, edited: countEdited });
    setText('count-hint', countInput.value && !countEdited ? t('countFromNamesHint') : t('countHint'));
  }
  refreshReady();
});

let capture: Capture | null = null;
/** What the device reported doing to the audio, kept for the diagnostics export. */
let lastCaptureSettings: Record<string, unknown> | null = null;
let session: LiveSession | null = null;
/** Names as typed when the session started; the introductions go through them in order. */
let sessionNames: string[] = [];
let introIndex = 0;
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
  session?.note('capture', `page ${document.visibilityState}`);
  if (running && document.visibilityState === 'visible') {
    void holdScreenAwake();
    void capture?.resume();
  }
});

setText('toggle', t('listen'));
setText('reset', t('reset'));
setText('export', t('exportDiagnostics'));
setText('export-hint', t('exportHint'));
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

  // Names as the session knows them, which includes anyone who joined; the
  // typed field only, before a session exists.
  const typed = sessionNames.length > 0 ? sessionNames : typedNames();
  legend.innerHTML = '';
  state.speakers.forEach((sp) => {
    const name = typed[sp.id] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${sp.id + 1}`;
    legend.appendChild(legendRow(sp.active ? 'legend-row active' : 'legend-row',
      PALETTE[sp.id % PALETTE.length]!, name, formatTime(sp.totalMs), `${Math.round(sp.share * 100)}%`));
  });

  const introducing = state.phase === 'introductions' || state.introducing !== null;
  const midConversation = state.phase === 'conversation' && state.introducing !== null;
  if (introPanel) introPanel.hidden = !introducing;
  if (introducing) {
    // Whose turn, how much of their voice has arrived, and whether it is enough.
    const collected = state.introducing?.collectedMs ?? 0;
    setText('intro-name', sessionNames[introIndex] ?? '');
    const fill = $('intro-fill');
    if (fill) fill.style.width = `${Math.min(100, Math.round((100 * collected) / TARGET_INTRODUCTION_MS))}%`;
    if (introNext) {
      introNext.disabled = !running || (!midConversation && collected < MIN_INTRODUCTION_MS);
      introNext.textContent = midConversation ? t('introDone') : introIndex >= sessionNames.length - 1 ? t('introStart') : t('introNext');
    }
    if (introSkip) introSkip.hidden = midConversation;
  }
  // Someone can join once the conversation is being attributed to profiles.
  if (addWrap) addWrap.hidden = !(state.phase === 'conversation' && state.countHint.source === 'calibration' && state.introducing === null);
  // Audio keeps arriving but nothing gets analysed: say so, and offer a nudge.
  const stalled = running && state.elapsedMs - state.coveredToMs > STALL_MS;
  if (stallWrap) stallWrap.hidden = !stalled;

  const active = state.speakers.find((s) => s.active);
  const badge = $('badge');
  if (badge) {
    badge.classList.toggle('on', Boolean(active) || (introducing && running));
    // The verdict is about audio a few seconds old, and says so.
    const label = introducing
      ? (running ? t('introducing') : (session ? t('paused') : t('waiting')))
      : active
        ? `${typed[active.id] ?? `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${active.id + 1}`} · ${t('aMomentAgo')}`
        : (running ? t('listening') : (session ? t('paused') : t('waiting')));
    setText('badge-text', label);
  }

  const warn = $('warning');
  if (warn) {
    if (stalled) {
      warn.textContent = t('stalled');
      warn.hidden = false;
    } else if (state.samples > 0 && state.reliability !== 'good') {
      warn.textContent = state.reliability === 'insufficient' ? t('insufficient') : t('lowConfidence');
      warn.hidden = false;
    } else if (state.samples > 0 && (!state.clear || state.overlapHeavy)) {
      // Both can be true at once, and they say different things: one about
      // who is speaking now, the other about the shares.
      warn.textContent = [state.clear ? null : t('unclearVoices'), state.overlapHeavy ? t('heavyOverlap') : null].filter(Boolean).join(' ');
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
      <dt>voice clarity (spread, lower is clearer)</dt><dd>${state.spread.toFixed(2)}</dd>
      <dt>talk-over credited to the floor holder</dt><dd>${Math.round(state.overlapShare * 100)}% of the time shown</dd>
      <dt>listening for</dt><dd>${(state.elapsedMs / 1000).toFixed(0)} s</dd>
      <dt>speaker count from</dt><dd>${state.countHint.source}</dd>
      <dt>introductions, per person</dt><dd>${state.profilesMs.length ? state.profilesMs.map((ms) => `${(ms / 1000).toFixed(1)} s`).join(', ') : 'none'}</dd>
      <dt>audio waiting</dt><dd>${(state.bufferedMs / 1000).toFixed(1)} s</dd>
      <dt>log</dt><dd>${['error', 'skipped', 'dropped', 'recovered', 'capture', 'far-run'].map((k) => `${k} ${state.log.filter((e) => e.kind === k).length}`).join(' · ')}</dd>
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
    sessionNames = typedNames();
    // With names, the table introduces itself first, one person at a time,
    // so each name is tied to a voice rather than to the order groups form.
    const introductions = sessionNames.length >= 2 && (count === null || count === sessionNames.length);
    session = await startLiveSession({
      names: sessionNames,
      ...(count !== null ? { speakerCount: count } : {}),
      backgroundVoices: bgVoices,
      introductions,
    });
    session.onUpdate(render);
    if (introductions) { introIndex = 0; session.introduce(0); }
  }
  capture.onAudio((samples) => session?.push(samples));
  capture.onEvent((detail) => session?.note('capture', detail));
  lastCaptureSettings = capture.settings();

  running = true;
  if (resetButton) resetButton.hidden = true;
  const exportWrap = $('export-wrap');
  if (exportWrap) exportWrap.hidden = true;
  if (namesInput) namesInput.disabled = true;
  if (countInput) countInput.disabled = true;
  setText('toggle', t('stop'));
  toggle?.classList.add('stopping');
  const introducing = session.state().phase === 'introductions';
  setText('badge-text', introducing ? t('introducing') : t('listening'));
  setText('hint', introducing ? t('introHint') : t('firstResultWait'));
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
  const exportWrap = $('export-wrap');
  if (exportWrap) exportWrap.hidden = !paused || (session?.state().samples ?? 0) === 0;
  if (namesInput) namesInput.disabled = paused;
  if (countInput) countInput.disabled = paused;
  refreshReady();
}

/** Forget the conversation and start clean. */
function reset() {
  session?.dispose();
  session = null;
  sessionNames = [];
  introIndex = 0;
  if (introPanel) introPanel.hidden = true;
  if (addWrap) addWrap.hidden = true;
  if (addForm) addForm.hidden = true;
  if (stallWrap) stallWrap.hidden = true;
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

/**
 * Hands over what the session kept — embeddings, timing, assignments — as a
 * file the benchmark can load. Never audio: there is none to hand over.
 */
function exportDiagnostics() {
  if (!session) return;
  const bundle = session.exportDiagnostics({
    version: __RONDA_VERSION__,
    capture: { userAgent: navigator.userAgent, ...(lastCaptureSettings ? { track: lastCaptureSettings } : {}) },
  });
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ronda-diagnostics-${bundle.exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The next person's turn, or — after the last — the conversation itself. */
function nextIntroduction() {
  if (!session) return;
  if (session.state().phase === 'conversation') {
    // Someone who joined has finished introducing themselves.
    session.endIntroduction();
    render(session.state());
    return;
  }
  if (session.state().phase !== 'introductions') return;
  if (introIndex >= sessionNames.length - 1) {
    session.startConversation();
    setText('hint', session.state().countHint.source === 'calibration' ? t('introDoneHint') : t('introSkippedHint'));
    setText('badge-text', t('listening'));
  } else {
    introIndex += 1;
    session.introduce(introIndex);
  }
  render(session.state());
}

/** Give up on the introductions: the conversation is grouped as before, names as labels. */
function skipIntroductions() {
  if (!session || session.state().phase !== 'introductions') return;
  session.startConversation();
  setText('hint', t('introSkippedHint'));
  if (running) setText('badge-text', t('listening'));
  render(session.state());
}

/** Someone joined after the introductions: a profile of their own, filled while they speak. */
function addPerson() {
  if (!session || !addName) return;
  const name = addName.value.trim();
  const index = session.addPerson(name);
  sessionNames[index] = name || `${t('listen') === 'Listen' ? 'Speaker' : 'Hablante'} ${index + 1}`;
  addName.value = '';
  if (addForm) addForm.hidden = true;
  introIndex = index;
  session.introduce(index);
  render(session.state());
}

toggle?.addEventListener('click', () => { void (running ? stop() : start()); });
introNext?.addEventListener('click', nextIntroduction);
introSkip?.addEventListener('click', skipIntroductions);
$('add-person')?.addEventListener('click', () => { if (addForm) { addForm.hidden = !addForm.hidden; if (!addForm.hidden) addName?.focus(); } });
$('add-go')?.addEventListener('click', addPerson);
addName?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPerson(); });
$('recover')?.addEventListener('click', () => { session?.recover(); void capture?.resume(); if (session) render(session.state()); });
resetButton?.addEventListener('click', reset);
exportButton?.addEventListener('click', exportDiagnostics);
