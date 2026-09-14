import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const BROWSER = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly',
  WebAssembly: 'readonly', AudioWorkletNode: 'readonly', crossOriginIsolated: 'readonly',
  AudioContext: 'readonly', OfflineAudioContext: 'readonly', Worker: 'readonly',
  fetch: 'readonly', performance: 'readonly', caches: 'readonly', URL: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  Float32Array: 'readonly', Int16Array: 'readonly', WakeLockSentinel: 'readonly',
};
const NODE = {
  console: 'readonly', process: 'readonly', URL: 'readonly', __dirname: 'readonly',
  fetch: 'readonly', Buffer: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist/', 'spike/', 'public/', 'example/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  { files: ['src/**/*.ts'], languageOptions: { globals: BROWSER } },
  { files: ['scripts/**/*.mjs', '*.config.{js,ts}'], languageOptions: { globals: NODE } },
);
