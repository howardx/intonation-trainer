# Intonation Trainer · 音准练习

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
- **Volume 音量** slider, **Tone 音色** (sine/triangle/square), and
  **Labels 标签** (note names / solfège / both) in the top bar.
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
no rewrites, no server. Deployed to Vercel:

```bash
npm run build
vercel deploy --prod
```

If Vercel is slow/blocked from a school network, the same `dist/` can be
re-deployed unchanged to Cloudflare Pages or Tencent Cloud static hosting.

## Icons

The PWA icons (192/512/maskable) are generated programmatically by
`scripts/gen-icons.mjs` — a dependency-free Node script that draws an
eighth-note pair and hand-encodes the PNGs. No external icon assets were used.
