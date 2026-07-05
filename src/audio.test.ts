import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AudioEngine, installAudioUnlock } from './audio';

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
  setValueCurveAtTime(curve: Float32Array, time: number, _dur: number) {
    this.events.push({ kind: 'curve', value: curve[curve.length - 1], time });
    this.value = curve[curve.length - 1];
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

class FakeBufferSource {
  buffer: unknown = null;
  playbackRate = new FakeParam(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: number | null = null;
  startOffset = 0;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  connect(dest: unknown) {
    return dest;
  }
  start(t: number, offset = 0) {
    this.started = t;
    this.startOffset = offset;
  }
  stop(t: number) {
    this.stopped = t;
  }
  disconnect() {}
}

class FakeCompressor {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  connected: unknown[] = [];
  connect(dest: unknown) {
    this.connected.push(dest);
    return dest;
  }
  disconnect() {}
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGainNode[] = [];
  bufferSources: FakeBufferSource[] = [];
  decoded = 0;
  resumed = false;
  state = 'suspended';
  /** iOS-style behavior: resume() only succeeds when the fake allows it. */
  unlockable = true;
  resumeCalls = 0;
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
  createBufferSource() {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }
  compressors: FakeCompressor[] = [];
  createDynamicsCompressor() {
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  }
  async decodeAudioData(_ab: ArrayBuffer) {
    this.decoded++;
    return { duration: 3 };
  }
  async resume() {
    this.resumeCalls++;
    if (!this.unlockable) throw new DOMException('gesture required', 'NotAllowedError');
    this.resumed = true;
    this.state = 'running';
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
    expect(events.some((ev) => ev.kind === 'expRamp' && ev.value > 0.5)).toBe(true);
  });
});

describe('AudioEngine controls', () => {
  test('default volume is 0.55 and the chain runs through a safety compressor', () => {
    const e = new AudioEngine();
    e.noteOn(60);
    const master = lastCtx.gains[0];
    expect(master.gain.value).toBeCloseTo(0.55, 6);
    expect(lastCtx.compressors).toHaveLength(1);
    expect(master.connected).toContain(lastCtx.compressors[0]);
  });

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

  test('resume resumes the shared context (audio unlock)', async () => {
    const e = new AudioEngine();
    await e.resume();
    expect(lastCtx.resumed).toBe(true);
  });
});

describe('audio unlock (mobile gesture requirements)', () => {
  // fake-timer-safe flush: drain several microtask hops (resume → then → cleanup)
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  test('resume survives NotAllowedError (WebKit rejects non-activation gestures)', async () => {
    const e = new AudioEngine();
    e.noteOn(60); // creates the ctx
    lastCtx.unlockable = false;
    await expect(e.resume()).resolves.toBeUndefined();
  });

  test('unlock retries on every gesture type until the context runs', async () => {
    const e = new AudioEngine();
    e.noteOn(60); // creates the (suspended) ctx so we can lock it first
    lastCtx.unlockable = false;
    const target = new EventTarget();
    installAudioUnlock(e, target);

    // iOS: pointerdown fires but is not a valid activation — resume fails
    target.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(lastCtx.resumeCalls).toBeGreaterThan(0);
    expect(lastCtx.state).toBe('suspended');

    // more pointerdowns keep failing, but we must keep trying
    target.dispatchEvent(new Event('pointerdown'));
    await flush();
    const callsAfterSecond = lastCtx.resumeCalls;
    expect(callsAfterSecond).toBeGreaterThan(1);

    // touchend IS a valid activation on WebKit — this one must unlock
    lastCtx.unlockable = true;
    target.dispatchEvent(new Event('touchend'));
    await flush();
    expect(lastCtx.state).toBe('running');
  });

  test('listeners are removed once running — no resume spam afterwards', async () => {
    const e = new AudioEngine();
    const target = new EventTarget();
    installAudioUnlock(e, target);
    target.dispatchEvent(new Event('click'));
    await flush();
    expect(lastCtx.state).toBe('running');
    const settled = lastCtx.resumeCalls;
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('touchend'));
    await flush();
    expect(lastCtx.resumeCalls).toBe(settled);
  });
});

