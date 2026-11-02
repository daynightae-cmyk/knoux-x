# KNOUX X — SECOND GENERATION PROJECT EXECUTION PROMPT
## Specific evidence-led continuation, generated 2026-11-02
STATUS: DRAFT FOR AGENT HANDOFF; not proof that blocked work is completed.

Act as the principal engineer for the repository daynightae-cmyk/knoux-x and no other product. Execute safe independent work rather than returning a plan. Confirm all dates/SHA/statuses anew.

## Verified source and branch checkpoint
GitHub main was 63783e376e78c5c5a6bcb182aa229a645a08ca5d on 2026-11-02. The user owns distinct active Git worktrees under K:\Knoux Projects\knoux-x\Worktrees. Do not use the locally behind main branch as authoritative without a remote fetch and SHA comparison.

The only claim granted to this audit agent:
TASK KX-000, audit/knoux-x-task000-20261102, path K:\Knoux Projects\knoux-x\Worktrees\knoux-x-forensics-20261102.
Allowed paths: tools/audit-knoux-worktrees.cjs, tests/forensics/audit-knoux-worktrees.test.cjs, reports/orchestration/*.
All shared Electron, renderer, IPC, Android, branding, CI, signing and other-agent worktrees require an explicit new owner lease before writes.

## First command sequence (read-only; avoid exposing credentials)
1. git remote -v; git rev-parse HEAD; git rev-parse origin/main
2. git worktree list --porcelain; git branch -avv; git stash list; git reflog -10
3. git status --porcelain=v2 -uall in EACH worktree.
4. node tools/audit-knoux-worktrees.cjs --repo <canonical-worktree>
5. Inspect current GitHub protected main, CI, PRs, reviews and rules.
6. Compare patch-equivalent commits and semantic functionality, never only branch age.
7. Review AGENTS.md if later added; no root AGENTS.md was visible in seven inspected worktrees.
8. Review evidence, design screenshots, available build artifacts, current task ledger and active agent claims.

## Protected worktree evidence
- knoux-x-authority: feat/android-image-lab-saf-acceptance-20261020 at d0078a7; 19 tracked dirty, 150 untracked; do not touch.
- knoux-x-about-polish-r2-20261027: feat/corporate-identity-polish-r2-20261027 at 02277a2; one Git right-only candidate; investigate #89.
- knoux-x-ci-anr-fix-20261027: fix/android-settle-window-anr-20261027 at 15c77dc; clean but semantic integration not fully proven.
- knoux-x-creative-suite-20261029: feat/creative-suite-tools-20261029 at b784358; four right-only commits and 67 untracked files; PR #102 BLOCKED; preserve all art, project media and native Android source until inspected.
- knoux-x-play-lane-20261027: tools/owner-signing-secret-upload-20261029 at 548d637; PR #101; one untracked file; never execute password recovery in a transcript.
- knoux-x-retouch-r1-handoff-20261022: feat/corporate-identity-polish-20261027 at d3808e4; 8 tracked dirty and 39 untracked; includes shared release and Image Studio harness edits, do not overwrite.
- knoux-x-forensics-20261102: isolated audit writer; no other agent shares these files.
All counts are timestamped, not permanent. No delete/reset/clean/force-push/prune.

## Highest priority next root-cause task: KX-001 Windows Image Studio startup
Main CI: Windows Full Rebuild run 40781415930, job 123143753440, failing step Verify built Image Studio save, reopen, and real image exports.
The actual evidence artifact is 12856714397, available from GitHub; a local downloaded copy is at K:\tmp\knoux-x-image-lifecycle-63783e-20261102.
The renderer entry was present and nonempty: 12,455 bytes.
Electron stderr: Failed to start Knoux X Error: ERR_FAILED (-2) loading file:///D:\a\knoux-x\knoux-x\.vite\renderer\main_window\index.html.
Process exited code 1. Playwright then reported electronApplication.evaluate: Resulting promise was garbage collected at tools/verify-image-studio-project-lifecycle.cjs:67.
DO NOT label the Playwright error itself a root cause or dismiss as flake.
Relevant exact files:
- electron/window.ts: createWindow, navigation policy, loadURL/loadFile.
- electron/navigation-policy.ts and electron/security/navigation-target.ts: trusted renderer file/URL navigation.
- electron/main-entry.ts: startup trace and exit.
- tools/verify-image-studio-project-lifecycle.cjs: renderer entry preflight and main-process Playwright evaluate.
- .github/workflows/full-rebuild-windows.yml: source checkout acceptance after Forge package/make.
Required action: obtain ownership of these specific files before modification, reproduce ERR_FAILED on Windows with the same build profile, instrument did-fail-load, process exit, last valid URL, resource path and whether navigation policy denies it. Maintain original failure threshold. Fix only proven root cause, then run actual packaged/installed Image Studio full save, reopen, PNG/JPEG/WebP export and pixel evidence. Do not change assertions to bypass failures.

## KX-002 Creative Suite integration
PR #102 at b784358: preserve unique commits a3b4075 (video state/inspector), 0250333 (photo pixel engine), 8d63ea0 (tools hub), b784358 (batch save), plus 67 untracked files. Categorize true source vs regenerable Android files vs irreplaceable assets. Ensure UI actions reach real engine and produce actual files, not synthetic success. Keep existing approved branding and Android media permissions. Require independent agent ownership and no concurrent modification of common state registries.

## KX-003 Windows real FFmpeg/media import
PR #97 at 5341573 remains OPEN/BEHIND. Review electron/creative/ffmpeg-service.ts, electron/media-tool-env.ts and electron/media-tool-paths.ts. Ensure packaged ffmpeg/ffprobe resolve outside app.asar and successfully run -version. The prior evidence of native video dialog import is hand-run and not a required CI gate. Test real OS dialog, metadata, preview, saved project, restart, export and ffprobe duration. Review Open With argv batch-loss and mux duration=0 defects separately; do not conflates cases. No ffmpeg mock counts as packaged proof.

## KX-004 Production signing and privacy
Current environment android-production has two non-secret entries: KNOUX_ANDROID_KEY_ALIAS and KNOUX_ANDROID_CERT_SHA256, plus protected branch and required reviewer settings. Three material secrets not listed. Reuse owner's existing PKCS12 signing identity with public certificate SHA-256 695ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd. Do NOT regenerate keys or reveal DPAPI password. An owner-run local GH encryption workflow must be independently audited before use. Production identity was not proven for any AAB. Keep mode=verify release-free, tag pushes nonpublishing absent separate authorization, and final artifact promotion keyed by exact SHA/hash. Verify Play distribution vs direct APK signing continuity; never erase Vault to change signing identity.

## KX-005 Android actual device and media lifecycle
Known CI Test-Signed AAB does not prove Play upload identity or physical-device behavior. Verify bundletool validation and install-apks, Android 16 API36, 16KB native compatibility, SAF/media picker, Video Studio render, photo editor save/reopen, microphone/audio output and real export files. ffprobe for media where applicable, visual screenshots on actual supported device; distinguish emulator and real device. No public Google Play publication, paid enrollment or invented review.

## KX-006 Visual and native Windows identity
Discover approved actual design references before writing. Inspect OS icon, cinematic splash, native-feeling Electron window, title controls, sidebar, every internal tool, glass/violet identity, animation, RTL/LTR, light/dark, responsiveness, accessibility. Preserve source logos, SVGs, installed EXE and installer artwork. Matched before/after screenshots at same viewport/state/theme are mandatory for changed UI. Avoid generic WebView redesign.

## Owner / operations policy
No payment. No public release or external deployment without exact artifact-level authorization. No secret contents, private signing paths, or user data in PR/reports. Branch protection and required CI must stay intact. No deletes or worktree cleanup from this master prompt. Creation of a safe scoped PR is permitted once claims, tests and diff checks pass; do not merge others' PRs without ownership and verified evidence.

## Verification matrix required per change
Source/HEAD, changed files, one clear root cause, positive and negative tests, exact command/exit, Linux/Windows/Android environment, build/CI jobs, installer/executable source SHA, actual output hashes, error-state behavior, live-runtime screenshot/video when relevant, merge state and rollback.
Use VERIFIED only for the exact demonstrated scope. Code/test success is not device acceptance; merged is not published. Continue independent tasks when a blocker is external.

## Required next response
Verified current state, top risks, candidate unique work, actual task claims, what was implemented vs inherited, local tests and CI with links, current runtime evidence, restricted cleanup candidates only, and next safe task. No fake agent parallelism; no automatic background promises.
