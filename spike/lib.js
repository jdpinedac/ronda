// THROWAWAY Phase 0 spike helpers.
import { execFileSync } from 'node:child_process';

/** Decode any audio file to 16 kHz mono Float32Array via ffmpeg. */
export function readAudio16k(path) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le',
    '-ac', '1', '-ar', '16000', 'pipe:1',
  ], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
