export interface BodyPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

export type BodyLandmarkName =
  | 'nose' | 'leftEyeInner' | 'leftEye' | 'leftEyeOuter' | 'rightEyeInner' | 'rightEye' | 'rightEyeOuter'
  | 'leftEar' | 'rightEar' | 'mouthLeft' | 'mouthRight' | 'leftShoulder' | 'rightShoulder'
  | 'leftElbow' | 'rightElbow' | 'leftWrist' | 'rightWrist' | 'leftPinky' | 'rightPinky'
  | 'leftIndex' | 'rightIndex' | 'leftThumb' | 'rightThumb' | 'leftHip' | 'rightHip'
  | 'leftKnee' | 'rightKnee' | 'leftAnkle' | 'rightAnkle' | 'leftHeel' | 'rightHeel'
  | 'leftFootIndex' | 'rightFootIndex';

export interface DerivedBodyGeometry {
  head: { center: BodyPoint; radius: number } | null;
  shoulders: { left: BodyPoint; right: BodyPoint; center: BodyPoint; width: number } | null;
  waist: { left: BodyPoint; right: BodyPoint; center: BodyPoint; width: number } | null;
  hips: { left: BodyPoint; right: BodyPoint; center: BodyPoint; width: number } | null;
  arms: { left: [BodyPoint, BodyPoint, BodyPoint] | null; right: [BodyPoint, BodyPoint, BodyPoint] | null };
  legs: { left: [BodyPoint, BodyPoint, BodyPoint] | null; right: [BodyPoint, BodyPoint, BodyPoint] | null };
  subjectBounds: { x: number; y: number; width: number; height: number } | null;
}

export interface DetectedBody {
  id: string;
  confidence: number;
  landmarks: Record<BodyLandmarkName, BodyPoint>;
  geometry: DerivedBodyGeometry;
}

export interface BodySegmentationMask {
  /** Binary person mask at local analysis resolution; it is retained only by the analysis cache. */
  width: number;
  height: number;
  data: Uint8Array;
}

export interface BodyAnalysisRequest {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  maxBodies: number;
}

export type BodyAnalysisResult =
  | { status: 'ready'; modelId: string; bodies: DetectedBody[]; elapsedMs: number; segmentationAvailable: boolean; segmentationMask?: BodySegmentationMask }
  | { status: 'model-unavailable'; modelId: string; reason: string }
  | { status: 'failed'; modelId: string; reason: string };

export const BODY_ANALYSIS_MODEL_ID = 'mediapipe-pose-landmarker-full';

export function bodyAnalysisUnavailable(reason: string): BodyAnalysisResult {
  return { status: 'model-unavailable', modelId: BODY_ANALYSIS_MODEL_ID, reason };
}
