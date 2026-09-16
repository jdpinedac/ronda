/**
 * Microphone capture at 16 kHz mono.
 *
 * The browser resamples for us when the AudioContext is created at the target
 * rate, so no DSP is needed here. Capture runs in an AudioWorklet — on the
 * audio thread — so that inference on the main thread cannot cause dropouts.
 */

/** Runs on the audio thread. Batches samples and hands them over once a second. */
const WORKLET_SOURCE = `
class Collector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.count = 0;
    this.target = sampleRate; // one second
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.chunks.push(channel.slice());
      this.count += channel.length;
      if (this.count >= this.target) {
        const out = new Float32Array(this.count);
        let offset = 0;
        for (const c of this.chunks) { out.set(c, offset); offset += c.length; }
        this.port.postMessage(out, [out.buffer]);
        this.chunks = [];
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('collector', Collector);
`;

export interface Capture {
  /** Fires roughly once a second with 16 kHz mono samples. */
  onAudio: (handler: (samples: Float32Array) => void) => void;
  /** Current input level, 0..1, for the level meter. */
  level: () => number;
  /** What the device says it is doing to the audio: noise suppression, gain control, sample rate… */
  settings: () => Record<string, unknown>;
  stop: () => Promise<void>;
}

export const CAPTURE_RATE = 16000;

/**
 * An AudioContext only starts after a genuine user gesture. Called outside one,
 * resume() never settles, which would leave the interface saying "getting
 * ready" forever. Fail loudly instead.
 */
async function resumeOrThrow(ctx: AudioContext): Promise<void> {
  await Promise.race([
    ctx.resume(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('audio did not start; a button press is required')), 5000)),
  ]);
}

export async function startCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Echo cancellation stays on: it removes our own output, never a person.
      echoCancellation: true,
      // These two stay OFF deliberately. Noise suppression and automatic gain
      // control reshape timbre, which is the signal speaker identification
      // depends on. See ADR 0001.
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
  await resumeOrThrow(ctx);

  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const node = new AudioWorkletNode(ctx, 'collector');

  source.connect(analyser);
  source.connect(node);
  // The worklet produces no output; connecting it to a silent gain keeps it
  // scheduled in browsers that stop pulling on unconnected nodes.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(silent).connect(ctx.destination);

  const levelBuf = new Float32Array(analyser.fftSize);
  const handlers: ((s: Float32Array) => void)[] = [];
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    for (const h of handlers) h(e.data);
  };

  return {
    onAudio: (handler) => { handlers.push(handler); },
    settings: () => ({ ...(stream.getAudioTracks()[0]?.getSettings() ?? {}) }),
    level: () => {
      analyser.getFloatTimeDomainData(levelBuf);
      let sum = 0;
      for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i]! * levelBuf[i]!;
      return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4);
    },
    stop: async () => {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      analyser.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/**
 * A capture fed from an audio file instead of a microphone, so the live path
 * can be exercised end to end without a person in the room.
 */
export async function startFakeCapture(audio: Float32Array): Promise<Capture> {
  const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
  await resumeOrThrow(ctx);

  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const buffer = ctx.createBuffer(1, audio.length, CAPTURE_RATE);
  buffer.copyToChannel(Float32Array.from(audio) as Float32Array<ArrayBuffer>, 0);
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);

  const source = ctx.createMediaStreamSource(dest.stream);
  const node = new AudioWorkletNode(ctx, 'collector');
  source.connect(node);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(silent).connect(ctx.destination);

  // Start playing only once the graph is wired, so nothing is lost.
  src.start();

  const handlers: ((s: Float32Array) => void)[] = [];
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    for (const h of handlers) h(e.data);
  };
  return {
    onAudio: (h) => { handlers.push(h); },
    settings: () => ({ fake: true }),
    level: () => 0.5,
    stop: async () => { node.disconnect(); source.disconnect(); await ctx.close(); },
  };
}
