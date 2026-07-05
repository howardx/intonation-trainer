import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AudioEngine } from './audio';

/**
 * Minimal Web Audio fake — just enough surface for AudioEngine's
 * bookkeeping (envelope scheduling, polyphony map, master gain).
 */
class FakeParam {
  value = 0;
  events: Array<{ kind: string; value: number; time: number }> = [];
  constructor(initial: number) {
    this.value = initial;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    if (value <= 0) throw new Error('exponential ramp target must be > 0');
    this.events.push({ kind: 'expRamp', value, time });
    this.value = value;
  }
  setTargetAtTime(value: number, time: number, _tc: number) {
    this.events.push({ kind: 'target', value, time });
    this.value = value;
  }
  cancelScheduledValues(_time: number) {
    this.events.push({ kind: 'cancel', value: 0, time: _time });
  }
}

class FakeGainNode {
  gain = new FakeParam(1);
  connected: unknown[] = [];
  connect(dest: unknown) {
    this.connected.push(dest);
    return dest;
  }
  disconnect() {}
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam(0);
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  connect(dest: unknown) {
    return dest;
  }
  start(t: number) {
    this.started = t;
  }
  stop(t: number) {
    this.stopped = t;
  }
  disconnect() {}
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGainNode[] = [];
  resumed = false;
  createOscillator() {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = new FakeGainNode();
    this.gains.push(g);
    return g;
  }
  async resume() {
    this.resumed = true;
  }
}

let lastCtx: FakeAudioContext;

beforeEach(() => {
  vi.stubGlobal(
    'AudioContext',
    class extends FakeAudioContext {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastCtx = this;
      }
    },
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AudioEngine polyphony', () => {
  test('noteOn starts an oscillator at the right frequency and marks it active', () => {
    const e = new AudioEngine();
    e.noteOn(69);
    expect(e.isOn(69)).toBe(true);
    expect(lastCtx.oscillators).toHaveLength(1);
    expect(lastCtx.oscillators[0].frequency.value).toBeCloseTo(440, 6);
    expect(lastCtx.oscillators[0].started).not.toBeNull();
  });

  test('noteOn is idempotent while a note is held', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.noteOn(60);
    expect(lastCtx.oscillators).toHaveLength(1);
  });

  test('two notes at once ring together (interval)', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.noteOn(64);
    expect(e.isOn(60)).toBe(true);
    expect(e.isOn(64)).toBe(true);
    expect(lastCtx.oscillators).toHaveLength(2);
  });

  test('noteOff releases with a ramp then stops the oscillator', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.noteOff(60);
    expect(e.isOn(60)).toBe(false);
    const osc = lastCtx.oscillators[0];
    expect(osc.stopped).not.toBeNull();
    const noteGain = lastCtx.gains.find((g) =>
      g.gain.events.some((ev) => ev.kind === 'expRamp' && ev.value < 0.01),
    );
    expect(noteGain).toBeDefined();
  });

  test('noteOff on a silent note is a safe no-op', () => {
    const e = new AudioEngine();
    expect(() => e.noteOff(60)).not.toThrow();
  });
});

describe('AudioEngine envelopes', () => {
  test('attack ramps up from near-zero — never a bare full-gain start', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    const noteGain = lastCtx.gains[1] ?? lastCtx.gains[0];
    const perNote = lastCtx.gains.find((g) => g !== lastCtx.gains[0]) ?? noteGain;
    const events = perNote.gain.events;
    expect(events[0].kind).toBe('set');
    expect(events[0].value).toBeLessThanOrEqual(0.001);
    expect(events.some((ev) => ev.kind === 'expRamp' && ev.value === 1)).toBe(true);
  });
});

describe('AudioEngine controls', () => {
  test('setVolume before first note is applied to the master gain on creation', () => {
    const e = new AudioEngine();
    e.setVolume(0.7);
    e.noteOn(60);
    const master = lastCtx.gains[0];
    expect(master.gain.value).toBeCloseTo(0.7, 6);
  });

  test('setVolume live-adjusts the master gain smoothly', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.setVolume(0.5);
    const master = lastCtx.gains[0];
    expect(master.gain.events.some((ev) => ev.kind === 'target' && ev.value === 0.5)).toBe(true);
  });

  test('setWaveform retypes active oscillators and future notes', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.setWaveform('triangle');
    expect(lastCtx.oscillators[0].type).toBe('triangle');
    e.noteOn(64);
    expect(lastCtx.oscillators[1].type).toBe('triangle');
  });

  test('resume resumes the shared context (audio unlock)', async () => {
    const e = new AudioEngine();
    await e.resume();
    expect(lastCtx.resumed).toBe(true);
  });
});

describe('AudioEngine blip (short mode)', () => {
  test('blip auto-releases after the given duration', () => {
    const e = new AudioEngine();
    e.blip(60, 350);
    expect(e.isOn(60)).toBe(true);
    vi.advanceTimersByTime(360);
    expect(e.isOn(60)).toBe(false);
  });

  test('rapid re-taps retrigger instead of silently no-oping', () => {
    const e = new AudioEngine();
    e.blip(60, 350);
    vi.advanceTimersByTime(100);
    e.blip(60, 350);
    // second blip must spin up a fresh oscillator, not ride the first
    expect(lastCtx.oscillators).toHaveLength(2);
    // and the first blip's stale timeout must not kill the second note early
    vi.advanceTimersByTime(300); // t=400: past first blip's 350ms deadline
    expect(e.isOn(60)).toBe(true);
    vi.advanceTimersByTime(100); // t=500: second blip expires
    expect(e.isOn(60)).toBe(false);
  });
});
