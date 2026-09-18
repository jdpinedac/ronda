/**
 * Noticing a voice that never introduced itself.
 *
 * With profiles, every sample goes to the nearest one, so a person who joins
 * after the introductions is silently credited to whoever they sound most
 * like. Their samples do leave a trace: they sit far from every profile. One
 * far sample means nothing — a known voice turning away from the phone does
 * that — but several of them, adding up to a few seconds, close together in
 * time, are worth a question to the person holding the phone. Ronda asks;
 * it never adds a person on its own (ADR 0012).
 */

export interface NewVoiceRule {
  /** Cosine distance to the nearest profile above which a sample counts as far. */
  farDistance: number;
  /** A suggestion needs at least this many far samples… */
  minSamples: number;
  /** …adding up to at least this much speech… */
  minMs: number;
  /** …all heard within this span of time. */
  withinMs: number;
}

export interface FarSample {
  /** When it started, in the conversation's clock. */
  at: number;
  ms: number;
  /** Position of the sample in the session's vectors, when known. */
  index?: number;
  /** Anything the caller wants to carry along (the benchmark uses the annotated speaker). */
  meta?: string;
}

export interface Observation extends FarSample {
  distance: number;
}

export interface NewVoiceSuggestion {
  run: FarSample[];
  /** Start of the first far sample in the run. */
  sinceMs: number;
}

/** After a dismissal, far samples within this span of the dismissed run are ignored. */
const QUIET_AFTER_DISMISS_MS = 120_000;

export class NewVoiceWatch {
  private run: FarSample[] = [];
  private dismissedUntil = -Infinity;

  constructor(private readonly rule: NewVoiceRule) {}

  /** Feeds one attributed sample; returns a suggestion when the rule is met, else null. */
  observe(o: Observation): NewVoiceSuggestion | null {
    if (o.distance <= this.rule.farDistance) return null;
    if (o.at < this.dismissedUntil) { this.dismissedUntil = o.at + QUIET_AFTER_DISMISS_MS; return null; }
    const { distance: _d, ...sample } = o;
    this.run = this.run.filter((s) => o.at - s.at <= this.rule.withinMs);
    this.run.push(sample);
    const ms = this.run.reduce((a, s) => a + s.ms, 0);
    if (this.run.length < this.rule.minSamples || ms < this.rule.minMs) return null;
    return { run: [...this.run], sinceMs: this.run[0]!.at };
  }

  /** The person at the table said nobody new is here: forget this run and stay quiet a while. */
  dismiss(): void {
    const last = this.run[this.run.length - 1];
    this.dismissedUntil = (last?.at ?? 0) + QUIET_AFTER_DISMISS_MS;
    this.run = [];
  }

  /** The run became a profile: start afresh. */
  reset(): void {
    this.run = [];
    this.dismissedUntil = -Infinity;
  }
}
