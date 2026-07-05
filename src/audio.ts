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
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Call on the first user gesture — iOS/Safari require it to unlock audio. */
  async resume(): Promise<void> {
    await this.ensure().resume();
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
