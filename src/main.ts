import './styles.css';
import { AudioEngine } from './audio';
import { createKeyboard } from './keyboard';
import { createControls, createInstallHint, setupWakeLock, type LabelMode, type Mode } from './ui';

const engine = new AudioEngine();
let mode: Mode = 'sustain'; // drone is the core use case

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

const stopAll = () => {
  for (const midi of engine.activeNotes()) engine.noteOff(midi);
  refreshActive();
};

const controls = createControls({
  onMode(m) {
    mode = m;
    stopAll(); // switching modes silences ringing drones
  },
  onVolume(v) {
    engine.setVolume(v);
  },
  onWaveform(w) {
    engine.setWaveform(w);
  },
  onLabels(l: LabelMode) {
    app.dataset.labels = l;
  },
});

app.dataset.labels = 'both' satisfies LabelMode;
app.appendChild(controls.element);
const hint = createInstallHint();
if (hint) app.appendChild(hint);
app.appendChild(keyboard.element);

// Audio unlock + wake lock on the very first gesture anywhere.
window.addEventListener(
  'pointerdown',
  () => {
    void engine.resume();
    wakeLock.onFirstInteraction();
  },
  { capture: true },
);
