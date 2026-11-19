# KNOuX X — Retouch Phase 3B Forensic Audit

**Audit scope:** repository-verified, local-first assessment made before Phase 3B production changes.

| Baseline item | Observed state |
|---|---|
| Repository | `daynightae-cmyk/knoux-x` |
| Active branch | `wip/phase3a-runtime-recovery` |
| Baseline commit | `e82ace0` — `test: add temporary phase3a electron acceptance harness` |
| Tracked worktree changes | None at audit time (`git diff --name-only` and staged diff were empty) |
| Pre-existing untracked files | 142; predominantly `_temp/` evidence and temporary scripts. They must not be staged or deleted. |
| Retouch runtime harness | Existing untracked `tools/retouch-runtime-smoke.cjs`; it is a Phase 3A Electron harness and must be preserved. |

## Existing local vision architecture

The installed dependency baseline is **`@mediapipe/tasks-vision` 1.0.1**. The repository already uses it for local face analysis through `src/features/image-editor/retouch/faceAnalysis.worker.ts`, `faceAnalysisClient.ts`, and `faceAnalysisContract.ts`. The worker uses `FilesetResolver.forVisionTasks()` and configures `FaceLandmarker` with a transferred `modelAssetBuffer`; it does not pass a remote model URL to MediaPipe at inference time. It runs outside React, scales analysis images to a 1024-pixel maximum edge, explicitly closes `ImageBitmap` resources, and returns typed `ready`, `model-unavailable`, or `failed` outcomes with elapsed time.

| Component | Verified implementation | Phase 3B reuse decision |
|---|---|---|
| Worker pattern | `faceAnalysis.worker.ts` uses an off-thread MediaPipe task and local model bytes. | Create a parallel typed body worker; do not copy semantic face-region logic. |
| Client pattern | `faceAnalysisClient.ts` owns worker configuration, request/result routing, and cache behavior. | Reuse the lifecycle, local asset lookup, and deterministic request-ID approach. |
| Local WASM | `public/mediapipe/vision_wasm_internal.wasm`, `vision_wasm_module_internal.wasm`, and `vision_wasm_nosimd_internal.wasm` are packaged locally. | Reuse the same local public WASM resolution. |
| Model registry | `electron/retouch/local-model-registry.ts` requires an approved download URL, byte size, SHA-256, license decision, and commercial-use approval. | Add an approved pose-model manifest entry and packaged asset before enabling body analysis. |
| Current local model assets | `assets/models/face_landmarker.task` is present; there is no `.task`, `.tflite`, or `.onnx` pose/person/segmentation model in the tracked local model locations. | Body analysis is unavailable until an integrity-reviewed local Pose Landmarker asset is added. |

No existing source reference to `PoseLandmarker`, `ImageSegmenter`, or a body/person detector was found. Therefore, Phase 3B cannot honestly expose a ready body-analysis state before a local pose model has been provisioned and runtime-tested.

## Existing retouch architecture

The raster path is already non-destructive and layer-scoped. `RasterLayer.retouche` serializes operation records and masks in the document schema. `ImageStudioRetouchPanel.tsx` creates records, `imageStudioStore.ts` mutates the active raster layer, `retouchPreviewBridge.ts` converts persisted records to engine operations, and `retouchEngine.ts` processes copied RGBA buffers before the result reaches the preview/export path. The store supports undo/redo plus explicit retouch transactions, so continuous control changes can be condensed into one history entry.

