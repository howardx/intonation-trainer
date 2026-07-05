import { midiToFreq } from './notes';
import { sampleFor } from './samples';

const ATTACK_S = 0.02; // 20 ms ramp up — no click on start
const RELEASE_S = 0.05; // 50 ms ramp down — no click on stop
const SILENT = 0.0001; // exponential ramps cannot target 0

export type Instrument = 'pure' | 'piano' | 'strings' | 'choir';

/** Rough loudness trims so switching instruments doesn't jump in volume. */
const TRIM: Record<Instrument, number> = { pure: 0.9, piano: 1.5, strings: 1.2, choir: 1.3 };

/** Sustaining instruments: drone via crossfade-looped sample segments. */
const LOOPING = new Set<Instrument>(['strings', 'choir']);

const XFADE_S = 0.4; // crossfade overlap between looped segments
const LOOKAHEAD_S = 0.5; // schedule the next segment this far ahead

// equal-power fade curves (half-cosine) for seamless segment overlap
const CURVE_N = 33;
const FADE_IN = new Float32Array(CURVE_N).map((_, i) =>
  Math.sin((Math.PI / 2) * (i / (CURVE_N - 1))),
);
const FADE_OUT = new Float32Array(CURVE_N).map((_, i) =>
  Math.cos((Math.PI / 2) * (i / (CURVE_N - 1))),
);

