import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/engine/models.js', () => import('./helpers/fake-models.js'));
import { startLiveSession } from '../src/engine/live.js';
import { conversation } from './helpers/fake-models.js';

/**
 * A field report is worth more than any fixture, and Ronda cannot ask for the
 * audio: it never keeps any. What it can hand over is what it kept — one
 * embedding per voice sample, when it was heard, how long it lasted, and
 * which person it was assigned to. That reproduces the session's clustering
 * exactly in the benchmark, and cannot be turned back into speech.
 */
const CONVERSATION = conversation([['A', 6], ['B', 5], ['A', 4], ['B', 6]]);

async function session() {
  const s = await startLiveSession({ speakerCount: 2, names: ['Ana', 'Juan'] });
  for (let off = 0; off < CONVERSATION.length; off += 16000) s.push(CONVERSATION.slice(off, Math.min(off + 16000, CONVERSATION.length)));
  for (;;) { const n = s.state().samples; await new Promise((r) => setTimeout(r, 20)); if (s.state().samples === n) break; }
  await s.flush();
  return s;
}

describe('exporting a session for diagnosis', () => {
  it('carries one embedding per voice sample, with its time, length and identity', async () => {
    const s = await session();
    const bundle = s.exportDiagnostics();
    const state = s.state();
    expect(bundle.vectors).toHaveLength(state.samples);
    expect(bundle.spans).toHaveLength(state.samples);
    expect(bundle.identities).toHaveLength(state.samples);
    expect(bundle.durationsMs).toHaveLength(state.samples);
    for (const v of bundle.vectors) expect(v.length).toBeGreaterThan(0);
    // Totals per identity in the bundle agree with what the screen showed.
    for (const sp of state.speakers) {
      const ms = bundle.identities.reduce((sum, id, i) => sum + (id === sp.id ? bundle.durationsMs[i]! + bundle.creditedMs[i]! : 0), 0);
      expect(ms).toBe(sp.totalMs);
    }
    s.dispose();
  });

  it('records how the session was set up, and how far it got', async () => {
    const s = await session();
    const b = s.exportDiagnostics();
    expect(b.speakerCount).toBe(2);
    expect(b.backgroundVoices).toBe(false);
    expect(b.elapsedMs).toBe(CONVERSATION.length / 16);
    expect(b.coveredToMs).toBe(CONVERSATION.length / 16);
    expect(b.format).toBe('ronda-diagnostics/1');
    expect(typeof b.version).toBe('string');
    s.dispose();
  });

  it('holds no audio, and no names', async () => {
    const s = await session();
    const b = s.exportDiagnostics() as unknown as Record<string, unknown>;
    const text = JSON.stringify(b);
    expect(text).not.toContain('Ana');
    expect(text).not.toContain('Juan');
    for (const key of Object.keys(b)) expect(['audio', 'samples', 'pcm', 'wav', 'names']).not.toContain(key);
    // The largest array is the embeddings; there must be nothing the size of audio.
    expect(text.length).toBeLessThan(200_000);
    s.dispose();
  });
});
