import { midiToFreq } from './notes';

const ATTACK_S = 0.02; // 20 ms ramp up — no click on start
const RELEASE_S = 0.05; // 50 ms ramp down — no click on stop
const SILENT = 0.0001; // exponential ramps cannot target 0

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  blipTimer?: ReturnType<typeof setTimeout>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Map<number, Voice>();
  private volume = 0.3;
  private waveform: OscillatorType = 'sine';

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

  setWaveform(t: OscillatorType): void {
    this.waveform = t;
    this.active.forEach(({ osc }) => (osc.type = t));
  }

  getWaveform(): OscillatorType {
    return this.waveform;
  }

  noteOn(midi: number): void {
    const ctx = this.ensure();
    if (this.active.has(midi)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = midiToFreq(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, now);
    gain.gain.exponentialRampToValueAtTime(1, now + ATTACK_S);
    osc.connect(gain).connect(this.master!);
    osc.start(now);
    this.active.set(midi, { osc, gain });
  }

  noteOff(midi: number): void {
    const voice = this.active.get(midi);
    if (!voice || !this.ctx) return;
    if (voice.blipTimer !== undefined) clearTimeout(voice.blipTimer);
    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, SILENT), now);
    voice.gain.gain.exponentialRampToValueAtTime(SILENT, now + RELEASE_S);
    voice.osc.stop(now + RELEASE_S + 0.01);
    voice.osc.onended = () => {
      voice.osc.disconnect();
      voice.gain.disconnect();
    };
    this.active.delete(midi);
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