| Area | Located implementation | Relevant Phase 3B constraint |
|---|---|---|
| Operation engine | `src/features/image-editor/retouch/retouchEngine.ts` | Extend its discriminated operation union; do not introduce a second body store or compositor. |
| Render scheduling | `RetouchJobScheduler.ts`, `retouchRenderQueue.ts`, `retouchRender.worker.ts` | Existing supersession path remains authoritative. |
| Preview/export bridge | `src/features/image-studio/retouch/retouchPreviewBridge.ts` | Map body operation records through this bridge for both preview and full-resolution export. |
| Existing geometry primitive | `retouch/liquify/liquifyMesh.ts`, reached by `geometry-warp` | Reuse/generalize its local mesh behavior for manual body warp where safe. |
| Canvas interaction | `ImageStudioCanvas.tsx` and `imageStudioCanvasInteraction.ts` | Reuse the pointer transaction lifecycle; one manual body stroke must commit once. |
| Persistence | `retouchProject.ts` and the document schema | Persist only deterministic edit intent/resolved geometry; keep heavyweight analysis results disposable. |
| Layer isolation | Retouch data is stored per raster layer and applied through the current layer render route. | Body operations must continue to modify only their owning raster layer. |

## Phase 3A closure defect confirmed

`retouchEngine.ts` handles `manual-healing` by calling `patchHeal()` when a `source` exists, but calls full-frame `blemishRemoval()` whenever `source` is absent. `ImageStudioRetouchPanel.tsx` creates a newly armed Manual Heal operation with no source. Consequently, merely selecting the tool routes the neutral operation through expensive destructive processing. The Phase 3A fix is to make an absent or invalid target/source pair an exact pixel no-op and to preserve `patchHeal()` only after a real canvas stroke establishes valid coordinates.

The canvas already initializes `position` and `source` on pointer down and wraps a stroke inside `beginRetouchTransaction()` and `commitRetouchTransaction()`. This means the correction belongs in engine validation plus focused regression coverage; it must not change the established transaction topology.

## Phase 3B implementation design

The new body implementation must be an extension of this pipeline:

```text
local fixture / raster asset
  → BodyAnalysisClient
  → BodyAnalysis worker (local WASM + integrity-reviewed local Pose task)
  → typed BodyAnalysisResult and disposable cache
  → selected subject / resolved normalized geometry
  → RasterLayer.retouche body operation
  → retouchPreviewBridge
  → retouchEngine localized inverse-mapped displacement field
  → existing per-layer compositor, history, persistence, and export paths
```

The local pose model must be loaded as a `modelAssetBuffer`, not as a runtime URL. Body operations must contain serializable geometry and model/version identity sufficient to render consistently after reopen; raw full-resolution segmentation buffers are not suitable as default project data. A body operation needs a neutral strength value that returns source pixels exactly, bounded finite displacement, bilinear sampling, source immutability, alpha preservation, face/head attenuation, freeze-mask attenuation, and rapid attenuation outside the subject guard band.

## Audit conclusion

The repository provides a compatible local-first foundation: MediaPipe Tasks Vision, local WASM assets, an integrity-gated model registry, a non-destructive per-layer retouch stack, a reusable liquify primitive, transaction-aware history, and Electron acceptance infrastructure. It does **not** yet contain body analysis, a local pose asset, semantic body operations, silhouette-aware deformation, or a Body panel. Phase 3A Manual Heal must be corrected and accepted first; Phase 3B can then be implemented without introducing parallel state or rendering architectures.

## Follow-up controls

The implementation must retain local-only inference, explicit unavailable/failed analysis status, request supersession, resource cleanup, source immutability, transparent-pixel correctness, and no-op behavior for neutral/uninitialized operations. Runtime screenshots alone are insufficient: the final evidence must contain actual Electron canvas hashes, geometric measurements, background-change metrics, history/persistence/export checks, and offline-network observations.

## References

- `src/features/image-editor/retouch/faceAnalysis.worker.ts`
- `src/features/image-editor/retouch/faceAnalysisClient.ts`
- `src/features/image-editor/retouch/faceAnalysisContract.ts`
- `electron/retouch/local-model-registry.ts`
- `src/features/image-editor/retouch/retouchEngine.ts`
- `src/features/image-studio/retouch/retouchPreviewBridge.ts`
- `src/features/image-studio/store/imageStudioStore.ts`
- `src/features/image-studio/components/ImageStudioCanvas.tsx`
- `src/features/image-studio/components/ImageStudioRetouchPanel.tsx`
- `src/features/image-editor/retouch/liquify/liquifyMesh.ts`
