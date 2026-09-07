import type { FacePoint, FaceSemanticRegion } from '../../faceAnalysisContract';
import { buildSemanticFaceRegions } from '../../faceSemanticRegions';
import type { VideoRetouchClipState, VideoRetouchLayer, VideoRetouchRegion, VideoRetouchTrackingKeyframe } from '../../../video-studio/retouch/videoRetouchProject';
import { orderedVideoRetouchLayers, resolveTrackingKeyframe } from '../../../video-studio/retouch/videoRetouchProject';
import { applyMakeupBlend, parseHexColor, type MakeupBlendMode } from '../Pipeline/BlendModes';
import { MaskCache } from '../Pipeline/MaskCache';

export interface VideoFrameRetouchResult {
  imageData: ImageData;
  appliedLayerIds: string[];
  skippedLayerIds: string[];
}

export interface VideoFrameProcessOptions {
  /** Before/After is an editor preview concern and is ignored by export unless explicitly requested. */
  respectBeforeAfter?: boolean;
}

const FACE_REGIONS = new Set<VideoRetouchRegion>([
  'face', 'lips', 'upperLip', 'lowerLip', 'cheeks', 'leftCheek', 'rightCheek', 'eyes', 'leftEye', 'rightEye',
  'eyelinerLeft', 'eyelinerRight', 'eyebrows', 'leftEyebrow', 'rightEyebrow', 'nose', 'jawline', 'skin', 'forehead', 'underEyes',
]);

const COLOR_CATEGORIES = new Set<VideoRetouchLayer['category']>(['lipstick', 'blush', 'eye-makeup', 'eyeliner', 'eyebrows', 'makeup-look', 'skin']);

const regionAlias: Partial<Record<VideoRetouchRegion, FaceSemanticRegion>> = {
  face: 'skin',
  lips: 'lips',
  upperLip: 'upperLip',
  lowerLip: 'lowerLip',
  leftCheek: 'leftCheek',
  rightCheek: 'rightCheek',
  leftEye: 'leftEye',
  rightEye: 'rightEye',
  leftEyebrow: 'leftEyebrow',
  rightEyebrow: 'rightEyebrow',
  nose: 'nose',
  jawline: 'jaw',
  skin: 'skin',
  forehead: 'forehead',
  underEyes: 'lowerEyelids',
};

function cloneImageData(imageData: ImageData): ImageData {
  return { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(imageData.data) } as ImageData;
}

function landmarksOf(frame: VideoRetouchTrackingKeyframe): FacePoint[] {
  return frame.points.map((point) => ({ x: point.x, y: point.y, z: Number.isFinite(point.z) ? Number(point.z) : 0 }));
}

function indexes(landmarks: readonly FacePoint[], values: readonly number[]): FacePoint[] {
  return values.map((index) => landmarks[index]).filter((point): point is FacePoint => Boolean(point));
}

function polygonsForRegion(frame: VideoRetouchTrackingKeyframe, region: VideoRetouchRegion): FacePoint[][] {
  const landmarks = landmarksOf(frame);
  if (landmarks.length < 468) return [];
  const semantic = buildSemanticFaceRegions(landmarks);
  const get = (name: FaceSemanticRegion): FacePoint[] => semantic.find((entry) => entry.region === name)?.polygon ?? [];
  if (region === 'cheeks') return [get('leftCheek'), get('rightCheek')].filter((polygon) => polygon.length >= 3);
  if (region === 'eyes') return [get('leftEye'), get('rightEye')].filter((polygon) => polygon.length >= 3);
  if (region === 'eyebrows') return [get('leftEyebrow'), get('rightEyebrow')].filter((polygon) => polygon.length >= 3);
  if (region === 'eyelinerLeft') {
    const line = indexes(landmarks, [33, 160, 158, 133, 153, 144]);
    return line.length >= 3 ? [line] : [];
  }
  if (region === 'eyelinerRight') {
    const line = indexes(landmarks, [362, 385, 387, 263, 373, 380]);
    return line.length >= 3 ? [line] : [];
  }
  const alias = regionAlias[region];
  if (!alias) return [];
  const polygon = get(alias);
  return polygon.length >= 3 ? [polygon] : [];
}

function effectiveIntensity(layer: VideoRetouchLayer, frame: VideoRetouchTrackingKeyframe): number {
  const opacity = typeof layer.parameters.opacity === 'number' ? Math.max(0, Math.min(100, layer.parameters.opacity)) / 100 : 1;
  return Math.max(0, Math.min(100, layer.strength * opacity * frame.opacity));
}

function colorOf(layer: VideoRetouchLayer): string | null {
  return typeof layer.parameters.color === 'string' && /^#[0-9a-f]{3,6}$/i.test(layer.parameters.color)
    ? layer.parameters.color
    : null;
}

function blendModeOf(layer: VideoRetouchLayer): MakeupBlendMode {
  return layer.blendMode === 'multiply' || layer.blendMode === 'screen' || layer.blendMode === 'soft-light'
    ? layer.blendMode
    : 'soft-light';
}

/**
 * Applies time-resolved tracked color/makeup layers to one decoded frame.
 * Geometry is normalized and independent from preview coordinates. Shape/body
 * layers remain in the shared MeshWarper path and are intentionally not faked
 * here; callers receive them in skippedLayerIds until tracking mesh data exists.
 */
export class VideoFrameProcessor {
  private readonly masks = new MaskCache();

  process(
    imageData: ImageData,
    state: VideoRetouchClipState | undefined,
    localTime: number,
    options: VideoFrameProcessOptions = {},
  ): VideoFrameRetouchResult {
    const untouched = cloneImageData(imageData);
    if (!state || !state.enabled || (options.respectBeforeAfter === true && state.beforeAfter === 'before')) {
      return { imageData: untouched, appliedLayerIds: [], skippedLayerIds: [] };
    }
    let output = untouched;
    const appliedLayerIds: string[] = [];
    const skippedLayerIds: string[] = [];
    const layers = orderedVideoRetouchLayers(state, localTime);

    for (const layer of layers) {
      if (!FACE_REGIONS.has(layer.targetRegion) || !COLOR_CATEGORIES.has(layer.category)) {
        skippedLayerIds.push(layer.id);
        continue;
      }
      const color = colorOf(layer);
      if (!color) {
        skippedLayerIds.push(layer.id);
        continue;
      }
      const candidateTracks = state.applyAllFaces
        ? state.faceTracks
        : state.faceTracks.filter((track) => track.faceId === (layer.faceId ?? state.selectedFaceId ?? state.faceTracks[0]?.faceId));
      let layerApplied = false;
      for (const track of candidateTracks) {
        const frame = resolveTrackingKeyframe(track, localTime);
        if (!frame || frame.opacity <= 0 || frame.confidence < state.tracking.minimumConfidence) continue;
        const polygons = polygonsForRegion(frame, layer.targetRegion);
        for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
          const polygon = polygons[polygonIndex];
          const mask = this.masks.get(output.width, output.height, `${track.faceId}:${layer.targetRegion}:${polygonIndex}`, polygon);
          if (mask.pixelCount <= 0) continue;
          output = applyMakeupBlend(output, mask, parseHexColor(color), effectiveIntensity(layer, frame), blendModeOf(layer));
          layerApplied = true;
        }
      }
      if (layerApplied) appliedLayerIds.push(layer.id);
      else skippedLayerIds.push(layer.id);
    }

    return { imageData: output, appliedLayerIds, skippedLayerIds };
  }

  clearCache(): void {
    this.masks.clear();
  }
}
