# Integration closure evidence — 20 October 2026

**NOT eligible for main merge.** Draft PR #61 is based on PR #60 at
`1d76a0db840f82606a70ecccfbc1dea5e734a914`. Latest tested code:
`ee1a62fdbf476371182c9231592261a89c2feee3`. The evidence commit adds only docs/artifacts.

Read INTEGRATION-REPORT-AR.md for the Egyptian Arabic handoff and CONTRACTS.md
for UI → handler → service → persistence → reopen tracing.

- Exact App/Core/CLI/Android pins, generated plugin JSON and Gradle registration PASS.
- API35 Debug 39345446893 and Release 39345460085: build/launch PASS; trusted
  onboarding skip and hardware Back drawer-dismiss/Settings-to-Home PASS. SAF
  returns one item. Playback does not finish; host QEMU disappears before cleanup.
  Cause remains unestablished. Later cases blocked, not passed.
- API34 comparison 39354147723 on ee1a62f: TypeScript/lint PASS, 152 suites /
  1335 tests PASS, package/launch PASS; initial WebView attachment times out.
  No functional cases. ADB/QEMU/app alive. A distinct failure, not a fix for API35.
- Windows package/IPC PASS on 3e74e49. Timeline export fails once, produces one
  valid service output on a later run, then fails again with hit-tested CDP mouse
  input at the unchanged duration guard. Reliability remains a blocker.
- windows-service-pass-onboarding-overlay.png shows onboarding over the editor;
  it cannot prove visible export controls. windows-timeline-trusted-failure.png
  shows the reachable editor and actual error. Service output retained under outputs/.
- No application UI/style/asset changes. Actual APK captures at 360×800, 390×844,
  412×915 mainly show onboarding. No all-route/RTL/landscape/physical-touch claim.

Android folders retain exact JSON, selected raw lifecycle/host excerpts,
checksums and screenshots. Full raw logs and APKs are in linked GitHub run artifacts
and locally under _temp/. Release is TEST_SIGNED, productionSigned=false, BUILT,
not acceptance PASS. No main/Recovery mutation, merge, force-push, data wipe,
branch deletion or production release occurred.
