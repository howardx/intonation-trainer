# Intonation Trainer · 音准练习

**Live:** https://music-tool-nu.vercel.app ·
**Backup mirror:** https://intonation-trainer-eiu.pages.dev ·
**Repo:** https://github.com/howardx/intonation-trainer

A single-page, installable, offline-capable web app for training pupils to
sing in tune. An on-screen 2-octave piano (C3–C5) plays pure sine tones; the
**Sustain 持续** mode lets one or more notes ring continuously so students can
sing against a drone and hear when they are sharp or flat. Sustaining two keys
at once produces an interval.

Built with Vite + TypeScript + raw Web Audio API. No framework, no audio
libraries, no backend, no runtime assets — after the first load it runs fully
offline (PWA with precached assets).

## Use

- **Sustain 持续** (default): tap a key to start a drone, tap it again to stop.
  Tap several keys for intervals/chords. Multi-touch works on phones.
- **Short 短音**: tap a key for a brief (~350 ms) reference note.
- **Tone 音色**: Piano 钢琴 (default — decays naturally like a held pedal
  note), Strings 弦乐 and Choir 人声 (both sustain endlessly for drone work
  via seamless crossfade looping). All are real recorded samples.
- **Octave 八度** ◂ ▸ slides the 2-octave window from **C1 up to C8** — drones
  keep ringing while you shift, so you can drone a low C and sing against it
  two octaves higher. **⏹ Stop 停止** silences everything at once.
- **Volume 音量** slider and **Labels 标签** (note names / solfège / both).
- On a phone, use **Add to Home Screen / 添加到主屏幕** — the app then opens
  standalone and works with no network.

## Develop

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (vitest)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
node scripts/gen-icons.mjs   # regenerate PWA icons (pure Node, no deps)
```

## Deploy

The build output in `dist/` is pure static hosting — no environment variables,
no rewrites, no server. It ships to two independent free hosts so an outage
or bandwidth cap on one never takes the app away from new devices:

```bash
npm run deploy          # build + Vercel production + Cloudflare Pages mirror
npm run deploy:vercel   # Vercel only (primary: music-tool-nu.vercel.app)
npm run deploy:cf       # Cloudflare Pages only (mirror: intonation-trainer-eiu.pages.dev)
```

Cloudflare Pages free tier has no bandwidth cap, which removes the
"free-tier exhaustion" outage scenario on the mirror. If both foreign hosts
are ever blocked from a school network, the same `dist/` can be re-deployed
unchanged to Tencent Cloud static hosting (requires ICP for a custom domain).

## Icons

The PWA icons (192/512/maskable) are generated programmatically by
`scripts/gen-icons.mjs` — a dependency-free Node script that draws an
eighth-note pair and hand-encodes the PNGs. No external icon assets were used.

## Instrument samples

Piano, strings and choir notes in `public/samples/` come from the
[midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) renders of
the **FluidR3_GM** soundfont (MIT license, by Frank Wen). Only every third
semitone is stored (29 notes per instrument, ~1.4 MB total); in-between
pitches are played by shifting the nearest sample's playback rate by at most
one semitone. All samples are precached by the service worker, so instruments
work fully offline.
