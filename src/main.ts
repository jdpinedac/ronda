import { detectCapabilities, isSupported } from './capabilities.js';
import { resolveLocale, createTranslator } from './ui/i18n.js';

const t = createTranslator(resolveLocale(navigator.languages ?? [navigator.language]));

const tagline = document.getElementById('tagline');
if (tagline) tagline.textContent = t('tagline');

// Scaffolding milestone: report what this browser can do. Replaced by the
// real interface once the engine lands.
const caps = detectCapabilities();
const status = document.getElementById('status');
if (status) {
  const row = (label: string, ok: boolean, detail = ok ? 'yes' : 'no') =>
    `<dt>${label}</dt><dd class="${ok ? 'yes' : 'no'}">${detail}</dd>`;
  status.innerHTML = isSupported(caps)
    ? `<dl>
        ${row('WebAssembly', caps.wasm)}
        ${row('AudioWorklet', caps.audioWorklet)}
        ${row('Microphone API', caps.microphone)}
        ${row('Cross-origin isolated', caps.crossOriginIsolated)}
        ${row('WebGPU', caps.webgpu)}
        ${row('Cores', caps.threads > 1, String(caps.threads))}
      </dl>`
    : `<p class="no">${t('unsupported')}</p>`;
}
