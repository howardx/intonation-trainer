import { describe, expect, test } from 'vitest';
import { midiToFlatName, sampleFor, SAMPLE_MIDIS } from './samples';

describe('midiToFlatName', () => {
  test('uses flat names matching the soundfont files', () => {
    expect(midiToFlatName(60)).toBe('C4');
    expect(midiToFlatName(61)).toBe('Db4');
    expect(midiToFlatName(70)).toBe('Bb4');
    expect(midiToFlatName(21)).toBe('A0');
    expect(midiToFlatName(108)).toBe('C8');
  });
});

describe('sample grid', () => {
  test('covers C1..C8 every 3 semitones', () => {
    expect(SAMPLE_MIDIS[0]).toBe(24);
    expect(SAMPLE_MIDIS[SAMPLE_MIDIS.length - 1]).toBe(108);
    expect(SAMPLE_MIDIS).toHaveLength(29);
  });

  test('exact grid note plays at rate 1', () => {
    expect(sampleFor(60)).toEqual({ file: 'C4', rate: 1 });
  });

  test('neighbors pitch-shift by at most one semitone', () => {
    expect(sampleFor(61)).toEqual({ file: 'C4', rate: Math.pow(2, 1 / 12) });
    expect(sampleFor(62)).toEqual({ file: 'Eb4', rate: Math.pow(2, -1 / 12) });
  });

  test('out-of-grid midi clamps to nearest sample', () => {
    expect(sampleFor(21).file).toBe('C1');
    expect(sampleFor(21).rate).toBeCloseTo(Math.pow(2, -3 / 12), 6);
  });
});
