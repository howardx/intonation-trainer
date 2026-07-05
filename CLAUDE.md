# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server
npm test           # run all unit tests (vitest)
npx vitest run src/audio.test.ts   # run a single test file
npm run build      # tsc --noEmit (strict) + vite build → dist/
npm run preview    # serve the production build (needed to test the PWA/service worker)
node scripts/gen-icons.mjs         # regenerate PWA icons (dependency-free)
vercel deploy --prod               # deploy dist/ (pure static, no env vars)
```

## What this is

An offline-first PWA piano for choir intonation training: a 25-key window
that octave-shifts across C1–C8, with a pure sine tone (default) plus sampled
Piano and Strings. Vanilla TypeScript + raw Web Audio API — **no framework
and no audio libraries by explicit design decision**; do not introduce React
or Tone.js. Instrument samples live in `public/samples/` (FluidR3 soundfont,
3-semitone grid, pitch-shifted via playbackRate — see `src/samples.ts`) and
are precached by the service worker, so everything still works offline.

## Architecture

- `src/notes.ts` — pure data: `midiToFreq` (A4=440, 12-TET), `windowNotes()`
  (any 25-key C-to-C window) and `WINDOW_STARTS` (C1..C6), names/solfège
  (fixed do, C=do). No DOM, no audio.
- `src/samples.ts` — pure data: the sample grid (every 3rd semitone C1–C8),
  flat-name mapping matching the mp3 filenames, and nearest-sample +
  playbackRate resolution.
- `src/audio.ts` — `AudioEngine`, the only module that touches Web Audio.
  Invariants that must hold:
  - exactly one lazily-created `AudioContext`, `resume()`d on first user
    gesture (iOS unlock — wired in `main.ts` via a capture-phase pointerdown);
  - every note start/stop goes through gain ramps (20 ms attack / 50 ms
    release) — a bare start or stop at full gain clicks audibly;
  - exponential ramps target `0.0001`, never 0 (Web Audio throws);
  - polyphony is a `Map<midi, voice>`; each short-mode blip owns its
    auto-release timer so a retrigger can't be killed by a stale timeout;
  - voices are oscillators ('pure' — engine-only, not in the UI) or
    AudioBufferSourceNodes (sampled); sustaining instruments (strings,
    choir) drone via equal-power crossfade looping (alternating overlapping
    segments — never `loop=true`, which has an audible seam); piano decays
    and fires `onNoteEnded` so the UI can clear the highlight; a `noteOn`
    before its sample is decoded parks a 'pending' voice that plays on
    arrival unless released first;
  - the master gain feeds a DynamicsCompressor limiter — keep it, the 0.55
    default volume with stacked drones relies on it to avoid clipping.
- `src/keyboard.ts` — builds the piano DOM, translates Pointer Events to
  `onKeyDown/onKeyUp(midi)`. Tracks pointers by `pointerId` for multi-touch.
  `setPointerCapture` is deliberately try/catch'd (throws on already-released
  pointers).
- `src/ui.ts` — controls bar (mode/volume/waveform/labels), wake lock,
  install hint. All user-facing strings are bilingual "English 中文".
- `src/main.ts` — composition root; owns the mode state. **Sustain mode is
  toggle-on-tap** (tap starts, tap again stops) — see NOTES.md for why this
  reading of the spec won. Switching modes silences all ringing notes.
- Label visibility is CSS-only: `#app[data-labels=...]` selectors in
  `styles.css`, no per-key JS updates.

## Testing

Unit tests (vitest, node env) cover `notes.ts` and `audio.ts`; the Web Audio
API is faked in `src/audio.test.ts` (`FakeAudioContext`) — extend that fake if
the engine grows new node types. DOM/UI modules are covered by the browser
verification recipe in `.claude/skills/verify/SKILL.md` (headless Chrome via
`playwright-core` against `vite preview`, including an offline-reload check).
PWA behavior only exists in the production build — always verify service
worker changes against `npm run build && npm run preview`, never the dev
server.
