import { midiToFreq } from './notes';
import { sampleFor } from './samples';

const ATTACK_S = 0.02; // 20 ms ramp up — no click on start
const RELEASE_S = 0.05; // 50 ms ramp down — no click on stop
const SILENT = 0.0001; // exponential ramps cannot target 0

export type Instrument = 'pure' | 'piano' | 'strings';

/** Rough loudness trims so switching instruments doesn't jump in volume. */
const TRIM: Record<Instrument, number> = { pure: 0.9, piano: 1.5, strings: 1.2 };

type Voice =
  | { kind: 'osc'; node: OscillatorNode; gain: GainNode; blipTimer?: ReturnType<typeof setTimeout> }
  | {
      kind: 'buffer';
      node: AudioBufferSourceNode;
      gain: GainNode;
      blipTimer?: ReturnType<typeof setTimeout>;
    }
  | { kind: 'pending'; blipTimer?: ReturnType<typeof setTimeout> };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Map<number, Voice>();
  private volume = 0.3;
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
      this.master.connect(this.ctx.destination);
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
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = sampleFor(midi).rate;
    if (instrument === 'strings') {
      // loop the steady middle of the ensemble sample so drones ring forever
      src.loop = true;
      src.loopStart = Math.min(1, buffer.duration * 0.3);
      src.loopEnd = buffer.duration * 0.85;
    }
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
