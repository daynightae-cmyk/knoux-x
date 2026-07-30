# KNOUX Smart Editor Report

## Implemented

A non-destructive, versioned `.knouxedit` domain foundation now provides:

- Version-checked project parsing.
- Immutable clip-duration calculation.
- Frame-time-independent trim validation.
- Split-at-playhead calculations that preserve the original clip.
- Playback-rate-aware source/timeline conversion.
- Clone-isolated undo and redo history with redo invalidation on new edits.

## Remaining

Persistence, migrations, autosave/recovery, missing-source relinking, the timeline UI, FFmpeg capability discovery, worker-based export, cancellation, output probing, and licensing notices remain. No editor control is exposed until it performs real work, and TASK-17 remains `IN_PROGRESS`.
