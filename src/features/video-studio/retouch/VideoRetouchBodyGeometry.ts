import type { BodyPoint, DerivedBodyGeometry } from '../../image-editor/retouch/bodyAnalysisContract';
import { bodyReshapeStrokes, EMPTY_BODY_RESHAPE_CONTROLS, type BodyReshapeControls } from '../../image-editor/retouch/bodyReshapeGeometry';
import type { LiquifyStroke } from '../../image-editor/retouch/liquify/liquifyMesh';
import type { VideoRetouchBodyAnchorPoint, VideoRetouchBodyAnchorSegment } from '../../../core/creative/videoRetouchTemporal';

import type { VideoRetouchClipState, VideoRetouchLayer } from './videoRetouchProject';
import { VideoRetouchFrameResolver } from './VideoRetouchFrameResolver';

export interface BodyGeometryFrame {
  strokes: LiquifyStroke[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  geometry?: DerivedBodyGeometry;
}
const resolver = new VideoRetouchFrameResolver();
export function resolveBodyGeometryForFrame(state: VideoRetouchClipState, localTime: number, imageWidth: number, imageHeight: number, controls: BodyReshapeControls): BodyGeometryFrame {
  const body = resolver.resolve(state, localTime).targetBody;
  if (!body?.available || !body.keyframe || imageWidth < 1 || imageHeight < 1) return { strokes: [], bounds: null };
  const anchors = body.keyframe.anchors;
  const point = (p: VideoRetouchBodyAnchorPoint): BodyPoint => ({ ...p, z: 0, presence: p.visibility });
  const segment = (s: VideoRetouchBodyAnchorSegment | null) => s ? ({ ...s, left: point(s.left), right: point(s.right), center: point(s.center) }) : null;
  const limb = (l: [VideoRetouchBodyAnchorPoint, VideoRetouchBodyAnchorPoint, VideoRetouchBodyAnchorPoint] | null): [BodyPoint, BodyPoint, BodyPoint] | null => l ? [point(l[0]), point(l[1]), point(l[2])] : null;
  const geometry: DerivedBodyGeometry = {
    head: anchors.head ? { ...anchors.head, center: point(anchors.head.center) } : null,
    shoulders: segment(anchors.shoulders), waist: segment(anchors.waist), hips: segment(anchors.hips),
    arms: { left: limb(anchors.arms.left), right: limb(anchors.arms.right) },
    legs: { left: limb(anchors.legs.left), right: limb(anchors.legs.right) }, subjectBounds: null,
  };
  const points = [geometry.shoulders?.left, geometry.shoulders?.right, geometry.hips?.left, geometry.hips?.right].filter((p): p is BodyPoint => !!p);
  if (points.length < 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 2 || Math.abs(p.y) > 2)) return { strokes: [], bounds: null };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  geometry.subjectBounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const faded = Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, value * body.keyframe!.opacity])) as unknown as BodyReshapeControls;
  return { strokes: bodyReshapeStrokes(geometry, imageWidth, imageHeight, faded), geometry, bounds: geometry.subjectBounds };
}
export function aggregateBodyControls(layers: VideoRetouchLayer[]): BodyReshapeControls {
  const controls = { ...EMPTY_BODY_RESHAPE_CONTROLS };
  for (const layer of layers) {
    if (layer.category !== 'body-shape' || !layer.active) continue;
    for (const key of Object.keys(controls) as (keyof BodyReshapeControls)[]) {
      const value = layer.parameters[key];
      if (typeof value === 'number' && Number.isFinite(value)) controls[key] = (controls[key] ?? 0) + value * Math.max(0, Math.min(100, layer.strength)) / 100;
    }
  }
  return controls;
}
