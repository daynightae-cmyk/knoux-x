export interface FacePoint {
  x: number;
  y: number;
  z: number;
}

export type FaceSemanticRegion =
  | 'skin'
  | 'eyes'
  | 'leftEye'
  | 'rightEye'
  | 'upperEyelids'
  | 'lowerEyelids'
  | 'irisArea'
  | 'lips'
  | 'upperLip'
  | 'lowerLip'
  | 'mouth'
  | 'teeth'
  | 'brows'
  | 'leftEyebrow'
  | 'rightEyebrow'
  | 'cheeks'
  | 'leftCheek'
  | 'rightCheek'
  | 'jaw'
  | 'chin'
  | 'forehead'
  | 'temples'
  | 'hairline'
  | 'nose'
  | 'noseBridge'
  | 'noseTip';

export interface FaceRegionMask {
  region: FaceSemanticRegion;
  polygon: FacePoint[];
}

export interface DetectedFace {
  id: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  landmarks: FacePoint[];
  regions: FaceRegionMask[];
  headPose: { pitch: number; yaw: number; roll: number } | null;
}

export interface FaceAnalysisRequest {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  maxFaces: number;
}

export type FaceAnalysisResult =
  | { status: 'ready'; modelId: string; faces: DetectedFace[]; elapsedMs: number }
  | { status: 'model-unavailable'; modelId: string; reason: string }
  | { status: 'failed'; modelId: string; reason: string };

export const FACE_ANALYSIS_MODEL_ID = 'mediapipe-face-landmarker';

export function faceAnalysisUnavailable(reason: string): FaceAnalysisResult {
  return { status: 'model-unavailable', modelId: FACE_ANALYSIS_MODEL_ID, reason };
}
