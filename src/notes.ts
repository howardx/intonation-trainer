export interface NoteInfo {
  midi: number;
  name: string; // e.g. "C3", "D#4"
  solfege: string | null; // fixed do (C = do); null on black keys
  isBlack: boolean;
}

export const LOWEST_MIDI = 48; // C3 (default window)
export const HIGHEST_MIDI = 72; // C5 (default window)

/** Valid 2-octave window starts: C1 through C6 (covering C1..C8). */
export const WINDOW_STARTS: readonly number[] = [24, 36, 48, 60, 72, 84];
export const DEFAULT_WINDOW_START = 48; // C3

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE: Record<string, string> = {
  C: 'do',
  D: 're',
  E: 'mi',
  F: 'fa',
  G: 'sol',
  A: 'la',
  B: 'ti',
};

function noteInfo(midi: number): NoteInfo {
  const pc = PITCH_CLASSES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  const isBlack = pc.includes('#');
  return {
    midi,
    name: `${pc}${octave}`,
    solfege: isBlack ? null : SOLFEGE[pc],
    isBlack,
  };
}

/** The 25 notes (C to C, two octaves) of a window starting at `startMidi`. */
export const windowNotes = (startMidi: number): NoteInfo[] =>
  Array.from({ length: 25 }, (_, i) => noteInfo(startMidi + i));

export const NOTES: readonly NoteInfo[] = windowNotes(DEFAULT_WINDOW_START);
