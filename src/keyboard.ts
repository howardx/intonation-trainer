import { NOTES, type NoteInfo } from './notes';

export interface KeyboardHandlers {
  /** Fired on pointerdown for any key. */
  onKeyDown: (midi: number) => void;
  /** Fired on pointerup / pointercancel for the same pointer's key. */
  onKeyUp: (midi: number) => void;
}

export interface Keyboard {
  element: HTMLElement;
  /** Reflect engine state: highlight keys whose midi is in the set. */
  setActive(active: ReadonlySet<number>): void;
}

const WHITE_COUNT = NOTES.filter((n) => !n.isBlack).length;

function buildKey(note: NoteInfo, whiteIndex: number): HTMLButtonElement {
  const key = document.createElement('button');
  key.type = 'button';
  key.className = note.isBlack ? 'key black' : 'key white';
  key.dataset.midi = String(note.midi);
  key.setAttribute('aria-label', note.name);

  const labels = document.createElement('span');
  labels.className = 'key-labels';

  if (!note.isBlack && note.solfege) {
    const solfege = document.createElement('span');
    solfege.className = 'label-solfege';
    solfege.textContent = note.solfege;
    labels.appendChild(solfege);
  }
  const name = document.createElement('span');
  name.className = 'label-name';
  name.textContent = note.name;
  labels.appendChild(name);
  key.appendChild(labels);

  if (note.isBlack) {
    // Center the black key on the boundary between its neighboring whites.
    const boundary = (whiteIndex / WHITE_COUNT) * 100;
    key.style.left = `${boundary}%`;
  }
  return key;
}

export function createKeyboard(handlers: KeyboardHandlers): Keyboard {
  const board = document.createElement('div');
  board.className = 'keyboard';
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Piano keyboard C3 to C5');

  const keyByMidi = new Map<number, HTMLButtonElement>();
  let whiteIndex = 0;
  for (const note of NOTES) {
    if (!note.isBlack) whiteIndex++;
    const key = buildKey(note, whiteIndex);
    keyByMidi.set(note.midi, key);
    board.appendChild(key);
  }

  const midiOf = (el: EventTarget | null): number | null => {
    if (!(el instanceof HTMLElement)) return null;
    const key = el.closest<HTMLElement>('.key');
    return key?.dataset.midi ? Number(key.dataset.midi) : null;
  };

  const pointerToMidi = new Map<number, number>();

  board.addEventListener('pointerdown', (ev) => {
    const midi = midiOf(ev.target);
    if (midi === null) return;
    ev.preventDefault();
    const keyEl = keyByMidi.get(midi)!;
    try {
      keyEl.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer may already be inactive (fast pen lift, synthetic events) —
         capture is an optimization, never let it kill the note */
    }
    pointerToMidi.set(ev.pointerId, midi);
    handlers.onKeyDown(midi);
  });

  const release = (ev: PointerEvent) => {
    const midi = pointerToMidi.get(ev.pointerId);
    if (midi === undefined) return;
    pointerToMidi.delete(ev.pointerId);
    handlers.onKeyUp(midi);
  };
  board.addEventListener('pointerup', release);
  board.addEventListener('pointercancel', release);
  // Never let a long-press pop the context menu on touch devices.
  board.addEventListener('contextmenu', (ev) => ev.preventDefault());

  return {
    element: board,
    setActive(active) {
      for (const [midi, el] of keyByMidi) {
        el.classList.toggle('active', active.has(midi));
      }
    },
  };
}
