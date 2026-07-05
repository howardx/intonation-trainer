import './styles.css';
import { AudioEngine, installAudioUnlock } from './audio';
import { createKeyboard } from './keyboard';
import { DEFAULT_WINDOW_START, WINDOW_STARTS } from './notes';
import { createControls, createInstallHint, setupWakeLock, type LabelMode, type Mode } from './ui';

const engine = new AudioEngine();
let mode: Mode = 'sustain'; // drone is the core use case
let windowStart = DEFAULT_WINDOW_START;

const app = document.querySelector<HTMLDivElement>('#app')!;
const wakeLock = setupWakeLock();

const refreshActive = () => keyboard.setActive(new Set(engine.activeNotes()));

const keyboard = createKeyboard({
  onKeyDown(midi) {
    if (mode === 'short') {
      engine.blip(midi);
      refreshActive();
      // clear the highlight once the blip's own release fires
      setTimeout(refreshActive, 400);
    } else {
      // Sustain: tap toggles — tap sustains, tap again stops.
      if (engine.isOn(midi)) {
        engine.noteOff(midi);
      } else {
        engine.noteOn(midi);
      }
      refreshActive();
    }
  },
  onKeyUp() {
    /* sustain is toggle-based; nothing to do on release */
  },
});

// sampled piano notes decay on their own — clear their highlight when they do
engine.onNoteEnded = () => refreshActive();

const stopAll = () => {
  engine.stopAll();
  refreshActive();
};

const preloadVisible = () => void engine.preload(keyboard.visibleMidis());

const controls = createControls({
  onMode(m) {
    mode = m;
    stopAll(); // switching modes silences ringing drones
  },
  onVolume(v) {
    engine.setVolume(v);
  },
  onInstrument(i) {
    stopAll(); // an oscillator drone can't morph into a sample — restart clean
    engine.setInstrument(i);
    preloadVisible();
  },
  onLabels(l: LabelMode) {
    app.dataset.labels = l;
  },
  onOctaveShift(direction) {
    const idx = WINDOW_STARTS.indexOf(windowStart) + direction;
    if (idx < 0 || idx >= WINDOW_STARTS.length) return;
    windowStart = WINDOW_STARTS[idx];
    // drones keep ringing across shifts — shift down to C3, drone it, shift up
    keyboard.setWindow(windowStart);
    controls.setWindow(windowStart);
    refreshActive();
    preloadVisible();
  },
  onStopAll: stopAll,
});
controls.setWindow(windowStart);

app.dataset.labels = 'both' satisfies LabelMode;
app.appendChild(controls.element);
const hint = createInstallHint();
if (hint) app.appendChild(hint);
const frame = document.createElement('div');
frame.className = 'keyboard-frame';
frame.appendChild(keyboard.element);
app.appendChild(frame);

// Audio unlock: retries on pointerdown/pointerup/touchend/click/keydown
// until the context runs — WebKit only accepts some of these as activation.
installAudioUnlock(engine);

// Wake lock on the first gesture anywhere.
window.addEventListener('pointerdown', () => wakeLock.onFirstInteraction(), {
  capture: true,
});
