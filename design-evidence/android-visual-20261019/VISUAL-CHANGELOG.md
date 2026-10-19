# VISUAL CHANGELOG - Android Visual System (Violet Cinema / Creator OS)

## 2026-10-19 - Session A (this worktree, branch feat/knoux-x-android-visual-system-20261019)

- Base SHA (pinned): 14a0e7d79ea4d8578e950385a64d784dccaee88a (recovery lineage at worktree creation; NOT reset target)
- Pre-edit checkpoint bundle: C:\Users\day night\Documents\KNOuX-Release-Closure\VISUAL-CHECKPOINT-20261019-20261019-095031 (52 files, SHA256 manifest)
- 1ded184 preservation commit of the original Codex violet WIP (52 files)
- fb855bc contract restoration:
  - tools/prepare-android-premium-splash.cjs: official daylight/pearl native launch surface restored (knoux-logo-day asset, PEARL #F8F7FC, PURPLE #7828E8, light status/nav bars), preview mode kept
  - src/components/mobile/MobileSplashOverlay.tsx: 750ms minimum visual hold restored with real isHomeReady handshake, 1800ms safety fallback, 300ms exit transition alignment
  - src/features/library/MobileMediaLibraryView.tsx: honest picker copy restored (Choose ordinary media files - never project JSON)
  - Full unit suite green: 148 suites / 1285 tests; typecheck + lint clean
- 8fdc299 evidence: visual matrix capture via tools/visual-capture.cjs (Playwright, browser runtime adapter): 12 screens x 3 viewports (360x800, 390x844, 412x915) + landscape, status VISUAL_RUNTIME_VERIFIED (browser runtime adapter; not device-touch)
- Capture server note: served by an existing visual-review Vite instance on 127.0.0.1:4173 (serves this worktree via vite.visual-review.config.ts). Correct start command: npx vite --config vite.visual-review.config.ts (this project has no npm run dev script).

## Honest findings (first matrix review, historical record)
1. Video Studio empty state: large dead whitespace above start card; bottom tool dock clips a 7th item at right edge (check scroll affordance)
2. Export screen: Choose button and selected segmented chips washed-out; AA contrast risk in Daylight theme
3. Player empty state: 'Open local media' heading very low contrast on black
4. Photos-to-Video: footer strip 'SIMPLE TO CREATE - POWERFUL TO FEEL' low contrast
5. Recording: microphone checkbox renders as plain dark square (native accent), weak affordance
6. Dark 'Deep Black' theme variants NOT yet captured (next: capture with data-theme deep-black, AR-RTL, reduced-motion, keyboard)

## 2026-10-19 - Fixes pass (presentation-only, daylight/system-light theme)

Measured with live DOM probes (Playwright, msedge) before/after; all fixes are CSS-only except the capture tool arg bug. No handlers, props, routing, persistence or logic touched.

1. Tool dock clipping (CONFIRMED GEOMETRY BUG): android-visual-system.css forced `flex: 1 0 54px; min-width: 54px` -> dock scrollWidth 414px inside 368px box, 'Effects' clipped ~39px past the viewport at 390px (and worse at 360px). Fixed to `flex: 1 1 0; min-width: 0` (+ 3px gap/4px inline padding under 390px). Verified: 360 -> 45px min button (7/7 visible), 390 -> 49px, 412 -> 51px; touch targets stay >= 44px; scrollWidth == clientWidth.
2. Video Studio dead whitespace: MEASURED as intentional centered empty state (`place-items: center` on the 70dvh empty region; card center 379px vs region center 382px). No layout change made; only the real dock clip was fixed. Start-card subtitle contrast fixed: rgba(224,211,245,.7) on white -> var(--kx-muted) (1.5:1 -> 5.7:1).
3. Export light-theme contrast (all were dark-theme colors on white cards):
   - Choose button: #d9c6ff on ~#eadcfb (1.6:1) -> #5b21b6 on #efe4ff with violet ring (7.4:1)
   - Selected chips (1080p / 30 / 8): #efe7ff on light lavender (1.3:1) -> white on #6d28d9..#8b3dff gradient (4.7:1+)
   - Unselected chips: #a9a1b5 (~2.4:1) -> #4a3d5c on #fff (8:1+)
   - Section values (1920x1080 / 30 FPS / 8 Mbps): #ddd2ec (1.3:1) -> var(--kx-text)
   - Section labels + source copy small/span: #9d91ae/#8f8799 (~3:1) -> var(--kx-muted) (5.7:1)
   - ON DEVICE badge: #d8c5ff (1.5:1) -> #5b21b6 on #efe4ff; source icon -> #6d28d9 on pale violet
   - Disabled Export Video: opacity .48 white-on-pale -> flat #e9defc/#6b4fa0 (no fake enabled state; still clearly disabled)
4. Player empty state (always-dark cinema stage): h1 inherited --kx-text = #201629 dark-on-dark; p --kx-muted dark-on-dark. Light-theme scoped override h1 -> #f6f0ff, p -> #b7a8c8 (>= 8:1 on #040208). Dark theme untouched. Full player dark-text scan: only these 2 nodes affected.
5. Recording: mic checkbox `color-scheme: dark` on a now-light panel rendered the native dark square; light-theme scoped `color-scheme: light` (accent stays #a76bff). Also fixed on this screen: active option chips had rgb(101,86,111) text on an rgb(81,34,126) deep purple chip = 1.66:1 -> white text (9:1); field labels #c5bfce (1.7:1) -> var(--kx-muted); hero kicker #c4a6ff (1.85:1) -> var(--kx-muted).
6. Cross-screen daylight accents unified for large-text AA: hero `em` accents #c4a6ff / #b66dff / #d3acff (1.85-2.9:1) -> #a855f7 (3.6:1) on recording/export/slideshow/home-greeting; home section kicker + 'All tools' #b995ff / #c89dff (~2:1) -> var(--kx-lavender) (6.97:1). Dark-surface accents (e.g. hero card on Home, which sits on a dark card) intentionally NOT changed.
7. tools/visual-capture.cjs: fixed flag parsing bug (missing --out/--base-url fell back to argv[0], i.e. node.exe path, failing mkdir). Defaults now resolve correctly.

Re-capture after fixes: tools/visual-capture.cjs full matrix, 0 failures, 33 screenshots regenerated at 2026-10-19T07:11Z; typecheck + full unit suite green (148 suites / 1285 tests) before capture.

## 2026-10-19 - Profile captures: Deep Black, AR-RTL, reduced-motion

- tools/visual-capture.cjs extended with capture profiles: `--theme deep-black|system-light`, `--locale ar|en`, `--reduced-motion` (Playwright `reducedMotion: 'reduce'` context). Profile is applied per browser context inside Settings and then VERIFIED (documentElement data-theme / settings section dir / data-motion); any mismatch lands in capture-log.json failures instead of being silently skipped.
- Deep Black pass -> screenshots-deep-black (33 files, 0 failures, 2026-10-19T07:40Z): dock shows all 7 tools; the daylight contrast overrides stayed scoped to system-light (dark chips/heroes render as designed); recording active chips white-on-deep-purple; player empty state unchanged (always-dark stage).
- AR-RTL pass -> screenshots-ar (0 failures, 2026-10-19T07:42Z): home hero/cards, bottom nav and the studio tool dock all mirror correctly (dock order runs Effects..Split right-to-left); dir=rtl verified per section.
  - Honest note (content/i18n gap, NOT fixed in this presentation pass): Video Studio start card and several export strings remain English under AR; when English sentences render under dir=rtl a few bidi punctuation artifacts appear ('.Make it yours to share', 'a .project', 'FPS 30'). Proper fix is UI-string localization plus dir=ltr isolation on English segments - follow-up i18n work, not a CSS patch.
- Reduced-motion pass -> screenshots-reduced-motion (0 failures, 2026-10-19T07:45Z): context-level prefers-reduced-motion: reduce; app reflects data-motion='reduced' (verified in-tool); stills match the default pass (motion removal does not alter layout).
- Keyboard pass remains BLOCKED_ENVIRONMENT in the browser runtime (no Android IME); deferred to the device pass. All profile captures carry status VISUAL_RUNTIME_VERIFIED (browser runtime adapter; no touch events were sent).
