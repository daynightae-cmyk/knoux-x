export type VideoRetouchRegion =
  | 'face'
  | 'lips'
  | 'upperLip'
  | 'lowerLip'
  | 'cheeks'
  | 'leftCheek'
  | 'rightCheek'
  | 'eyes'
  | 'leftEye'
  | 'rightEye'
  | 'eyelinerLeft'
  | 'eyelinerRight'
  | 'eyebrows'
  | 'leftEyebrow'
  | 'rightEyebrow'
  | 'nose'
  | 'jawline'
  | 'skin'
  | 'forehead'
  | 'underEyes'
  | 'chest'
  | 'waist'
  | 'hips'
  | 'leftThigh'
  | 'rightThigh'
  | 'thighs'
  | 'arms'
  | 'leftArm'
  | 'rightArm'
  | 'legs'
  | 'shoulders';

export type VideoRetouchCategory =
  | 'skin'
  | 'lipstick'
  | 'lip-shape'
  | 'blush'
  | 'eye-makeup'
  | 'eyeliner'
  | 'eyebrows'
  | 'face-shape'
  | 'nose-shape'
  | 'jawline-shape'
  | 'body-shape'
  | 'makeup-look';

export type VideoRetouchParameter = number | string | boolean;
export type VideoRetouchApplyScope = 'frame' | 'range' | 'clip';

/** Normalized image-space point persisted for temporal tracking. */
export interface VideoTrackingPoint {
  x: number;
  y: number;
  z?: number;
}

export interface VideoRetouchBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One temporally stable observation in clip-local seconds. */
export interface VideoRetouchTrackingKeyframe {
  timestamp: number;
  points: VideoTrackingPoint[];
  bounds: VideoRetouchBounds;
  confidence: number;
  opacity: number;
  source: 'detected' | 'tracked' | 'interpolated' | 'reacquired';
}

export interface VideoRetouchLayerRange {
  start: number;
  end: number;
}

export interface VideoRetouchLayer {
  id: string;
  templateId: string;
  category: VideoRetouchCategory;
  targetRegion: VideoRetouchRegion;
  parameters: Record<string, VideoRetouchParameter>;
  strength: number;
  active: boolean;
  order: number;
  trackingRequired: boolean;
  faceId: string | null;
  applyScope: VideoRetouchApplyScope;
  range: VideoRetouchLayerRange | null;
  maskStrategy: 'tracked-region' | 'tracked-silhouette' | 'skin-exclusion';
  blendMode: 'normal' | 'multiply' | 'screen' | 'soft-light';
  createdAt: string;
  updatedAt: string;
}

export interface VideoRetouchFaceTrack {
  faceId: string;
  keyframes: VideoRetouchTrackingKeyframe[];
  lastConfidence: number;
  lostFrames: number;
}

export interface VideoRetouchAnalysisState {
  status: 'idle' | 'detecting' | 'tracking' | 'ready' | 'partial' | 'no-face' | 'failed' | 'cancelled';
  progress: number;
  processedFrames: number;
  sampledFrames: number;
  message: string | null;
  updatedAt: string;
}

export interface VideoRetouchTrackingSettings {
  fullDetectionIntervalFrames: number;
  smoothingFactor: number;
  maximumLostFrames: number;
  reacquireFrames: number;
  minimumConfidence: number;
}

/**
 * Temporal/layer metadata owned by the canonical TimelineVideoRetouchEffect.
 * Pixel engines stay outside this serializable project-domain contract.
 */
export interface VideoRetouchClipState {
  version: 1;
  enabled: boolean;
  selectedFaceId: string | null;
  applyAllFaces: boolean;
  beforeAfter: 'after' | 'before';
  layers: VideoRetouchLayer[];
  faceTracks: VideoRetouchFaceTrack[];
  analysis: VideoRetouchAnalysisState;
  tracking: VideoRetouchTrackingSettings;
  updatedAt: string;
}
