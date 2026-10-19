# UI-to-service integration closure

Baseline: PR #60, `1d76a0db840f82606a70ecccfbc1dea5e734a914`.
Branch: `feat/knoux-x-integration-closure-20261020`. No main/Recovery mutation.

The App package was installed with --no-save in Debug, omitted in Release,
and undeclared in the application manifest. Capacitor 8.5 scans manifest
packages; installation alone was not registration. Core/App/CLI/Android are now
exact manifest + lockfile pins. Actual cap add/sync locally discovered App 8.1.2;
registry and both Gradle links pass the new fail-closed verifier.

Native diagnostics observe Activity lifecycle, memory pressure, WebView renderer
termination (didCrash / priority), and SAF callback/result count. Renderer loss
remains unhandled, preserving Capacitor failure semantics. CI streams device
logcat, ADB transport changes and host process/memory health before failures.
The wrapped acceptance exit code is retained.

Installed acceptance now refuses API-play/API-seek fallback passes, measures
native bounds using the existing hierarchy fallback, tests hardware Back drawer
and navigation, verifies slideshow SAF media after a process restart, and tests
a trusted timeline swipe, split and persisted edit. Root exit checks Activity
foreground departure; Android process death is not required by App.exitApp.
Release runs the same functional suite and cannot declare acceptance before it
passes. No acceptance threshold was loosened.

Local static checkpoint: typecheck and zero-warning lint passed; full suite
151/151 suites, 1329/1329 tests at the first checkpoint; subsequent focused
closure suite 7/7 suites, 62/62 tests. Current full rerun and CI remain recorded
in the final report. Both workflows parse as YAML. Lock dry-run passes; no old
locked package version changed. Existing lock entries were preserved.

Windows package builds. The real packaged timeline-export gate FAILED: the app
rejected output as ending before the authored 3.5-second timeline. The output
integrity guard remains intact; no tolerance change or PASS substitution was
made. This is an outstanding merge blocker; causality is not established.

Visual sources, layouts, themes, RTL, splash art and motion are unchanged from
the approved integrated tree. Historical screenshots are not new APK proof.

PR #57 unique back-policy logic and bounded Windows atomic rename retries are
already represented in the integrated tree (which also has stronger rename
retry tests). Unique registration/back runtime gates are implemented here,
without importing older weaker viewport checks. PR #52's sole unique commit
changes React import/namespace spelling; its Android StrictMode exclusion and
optional-overlay behavior are already present. No branch or commit is deleted.
