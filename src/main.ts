import { detectCapabilities, isSupported } from './capabilities.js';
import { resolveLocale, createTranslator } from './ui/i18n.js';

const t = createTranslator(resolveLocale(navigator.languages ?? [navigator.language]));

const setText = (id: string, value: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

setText('tagline', t('tagline'));
setText('live-cta', t('liveCta'));
setText('live-cta-body', t('liveCtaBody'));
setText('live-link', t('listen'));
setText('analyse-cta', t('analyseCta'));
setText('analyse-cta-body', t('analyseCtaBody'));
setText('analyse-link', t('analyse'));
setText('device-title', t('thisDevice'));
setText('release', t('releaseNotice').replace('{version}', __RONDA_VERSION__));
setText('version', `Ronda ${__RONDA_VERSION__}`);

// Until the interface exists, the most useful thing this page can do is tell
// someone whether the phone they want to put on the table is up to the job.
const caps = detectCapabilities();
const status = document.getElementById('status');
if (status) {
  if (!isSupported(caps)) {
    status.innerHTML = `<p class="no">${t('unsupported')}</p>`;
  } else {
    const row = (label: string, ok: boolean, detail = ok ? '✓' : '✗') =>
      `<dt>${label}</dt><dd class="${ok ? 'yes' : 'no'}">${detail}</dd>`;
    status.innerHTML = `<p class="ready">${t('deviceReady')}</p><dl>
      ${row('WebAssembly', caps.wasm)}
      ${row('AudioWorklet', caps.audioWorklet)}
      ${row('Microphone', caps.microphone)}
      ${row('Multi-threaded WASM', caps.crossOriginIsolated)}
      ${row('WebGPU', caps.webgpu)}
      ${row('Cores', caps.threads > 1, String(caps.threads))}
    </dl>`;
  }
}
