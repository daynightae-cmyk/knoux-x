# Phase 3B Local Pose Model Provenance

The project-local body-analysis foundation uses the official MediaPipe Pose Landmarker Full model bundle. It was downloaded for local-only runtime use and recorded in `electron/retouch/local-model-registry.ts` with its measured SHA-256 and byte size.

| Field | Value |
|---|---|
| Model ID | `mediapipe-pose-landmarker-full` |
| Model file | `assets/models/pose_landmarker_full.task` |
| Runtime | MediaPipe Tasks Vision, loaded through `modelAssetBuffer` |
| Official task documentation | https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker |
| Download URL | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task |
| SHA-256 | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |
| Size | `9,398,198` bytes |
| Intended capabilities | 33 pose landmarks, world coordinates, optional segmentation masks |

The referenced official guide describes Pose Landmarker as a task for body pose landmarks in image or video input and specifies that the Full bundle includes pose detection and pose landmarking models. The model must remain local and integrity-verified; the renderer must not download or execute an unverified remote model.

## Source

[1] Google AI Edge, “Pose landmark detection guide.” https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
