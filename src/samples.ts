/**
 * Sample grid for the recorded instruments: every 3rd semitone from C1 to C8
 * (FluidR3 soundfont, flat note names). Notes between grid points play the
 * nearest sample pitch-shifted via playbackRate — at most ±1 semitone, which
 * is inaudible as timbre distortion.
 */

const FLAT_PITCH_CLASSES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const midiToFlatName = (midi: number): string =>
  `${FLAT_PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;

export const SAMPLE_MIDIS: readonly number[] = Array.from(
  { length: (108 - 24) / 3 + 1 },
  (_, i) => 24 + i * 3,
);

export interface SampleRef {
  file: string; // flat note name without extension, e.g. "Eb4"
  rate: number; // playbackRate to reach the requested pitch
}

export function sampleFor(midi: number): SampleRef {
  let nearest = SAMPLE_MIDIS[0];
  for (const s of SAMPLE_MIDIS) {
    if (Math.abs(s - midi) < Math.abs(nearest - midi)) nearest = s;
  }
  return { file: midiToFlatName(nearest), rate: Math.pow(2, (midi - nearest) / 12) };
}
