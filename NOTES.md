# NOTES — defaults chosen & spec deviations

Decisions made where the spec was ambiguous or silent, per the build prompt's
instruction to pick sensible defaults and record them here.

## Interaction

- **Sustain mode is toggle-on-tap.** Spec §4 says `pointerdown → noteOn`,
  `pointerup → noteOff` (hold-to-play), but §2 and acceptance criterion #2 say
  "tap sustains, tap again stops". The acceptance-criteria reading wins: a tap
  toggles the note. This is also the kid-friendly behavior (no need to hold a
  finger down for a drone) and makes multi-touch trivially correct.
- **Switching modes silences all ringing notes.** Otherwise a drone started in
  Sustain would ring forever after switching to Short with no way to stop it.
- **Short-mode re-taps retrigger.** The spec's reference `blip()` no-ops when
  the note is already sounding, so a re-tap within 350 ms would be silently
  swallowed and the first timeout would cut the note short. `blip()` here stops
  the old voice and starts a fresh one, and each voice owns its auto-release
  timer, so stale timers can't kill a newer note.
- **`setPointerCapture` is wrapped in try/catch.** It throws `NotFoundError`
  when the pointer is already inactive (fast pen/finger lift, synthetic
  events); uncaught, that exception would abort the note logic. Found during
  headless-browser verification.

## Mobile audio unlock (bug fix, 2026-07-05)

First real-device test: keys highlighted but produced no sound on a phone.
Root cause: audio unlock called `AudioContext.resume()` only on `pointerdown`,
but WebKit (all iOS browsers) does not grant audio activation for
pointerdown/touchstart — only touchend/click/keydown — so the context stayed
suspended forever. Fix: `installAudioUnlock()` retries `resume()` on
pointerdown/pointerup/touchend/click/keydown until the context reports
`running`, then detaches. Also sets `navigator.audioSession.type = 'playback'`
(iOS 16.4+) so the hardware silent switch does not mute the app — teachers
routinely keep phones on silent. Regression-verified in Chrome under the
default (strict) autoplay policy.

## v2 (2026-07-05): instruments, full range, redesign

Owner requests overriding the v1 "pure synthesis only / C3–C5 only" spec lock:

- **Instruments**: owner asked for piano/guitar/violin; agreed set is
  Pure 纯音 (sine, default) + sampled Piano 钢琴 + sampled Strings 弦乐
  (FluidR3_GM via midi-js-soundfonts, MIT). Strings replace solo violin
  (ensemble sound loops convincingly for drones; solo violin and guitar
  samples decay and cannot drone). Pure remains default because a beat-free
  steady tone is still the best intonation reference.
- Sampled notes use a 3-semitone grid pitch-shifted via playbackRate (±1
  semitone max) — 29 files per instrument, ~1.4 MB total, all precached.
  First load grows from ~17 KB to ~1.35 MB; still one-time-only.
- Strings drone = looped middle section of the sample (30%–85%); there may be
  a subtle seam at the loop point — inherent to sample looping.
- Instrument loudness trims (pure 0.9 / piano 1.5 / strings 1.2) roughly
  level-match; tuned by construction, not by ear.

## v2.1 (2026-07-05): seam fix, choir, defaults

- Owner heard the strings loop seam. Hard `loop=true` replaced with
  **equal-power crossfade looping**: alternating overlapping segments of the
  sample's steady middle, half-cosine fade curves, 0.4 s overlap, scheduled
  ahead on the Web Audio clock. Applies to all sustaining sampled
  instruments.
- **Pure tone removed from the UI, replaced by Choir 人声** (FluidR3
  choir_aahs) per owner request — voice-like pitch reference suits a singing
  class. Order/default now Piano (default) | Strings | Choir. The engine
  still supports the 'pure' oscillator internally if it's ever wanted back.
