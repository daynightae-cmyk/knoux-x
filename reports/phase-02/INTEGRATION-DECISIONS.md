# Integration Decisions — Knoux X

Date: 2026-09-10. Baseline: `3188c2d`.

1. No source-integration slice is opened: the recovery matrix yields zero
   RECOVER/ADAPT candidates, so per policy no PR is created merely to show
   activity. A giant Phase-2 dump is explicitly rejected.
2. `planTimelineExport` (Phase-1 foundation, already on main) is NOT
   duplicated by any historical branch; no historical planner exists to
   reconcile against.
3. The desktop timeline export shell on main (other agent's stack) and the
   pure planner coexist without overlap (shell renders via the canvas
   renderer; planner awaits a future FFmpeg executor).
4. Vercel Analytics (PR 10) stays OUT until the owner makes an explicit
   product decision; the privacy posture (`analyticsEnabled: false`) stands.
5. Regression locks (§16/§17): no product source is touched by this mission
   (reports + branch deletions + optional `.gitignore` hygiene only), so the
   timeline-export and retouch packaged gates stand on the baseline SHA.
   Any future slice touching those areas must rerun the packaged gates.
