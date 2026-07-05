---
name: verify
description: Verify the Intonation Trainer PWA end-to-end in headless Chrome — build, preview, drive the keyboard/controls, check offline reload.
---

# Verifying this app

The surface is a GUI (piano keys + controls) plus a service worker, so
verification means driving the **production build** in a real browser.

## Recipe

```bash
npm run build
npx vite preview --port 4173 &   # serve dist/ (SW only exists in prod build)
```

Then drive it with `playwright-core` (devDependency; uses system Chrome via
`channel: 'chrome'`, no browser download):

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
```

## What to drive

- 25 `.key` elements render (15 `.white`, 10 `.black`).
- Sustain (default): dispatch `pointerdown`+`pointerup` on `.key[data-midi=...]`
  → key gains `.active`; again → removed. Two keys at once → both `.active`.
- Short mode: click the "Short 短音" segmented button, tap a key → `.active`
  appears then clears after ~400 ms.
- Label modes toggle visibility of `.label-solfege` / white-key `.label-name`.
- Service worker: `navigator.serviceWorker.getRegistration()`, wait ~1.5 s for
  precache, then `context.setOffline(true)` + reload → keyboard still renders.
- Collect `console` errors and `pageerror` — must be zero.

## Gotchas

- Dispatched synthetic pointer events have no active pointer, so
  `setPointerCapture` throws NotFoundError — the app try/catches this, but if
  a regression reintroduces an uncaught throw, note-handling silently breaks.
  That failure mode is exactly what this drive catches.
- Audio can't be heard headlessly; correctness of pitch/envelopes is covered
  by the vitest suite (`src/audio.test.ts`). The browser drive asserts the
  state machine via the `.active` class.
- Dev server (`npm run dev`) does not register the service worker — offline
  checks only work against `vite preview`.