- **Default volume raised 0.3 → 0.55**; a gentle DynamicsCompressor limiter
  (-12 dB threshold, 6:1) sits after the master gain so stacked drones at
  the louder default can't clip.
- Precache is now ~2.1 MB (three sampled instruments).
- **Range**: octave-shift buttons slide the 25-key window between C1 and C8.
  A0/B0 (the lowest two piano keys) are omitted to keep windows C-aligned.
  Drones deliberately keep ringing across octave shifts (drone low, sing
  high); a ⏹ Stop button silences everything, and switching mode or
  instrument also stops all notes.
- **Aesthetics**: "ballet studio pastel" per owner choice — rose/cream
  palette, serif masthead, card layout. Icons and manifest re-branded to
  match (#C0587C). Masthead hides on short landscape viewports to keep keys
  tall.

## Labels

- Black keys show their note name in **all** label modes (spec: "black keys
  render with note name only"). In Solfège mode, white-key note names are
  hidden but black-key names remain — hiding them would leave black keys
  blank and harder to discuss in class.

## Assets

- **Icons are generated, not sourced**: `scripts/gen-icons.mjs` draws an
  eighth-note pair on the accent green (#06A77D) and encodes the PNGs with
  zlib directly — zero dependencies, no external icon downloaded.

## Tooling / environment

- **Cloudflare MCP was not available** in the build environment. Per spec §8
  Cloudflare is only the fallback host, so nothing was lost: the build is pure
  static (`dist/`) and can be re-deployed anywhere unchanged.
- There is no standalone "TypeScript" skill in the toolchain; TS `strict` is
  enforced via `tsconfig.json` and `npm run build` runs `tsc --noEmit`.
- `playwright-core` is a devDependency used only by the verification recipe in
  `.claude/skills/verify/SKILL.md` (drives the built app in headless Chrome,
  including an offline-reload check against the service worker).

## Verification status vs acceptance criteria (§10)

Verified in headless Chrome against the production build: all 25 keys render
and sound, sustain toggle + intervals, short-mode blip, label modes, volume,
manifest, service worker registration, and **offline reload**. Unit tests
(vitest, 20 tests) cover pitch math, the note table, envelopes, polyphony, and
blip retriggering. Criteria #2 (real-phone multi-touch), #6 (home-screen
install), and #7 (wake lock) are implemented per spec but need a spot-check on
a physical phone — no real device was available in the build environment.

## v2.2 (2026-07-05): personalization + warmth

- Title is now "Mrs. Li's Intonation Trainer / 李老师的音准练习" (masthead,
  browser tab, and PWA manifest; home-screen short name is 音准练习).
- Background shifted from blush to a light butter-yellow gradient per owner
  request; rose accent palette retained.
- Three emoji critters (🐰🐥🐱) peek over the piano's top rim — decorative
  only (aria-hidden, pointer-events none), positioned in the gap between
  controls and keys so they never block a touch target, and hidden on short
  landscape viewports. Deliberately restrained per "don't overdo it".
- The keyboard's horizontal scrolling moved to an inner .keyboard-scroller
  so the critters aren't clipped by the frame's overflow.

## v2.3 (2026-07-05): availability hardening

- Owner raised the free-tier bandwidth risk (Hobby pause = downtime for new
  devices). Mitigation: the same dist/ now also deploys to **Cloudflare
  Pages** (https://intonation-trainer-eiu.pages.dev), whose free tier has no
  bandwidth cap. `npm run deploy` ships build → Vercel prod → CF mirror.
- Installed devices are unaffected by any host outage (service worker serves
  the app fully offline); a mirror only matters for first loads.
- Cloudflare official Claude Code plugin (skills + MCP) installed via
  `claude plugin install cloudflare@cloudflare` per
  developers.cloudflare.com/agent-setup — active after a plugin reload.
- No rate limiting added by design: the site is pure static with no compute,
  no data, and no endpoints to abuse; Vercel/Cloudflare platform DDoS
  mitigation applies automatically.
