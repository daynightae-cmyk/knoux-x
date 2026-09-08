import type { DerivedBodyGeometry } from '../../image-editor/retouch/bodyAnalysisContract';
import { bodyReshapeStrokes, type BodyReshapeControls } from '../../image-editor/retouch/bodyReshapeGeometry';
import type { LiquifyStroke } from '../../image-editor/retouch/liquify/liquifyMesh';
import type { VideoRetouchBodyAnchorSet } from '../../../core/creative/videoRetouchTemporal';

import type { VideoRetouchClipState, VideoRetouchLayer } from './videoRetouchProject';

export interface BodyGeometryFrame {
  strokes: LiquifyStroke[];
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export function resolveBodyGeometryForFrame(
  state: VideoRetouchClipState,
  localTime: number,
  imageWidth: number,
  imageHeight: number,
  controls: BodyReshapeControls,
): BodyGeometryFrame {
  const time = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
  const bodyTracks = state.bodyTracks ?? [];
  let bodyFrame: { timestamp: number; anchors?: VideoRetouchBodyAnchorSet; opacity: number } | null = null;
  if (bodyTracks.length > 0) {
    const selectedBody = bodyTracks.length > 0 ? (bodyTracks[0] ?? null) : null;
    if (selectedBody) {
      const keyframes = selectedBody.keyframes;
      if (keyframes.length > 0) {
        if (time <= keyframes[0].timestamp) bodyFrame = { timestamp: time, anchors: keyframes[0].anchors, opacity: keyframes[0].opacity };
        else {
          const last = keyframes[keyframes.length - 1];
          if (time >= last.timestamp) bodyFrame = { timestamp: time, anchors: last.anchors, opacity: last.opacity };
          else {
            for (let index = 1; index < keyframes.length; index += 1) {
              const right = keyframes[index];
              if (time > right.timestamp) continue;
              const left = keyframes[index - 1];
              const span = right.timestamp - left.timestamp;
              const amount = span <= 0 ? 1 : (time - left.timestamp) / span;
              bodyFrame = { timestamp: time, anchors: right.anchors, opacity: left.opacity + (right.opacity - left.opacity) * amount };
              break;
            }
          }
        }
      }
    }
  }
  if (!bodyFrame || bodyFrame.opacity <= 0) return { strokes: [], bounds: null };
  let geometry: DerivedBodyGeometry;
  try {
    if (!bodyFrame.anchors) return { strokes: [], bounds: null };
    geometry = {
      head: bodyFrame.anchors.head ? { center: { x: bodyFrame.anchors.head.center.x, y: bodyFrame.anchors.head.center.y, z: 0, visibility: 1, presence: 1 }, radius: bodyFrame.anchors.head.radius } : null,
      shoulders: bodyFrame.anchors.shoulders ? { left: { x: bodyFrame.anchors.shoulders.left.x, y: bodyFrame.anchors.shoulders.left.y, z: 0, visibility: 1, presence: 1 }, right: { x: bodyFrame.anchors.shoulders.right.x, y: bodyFrame.anchors.shoulders.right.y, z: 0, visibility: 1, presence: 1 }, center: { x: bodyFrame.anchors.shoulders.center.x, y: bodyFrame.anchors.shoulders.center.y, z: 0, visibility: 1, presence: 1 }, width: bodyFrame.anchors.shoulders.width } : null,
      waist: bodyFrame.anchors.waist ? { left: { x: bodyFrame.anchors.waist.left.x, y: bodyFrame.anchors.waist.left.y, z: 0, visibility: 1, presence: 1 }, right: { x: bodyFrame.anchors.waist.right.x, y: bodyFrame.anchors.waist.right.y, z: 0, visibility: 1, presence: 1 }, center: { x: bodyFrame.anchors.waist.center.x, y: bodyFrame.anchors.waist.center.y, z: 0, visibility: 1, presence: 1 }, width: bodyFrame.anchors.waist.width } : null,
      hips: bodyFrame.anchors.hips ? { left: { x: bodyFrame.anchors.hips.left.x, y: bodyFrame.anchors.hips.left.y, z: 0, visibility: 1, presence: 1 }, right: { x: bodyFrame.anchors.hips.right.x, y: bodyFrame.anchors.hips.right.y, z: 0, visibility: 1, presence: 1 }, center: { x: bodyFrame.anchors.hips.center.x, y: bodyFrame.anchors.hips.center.y, z: 0, visibility: 1, presence: 1 }, width: bodyFrame.anchors.hips.width } : null,
      arms: { left: bodyFrame.anchors.arms.left ? [{ x: bodyFrame.anchors.arms.left[0].x, y: bodyFrame.anchors.arms.left[0].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.arms.left[1].x, y: bodyFrame.anchors.arms.left[1].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.arms.left[2].x, y: bodyFrame.anchors.arms.left[2].y, z: 0, visibility: 1, presence: 1 }] : null, right: bodyFrame.anchors.arms.right ? [{ x: bodyFrame.anchors.arms.right[0].x, y: bodyFrame.anchors.arms.right[0].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.arms.right[1].x, y: bodyFrame.anchors.arms.right[1].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.arms.right[2].x, y: bodyFrame.anchors.arms.right[2].y, z: 0, visibility: 1, presence: 1 }] : null },
      legs: { left: bodyFrame.anchors.legs.left ? [{ x: bodyFrame.anchors.legs.left[0].x, y: bodyFrame.anchors.legs.left[0].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.legs.left[1].x, y: bodyFrame.anchors.legs.left[1].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.legs.left[2].x, y: bodyFrame.anchors.legs.left[2].y, z: 0, visibility: 1, presence: 1 }] : null, right: bodyFrame.anchors.legs.right ? [{ x: bodyFrame.anchors.legs.right[0].x, y: bodyFrame.anchors.legs.right[0].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.legs.right[1].x, y: bodyFrame.anchors.legs.right[1].y, z: 0, visibility: 1, presence: 1 }, { x: bodyFrame.anchors.legs.right[2].x, y: bodyFrame.anchors.legs.right[2].y, z: 0, visibility: 1, presence: 1 }] : null },
      subjectBounds: { x: 0, y: 0, width: imageWidth, height: imageHeight },
    };
  } catch {
    return { strokes: [], bounds: null };
  }
  const strokes = bodyReshapeStrokes(geometry, imageWidth, imageHeight, controls);
  return { strokes, bounds: bodyFrame?.anchors ? { x: 0, y: 0, width: imageWidth, height: imageHeight } : null };
}

export function aggregateBodyControls(layers: VideoRetouchLayer[]): BodyReshapeControls {
  const controls: BodyReshapeControls = {
    overallSlim: 0, waist: 0, hips: 0, shoulders: 0, arms: 0, legs: 0, legLength: 0, torsoWidth: 0,
    bodySize: 0, headSize: 0, upperArmSize: 0, forearmSize: 0, thighWidth: 0, calfWidth: 0, abdomenWidth: 0, hipVolume: 0, waistCurve: 0,
  };
  for (const layer of layers) {
    if (layer.category !== 'body-shape' || !layer.active) continue;
    const strength = layer.strength / 100;
    const params = layer.parameters;
    const apply = (key: keyof BodyReshapeControls, paramKey: string) => {
      const val = params[paramKey];
      if (typeof val === 'number') controls[key] = (controls[key] ?? 0) + val * strength;
    };
    apply('waist', 'waist'); apply('hips', 'hips'); apply('shoulders', 'shoulders');
    apply('arms', 'arms'); apply('legs', 'legs'); apply('legLength', 'legLength');
    apply('torsoWidth', 'torsoWidth'); apply('bodySize', 'bodySize'); apply('headSize', 'headSize');
    apply('upperArmSize', 'upperArmSize'); apply('forearmSize', 'forearmSize');
    apply('thighWidth', 'thighWidth'); apply('calfWidth', 'calfWidth');
    apply('abdomenWidth', 'abdomenWidth'); apply('hipVolume', 'hipVolume'); apply('waistCurve', 'waistCurve');
  }
  return controls;
}