type Voice =
  | { kind: 'osc'; node: OscillatorNode; gain: GainNode; blipTimer?: ReturnType<typeof setTimeout> }
  | {
      kind: 'buffer';
      node: AudioBufferSourceNode;
      gain: GainNode;
      blipTimer?: ReturnType<typeof setTimeout>;
    }
  | {
      kind: 'loop';
      parts: Array<{ src: AudioBufferSourceNode; g: GainNode }>;
      gain: GainNode;
      timer?: ReturnType<typeof setTimeout>;
      blipTimer?: ReturnType<typeof setTimeout>;
    }
  | { kind: 'pending'; blipTimer?: ReturnType<typeof setTimeout> };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Map<number, Voice>();
  private volume = 0.55;
  private instrument: Instrument = 'pure';
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();

  /** Fired when a sampled note ends by natural decay (piano). */
  onNoteEnded: ((midi: number) => void) | null = null;

  private ensure(): AudioContext {
    if (!this.ctx) {
      // iOS 16.4+: without this, the hardware silent switch mutes Web Audio.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (typeof navigator !== 'undefined' && nav.audioSession) {
        try {
          nav.audioSession.type = 'playback';
        } catch {
          /* older iOS — ignore */
        }
      }
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // gentle safety limiter: louder defaults + stacked drones must not clip
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 20;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Attempt to unlock audio. WebKit rejects resume() from gestures it does
   * not consider activation events (e.g. pointerdown/touchstart), so this
   * must be safe to call repeatedly until isRunning() reports true.
   */
  async resume(): Promise<void> {
    try {
      await this.ensure().resume();
    } catch {
      /* not a valid activation gesture yet — caller will retry */
    }
  }

  isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }
  }

  setInstrument(i: Instrument): void {
    this.instrument = i;
  }

  getInstrument(): Instrument {
    return this.instrument;
  }

  private sampleKey(midi: number): string {
    return `${this.instrument}/${sampleFor(midi).file}`;
  }

  private async loadBuffer(key: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) return cached;
    let inflight = this.loading.get(key);
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await fetch(`samples/${key}.mp3`);
          if (!res.ok) return null;
          const buf = await this.ensure().decodeAudioData(await res.arrayBuffer());
          this.buffers.set(key, buf);
          return buf;
        } catch {
          return null; // offline before precache finished, or decode failure
        } finally {
          this.loading.delete(key);
        }
      })();
      this.loading.set(key, inflight);
    }
    return inflight;
  }

  /** Warm the cache for a set of notes (e.g. the visible octave window). */
  async preload(midis: number[]): Promise<void> {
    if (this.instrument === 'pure') return;
    const keys = [...new Set(midis.map((m) => this.sampleKey(m)))];
    await Promise.all(keys.map((k) => this.loadBuffer(k)));
  }

  noteOn(midi: number): void {
    const ctx = this.ensure();
    if (this.active.has(midi)) return;
    if (this.instrument === 'pure') {
      this.startOscVoice(ctx, midi);
    } else {
      this.startBufferVoice(ctx, midi);
    }
  }

  private startOscVoice(ctx: AudioContext, midi: number): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);
    const gain = this.envelopeIn(ctx, TRIM.pure, now);
    osc.connect(gain).connect(this.master!);
    osc.start(now);
    this.active.set(midi, { kind: 'osc', node: osc, gain });
  }

  private startBufferVoice(ctx: AudioContext, midi: number): void {
    const instrument = this.instrument;
    const key = this.sampleKey(midi);
    const buffer = this.buffers.get(key);
    if (!buffer) {
      // Mark as on immediately (key lights up), play when the sample arrives.
      this.active.set(midi, { kind: 'pending' });
      void this.loadBuffer(key).then((buf) => {
        const voice = this.active.get(midi);
        if (!buf || !voice || voice.kind !== 'pending') return; // released meanwhile
        this.active.delete(midi);
        if (this.instrument === instrument) this.startBufferVoice(ctx, midi);
        else this.active.delete(midi);
      });
      return;
    }
    if (LOOPING.has(instrument)) {
      this.startLoopingVoice(ctx, midi, buffer, TRIM[instrument]);
      return;
    }
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = sampleFor(midi).rate;
    const gain = this.envelopeIn(ctx, TRIM[instrument], now);
    src.connect(gain).connect(this.master!);
    src.start(now);
    src.onended = () => {
      // natural decay (piano) — release bookkeeping + tell the UI
      const voice = this.active.get(midi);
      if (voice && voice.kind === 'buffer' && voice.node === src) {
        this.active.delete(midi);
        src.disconnect();
        gain.disconnect();
        this.onNoteEnded?.(midi);
      }
    };
    this.active.set(midi, { kind: 'buffer', node: src, gain });
  }

  /**
   * Endless drone from a finite sample: alternate overlapping segments of
   * the sample's steady middle, equal-power crossfaded — no hard loop seam.
   */
  private startLoopingVoice(
    ctx: AudioContext,
    midi: number,
    buffer: AudioBuffer,
    trim: number,
  ): void {
    const now = ctx.currentTime;
    const rate = sampleFor(midi).rate;
    const loopStart = Math.min(0.8, buffer.duration * 0.25);
    const loopEnd = Math.min(buffer.duration, Math.max(loopStart + 1.2, buffer.duration * 0.9));
    const segment = loopEnd - loopStart;
    const gain = this.envelopeIn(ctx, trim, now);
    gain.connect(this.master!);

    const parts: Array<{ src: AudioBufferSourceNode; g: GainNode }> = [];
    const voice: Voice = { kind: 'loop', parts, gain };

    const spawn = (when: number, offset: number, dur: number, fadeIn: boolean) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      if (fadeIn) {
        g.gain.value = 0;
        g.gain.setValueCurveAtTime(FADE_IN, when, XFADE_S);
      }
      g.gain.setValueCurveAtTime(FADE_OUT, when + dur - XFADE_S, XFADE_S);
      src.connect(g).connect(gain);
      src.start(when, offset, dur + 0.05);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      parts.push({ src, g });
      if (parts.length > 3) parts.splice(0, parts.length - 3); // keep only live parts
    };

    // first pass plays the natural attack, fading out at the segment's end
    spawn(now, 0, loopEnd, false);
    let nextWhen = now + loopEnd - XFADE_S;
    const scheduleNext = () => {
      spawn(nextWhen, loopStart, segment, true);
      nextWhen += segment - XFADE_S;
      const delayMs = Math.max(0, (nextWhen - LOOKAHEAD_S - ctx.currentTime) * 1000);
      voice.timer = setTimeout(scheduleNext, delayMs);
    };
    voice.timer = setTimeout(
      scheduleNext,
      Math.max(0, (nextWhen - LOOKAHEAD_S - ctx.currentTime) * 1000),
    );
    this.active.set(midi, voice);
  }

  private envelopeIn(ctx: AudioContext, peak: number, now: number): GainNode {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + ATTACK_S);
    return gain;
  }

  noteOff(midi: number): void {
    const voice = this.active.get(midi);
    if (!voice || !this.ctx) return;
    if (voice.blipTimer !== undefined) clearTimeout(voice.blipTimer);
    this.active.delete(midi);
    if (voice.kind === 'pending') return; // sample never arrived — nothing rings
    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, SILENT), now);
    voice.gain.gain.exponentialRampToValueAtTime(SILENT, now + RELEASE_S);
    if (voice.kind === 'loop') {
      if (voice.timer !== undefined) clearTimeout(voice.timer);
      const gain = voice.gain;
      for (const part of voice.parts) {
        try {
          part.src.stop(now + RELEASE_S + 0.01);
        } catch {
          /* already ended */
        }
      }
      setTimeout(() => gain.disconnect(), (RELEASE_S + 0.05) * 1000);
      return;
    }
    const node = voice.node;
    const gain = voice.gain;
    node.onended = () => {
      node.disconnect();
      gain.disconnect();
    };
    node.stop(now + RELEASE_S + 0.01);
  }

  /** Short-mode note: ~350 ms then auto-release. Re-taps retrigger cleanly. */
  blip(midi: number, durMs = 350): void {
    if (this.active.has(midi)) this.noteOff(midi); // retrigger, don't no-op
    this.noteOn(midi);
    const voice = this.active.get(midi);
    if (voice) {
      voice.blipTimer = setTimeout(() => this.noteOff(midi), durMs);
    }
  }

  stopAll(): void {
    for (const midi of [...this.active.keys()]) this.noteOff(midi);
  }

  isOn(midi: number): boolean {
    return this.active.has(midi);
  }

  activeNotes(): number[] {
    return [...this.active.keys()];
  }
}

/**
 * Retry AudioContext.resume() on every gesture until the context runs, then
 * detach. pointerdown alone is NOT enough: WebKit (all iOS browsers) only
 * grants audio activation on touchend/click/keydown — a pointerdown-only
 * unlock leaves iPhones permanently silent.
 */
export function installAudioUnlock(
  engine: AudioEngine,
  target: EventTarget = window,
): () => void {
  const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const tryUnlock = () => {
    void engine.resume().then(() => {
      if (engine.isRunning()) cleanup();
    });
  };
  const cleanup = () => {
    for (const ev of events) target.removeEventListener(ev, tryUnlock, { capture: true });
  };
  for (const ev of events) target.addEventListener(ev, tryUnlock, { capture: true });
  return cleanup;
}
