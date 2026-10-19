# KNOUX X — Android Visual Re-verification (Integration Branch)

Branch: `feat/knoux-x-integration-20261019`
Commits covered: `bc7204f` (visual merge) → `6c010f1` (onboarding/contrast/harness fixes) → `c9d1fac` (Arabic i18n) + this evidence commit.
Engine: Playwright (msedge channel), Vite visual-review config with the Android Capacitor stub, `deviceScaleFactor: 2`, live dev server on `127.0.0.1:4173`.

Tooling: `tools/visual-capture.cjs` gained `--viewports WxH[,WxH...]` so the same 11-section target set can run in landscape; every pass appends its verdicts to `capture-log.json`.

## Captured matrix — 8 passes, 0 failures, 302 PNGs

| Pass | Directory | Viewports | Images |
| --- | --- | --- | --- |
| Daylight (default) portrait | `screenshots-daylight/` | 360x800, 390x844, 412x915 | 36 |
| Deep Black portrait | `screenshots-deep-black/` | 360x800, 390x844, 412x915 | 36 |
| Arabic RTL portrait | `screenshots-ar/` | 360x800, 390x844, 412x915 | 36 |
| Reduced motion portrait | `screenshots-reduced-motion/` | 360x800, 390x844, 412x915 | 36 |
| Daylight landscape | `screenshots-landscape/` | 800x360, 844x390, 915x412 | 36 |
| Deep Black landscape | `screenshots-landscape-deep-black/` | 800x360, 844x390, 915x412 | 36 |
| Arabic RTL landscape | `screenshots-landscape-ar/` | 800x360, 844x390, 915x412 | 36 |
| Reduced motion landscape | `screenshots-landscape-reduced-motion/` | 800x360, 844x390, 915x412 | 36 |

Per viewport the 12 files are: `home`, `library`, `player`, `image-editor`, `video-studio`, `audio-tools`, `beauty`, `photos-to-video`, `recording`, `export`, `settings` (11 sections), plus the swapped-orientation `home-<w>x<h>.png` extra capture.

## First-run captures — `captures/` (splash + onboarding)

The matrix intentionally dismisses first-run overlays (`dismissFirstRunOverlays`), which is why the device-pass defects were invisible to it. These probe captures cover that gap:

- `splash-*` / `onboarding-*` for: system-light 412x915, deep-black 412x915, system-light 360x800 (en + ar), system-light 800x360 (en + ar).

Key measurements (probe `_temp/probe-splash.cjs`, `PROBE_OUT` override):

- `.km-welcome` bounding box equals the exact viewport in every scenario: 412x915, 360x800, 800x360 — the right/bottom Pearl strip is gone (root cause fixed in `android-mobile.css`, commit `6c010f1`).
- Onboarding heading color `rgb(245, 239, 255)` (#f5efff) in both themes — dark ink on the always-dark card is gone.
- `dir="rtl"` confirmed for Arabic onboarding at 412x915, 360x800 and 800x360 (three consecutive reruns stable; one stale `ltr` reading observed once while four capture passes hammered the dev server concurrently — probe boot race, not reproducible, no product defect).
- Deep Black splash captured distinctly from onboarding (sha256 prefix `F9CC488386C224DB` vs `2076C28165CFB630`) — white ink on the dark splash, violet X, legible.

## Observations (not defects)

- Landscape video-studio at 800x360: the floating tool dock visually overlaps the lower edge of the start-card CTAs. Hit-probe (`_temp/probe-studio-landscape.cjs`) shows the "New project" button rect y 239..300, center point still hits the button (`hitIsButton: true`) — tappable; the floating dock overlapping scroll content is the established design pattern on Home too. Recorded as an observation for follow-up polish, not a blocker.
- AR landscape export/home: clean mirrored RTL, Latin values (`1920×1080`, `1080P`) bidi-isolated, no mixed-direction punctuation artifacts.

## Not covered here

- Installed-APK behavior on Android runtime (touch typing, audio, MediaProjection) — see the CI device-pass evidence from `android-emulator-smoke.sh`, which now fails rather than accepting stale 1080x2400 frames.