describe('sampled instruments', () => {
  const flushMicro = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
  });

  test('piano noteOn plays a pitch-shifted buffer source after preload', async () => {
    const e = new AudioEngine();
    e.setInstrument('piano');
    await e.preload([61]);
    e.noteOn(61);
    expect(e.isOn(61)).toBe(true);
    expect(lastCtx.bufferSources).toHaveLength(1);
    const src = lastCtx.bufferSources[0];
    expect(src.playbackRate.value).toBeCloseTo(Math.pow(2, 1 / 12), 6);
    expect(src.started).not.toBeNull();
    expect(src.loop).toBe(false); // piano decays naturally
  });

  test('strings drone crossfade-loops: partner sources spawn seamlessly', async () => {
    const e = new AudioEngine();
    e.setInstrument('strings');
    await e.preload([60]);
    e.noteOn(60);
    expect(lastCtx.bufferSources).toHaveLength(1);
    expect(lastCtx.bufferSources[0].loop).toBe(false); // no hard loop seam
    await vi.advanceTimersByTimeAsync(3000); // past the first segment boundary
    expect(lastCtx.bufferSources.length).toBeGreaterThanOrEqual(2);
    // the partner starts inside the sample (loop offset), with a fade-in curve
    const partner = lastCtx.bufferSources[1];
    expect(partner.startOffset).toBeGreaterThan(0);
    // chain keeps going while held (fake ctx clock is frozen, so scheduling
    // drifts later than real time — advance generously)
    await vi.advanceTimersByTimeAsync(12000);
    expect(lastCtx.bufferSources.length).toBeGreaterThanOrEqual(4);
  });

  test('noteOff stops the crossfade chain', async () => {
    const e = new AudioEngine();
    e.setInstrument('strings');
    await e.preload([60]);
    e.noteOn(60);
    await vi.advanceTimersByTimeAsync(3000);
    e.noteOff(60);
    const countAtRelease = lastCtx.bufferSources.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(lastCtx.bufferSources.length).toBe(countAtRelease); // no new spawns
    expect(lastCtx.bufferSources.every((s) => s.stopped !== null)).toBe(true);
  });

  test('choir is a sampled sustaining instrument', async () => {
    const e = new AudioEngine();
    e.setInstrument('choir');
    await e.preload([60]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('samples/choir/C4.mp3');
    e.noteOn(60);
    await vi.advanceTimersByTimeAsync(3000);
    expect(lastCtx.bufferSources.length).toBeGreaterThanOrEqual(2); // loops like strings
  });

  test('each sample file is fetched and decoded once, then cached', async () => {
    const e = new AudioEngine();
    e.setInstrument('piano');
    await e.preload([60, 61]); // both resolve to C4.mp3
    await e.preload([60]);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(lastCtx.decoded).toBe(1);
  });

  test('noteOn before the buffer arrives still sounds once loaded', async () => {
    const e = new AudioEngine();
    e.setInstrument('piano');
    e.noteOn(60); // nothing cached yet
    expect(e.isOn(60)).toBe(true); // pending — key lights immediately
    await flushMicro();
    expect(lastCtx.bufferSources.length).toBe(1); // played on arrival
  });

  test('noteOff before the buffer arrives cancels the pending note', async () => {
    const e = new AudioEngine();
    e.setInstrument('piano');
    e.noteOn(60);
    e.noteOff(60);
    await flushMicro();
    expect(lastCtx.bufferSources.length).toBe(0);
    expect(e.isOn(60)).toBe(false);
  });

  test('piano natural decay ends the note and notifies the UI', async () => {
    const e = new AudioEngine();
    const ended: number[] = [];
    e.onNoteEnded = (m) => ended.push(m);
    e.setInstrument('piano');
    await e.preload([60]);
    e.noteOn(60);
    lastCtx.bufferSources[0].onended?.();
    expect(e.isOn(60)).toBe(false);
    expect(ended).toEqual([60]);
  });

  test('pure instrument still uses oscillators', async () => {
    const e = new AudioEngine();
    e.setInstrument('pure');
    e.noteOn(60);
    expect(lastCtx.oscillators).toHaveLength(1);
    expect(lastCtx.bufferSources).toHaveLength(0);
  });

  test('stopAll silences every ringing voice', async () => {
    const e = new AudioEngine();
    e.noteOn(60);
    e.noteOn(64);
    e.stopAll();
    expect(e.activeNotes()).toEqual([]);
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
