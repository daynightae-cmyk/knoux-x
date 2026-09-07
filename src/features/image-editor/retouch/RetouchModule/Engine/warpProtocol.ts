import type { BodyControlPoint, BodyZoneType } from './BodyDetector';
import type { BoundingBox, MaskSpan } from './FaceDetector';

/** Serializable zone mask used across the warp worker boundary. */
export interface WarpZoneMaskPayload {
  width: number;
  height: number;
  spans: readonly MaskSpan[];
}

/** Worker request for deterministic bilinear body-zone deformation. */
export interface WarpWorkerRequest {
  type: 'warp';
  requestId: string;
  zoneId: string;
  zoneType: BodyZoneType;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  controlPoints: readonly BodyControlPoint[];
  zoneMask: WarpZoneMaskPayload;
  boundingBox: BoundingBox;
  scale: number;
  featherPx: number;
}

/** Successful worker response. */
export interface WarpWorkerSuccess {
  type: 'result';
  requestId: string;
  width: number;
  height: number;
  warpedPixels: Uint8ClampedArray;
}

/** Failed worker response with a diagnosable reason. */
export interface WarpWorkerFailure {
  type: 'error';
  requestId: string;
  reason: string;
}

export type WarpWorkerResponse = WarpWorkerSuccess | WarpWorkerFailure;
