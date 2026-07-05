import { describe, expect, test } from 'vitest';
import { midiToFreq, NOTES, LOWEST_MIDI, HIGHEST_MIDI } from './notes';

describe('midiToFreq', () => {
  test('A4 (midi 69) is exactly 440 Hz', () => {
    expect(midiToFreq(69)).toBe(440);
  });

  test('matches the 12-TET reference table', () => {
    expect(midiToFreq(48)).toBeCloseTo(130.81, 2); // C3
    expect(midiToFreq(60)).toBeCloseTo(261.63, 2); // C4
    expect(midiToFreq(72)).toBeCloseTo(523.25, 2); // C5
    expect(midiToFreq(58)).toBeCloseTo(233.08, 2); // A#3
    expect(midiToFreq(66)).toBeCloseTo(369.99, 2); // F#4
  });

  test('octaves double in frequency', () => {
    expect(midiToFreq(72)).toBeCloseTo(midiToFreq(60) * 2, 6);
  });
});

describe('NOTES table (C3–C5)', () => {
  test('spans midi 48 through 72 inclusive — 25 keys', () => {
    expect(LOWEST_MIDI).toBe(48);
    expect(HIGHEST_MIDI).toBe(72);
    expect(NOTES).toHaveLength(25);
    expect(NOTES[0].midi).toBe(48);
    expect(NOTES[24].midi).toBe(72);
  });

  test('has 15 white keys and 10 black keys', () => {
    expect(NOTES.filter((n) => !n.isBlack)).toHaveLength(15);
    expect(NOTES.filter((n) => n.isBlack)).toHaveLength(10);
  });

  test('note names include octave numbers', () => {
    const byMidi = new Map(NOTES.map((n) => [n.midi, n]));
    expect(byMidi.get(48)!.name).toBe('C3');
    expect(byMidi.get(49)!.name).toBe('C#3');
    expect(byMidi.get(63)!.name).toBe('D#4');
    expect(byMidi.get(69)!.name).toBe('A4');
    expect(byMidi.get(72)!.name).toBe('C5');
  });

  test('white keys carry fixed-do solfège, C = do', () => {
    const byMidi = new Map(NOTES.map((n) => [n.midi, n]));
    expect(byMidi.get(48)!.solfege).toBe('do'); // C3
    expect(byMidi.get(50)!.solfege).toBe('re'); // D3
    expect(byMidi.get(52)!.solfege).toBe('mi'); // E3
    expect(byMidi.get(53)!.solfege).toBe('fa'); // F3
    expect(byMidi.get(55)!.solfege).toBe('sol'); // G3
    expect(byMidi.get(57)!.solfege).toBe('la'); // A3
    expect(byMidi.get(59)!.solfege).toBe('ti'); // B3
    expect(byMidi.get(72)!.solfege).toBe('do'); // top C5 is "do"
  });

  test('black keys have no solfège', () => {
    for (const n of NOTES.filter((n) => n.isBlack)) {
      expect(n.solfege).toBeNull();
    }
  });
});
