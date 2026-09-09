/**
 * KNOUX-X — PACKAGED WINDOWS RETOUCH E2E (test-only renderer module)
 *
 * Query-gated: this module is dynamically imported by src/main.tsx ONLY when
 * the renderer boots with `?knouxRetouchE2E=1`. Normal product boots never
 * load it, and it changes no product behavior.
 *
 * It exercises the SAME production retouch path the Video Studio uses:
 *   creative:path-to-media-url (media open) -> <video> decode (Video Studio
 *   preview path) -> image-studio:get-pose-model (verified packaged model) ->
 *   BodyAnalysisClient -> VideoBodyTracker/recordVideoBodies ->
 *   createVideoRetouchState/addVideoRetouchLayer (Body Retouch enabled with a
 *   deterministic nonzero Body Reshape control) ->
 *   VideoFrameProcessor.process (the exact class VideoRetouchPreviewOverlay
 *   renders with) -> preview pixel delta.
 *
 * Processed frames are published as PNG data URLs on
 * `window.__knouxRetouchE2E` for the main-process E2E handler, which exports
 * them through the REAL product ExportService/FFmpeg pipeline.
 */

import type { BodySegmentationMask } from '../features/image-editor/retouch/bodyAnalysisContract';
import { BodyAnalysisClient } from '../features/image-editor/retouch/bodyAnalysisClient';
import { createBodyFreezeMask } from '../features/image-editor/retouch/bodyReshapeGeometry';
import { VideoFrameProcessor } from '../features/image-editor/retouch/RetouchModule/Media/VideoFrameProcessor';
import type { VideoRetouchBodyTrack } from '../core/creative/videoRetouchTemporal';
import { recordVideoBodies } from '../features/video-studio/retouch/recordVideoBodies';
import { VideoBodyTracker } from '../features/video-studio/retouch/VideoBodyTracker';
import {
  aggregateBodyControls,
  resolveBodyGeometryForFrame,
} from '../features/video-studio/retouch/VideoRetouchBodyGeometry';
import {
  addVideoRetouchLayer,
  createVideoRetouchState,
} from '../features/video-studio/retouch/videoRetouchProject';

export interface PackagedRetouchE2EFrameEvidence {
  frame: number;
  time: number;
  bodyCount: number;
  confidence: number;
  landmarks: number;
  trackId: string;
  strokeCount: number;
  segmentationAvailable: boolean;
  freezeCoverage: number | null;
  backgroundDelta: number;
  zeroDelta: number;
  beforeDelta: number;
  disabledDelta: number;
  pixelDelta: number;
}

export interface PackagedRetouchE2ESummary {
  rendererReady: boolean;
  mediaOpened: boolean;
  videoStudioReady: boolean;
  retouchReady: boolean;
  product: string;
  packageVersion: string;
  buildSha: string;
  packaged: boolean;
  sourcePath: string;
  mediaUrl: string;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  frameCount: number;
  fps: number;
  bodyDetectionCount: number;
  bodyTrackId: string;
  strokeCount: number;
  previewPixelDelta: number;
  confidenceMin: number;
  freezeCoverageMin: number | null;
  freezeCoverageMax: number | null;
  videoStudioProviders: number;
}

export interface PackagedRetouchE2EStatus {
  started: boolean;
  done: boolean;
  failed: string | null;
  summary: PackagedRetouchE2ESummary | null;
  frames: string[];
  frameEvidence: PackagedRetouchE2EFrameEvidence[];
}

declare global {
  interface Window {
    __knouxRetouchE2E?: PackagedRetouchE2EStatus;
  }
}

const FPS = 15;
const MAX_FRAMES = 45;

function fail(message: string): never {
  throw new Error(message);
}

function assertBridge(): void {
  if (typeof window.knouxCreativeAPI?.media?.toUrl !== 'function') fail('PACKAGED_RETOUCH_E2E_NO_MEDIA_BRIDGE');
  if (typeof window.knouxImageStudioAPI?.getVerifiedPoseModel !== 'function') fail('PACKAGED_RETOUCH_E2E_NO_MODEL_BRIDGE');
  if (typeof window.knouxVideoStudioAPI?.providerStatus !== 'function') fail('PACKAGED_RETOUCH_E2E_NO_VIDEO_STUDIO_BRIDGE');
  if (typeof window.knouxAPI?.system?.getBuildInfo !== 'function') fail('PACKAGED_RETOUCH_E2E_NO_SYSTEM_BRIDGE');
}

function loadVideoMetadata(video: HTMLVideoElement, sourceUrl: string): Promise<void> {
  if (video.readyState >= video.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed);
    };
    const loaded = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error('PACKAGED_RETOUCH_E2E_VIDEO_DECODE_FAILED'));
    };
    video.addEventListener('loadedmetadata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.src = sourceUrl;
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1 / 240 && video.readyState >= video.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('seeked', complete);
      video.removeEventListener('error', failed);
    };
    const complete = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error(`PACKAGED_RETOUCH_E2E_SEEK_FAILED t=${time}`));
    };
    video.addEventListener('seeked', complete, { once: true });
    video.addEventListener('error', failed, { once: true });
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function pixelDelta(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += Math.abs(left[index] - right[index]);
  return sum;
}

export async function runPackagedRetouchE2E(sourcePath: string): Promise<PackagedRetouchE2ESummary> {
  const status: PackagedRetouchE2EStatus = {
    started: true,
    done: false,
    failed: null,
    summary: null,
    frames: [],
    frameEvidence: [],
  };
  window.__knouxRetouchE2E = status;
  try {
    assertBridge();

    const buildInfo = await window.knouxAPI.system.getBuildInfo();
    const rendererReady = buildInfo.product === 'Knoux X' && buildInfo.packaged === true;

    let videoStudioProviders = 0;
    let videoStudioReady = false;
    try {
      const providers = await window.knouxVideoStudioAPI.listProviders();
      videoStudioProviders = Array.isArray(providers) ? providers.length : 0;
      await window.knouxVideoStudioAPI.providerStatus();
      videoStudioReady = true;
    } catch {
      videoStudioReady = false;
    }

    // Media open through the REAL product path: authorize (main) + path-to-media-url IPC.
    const mediaUrl = await window.knouxCreativeAPI.media.toUrl(sourcePath);
    const mediaOpened = typeof mediaUrl === 'string' && mediaUrl.startsWith('file:');

    // Real Chromium decode of the real fixture (the Video Studio preview path).
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.crossOrigin = 'anonymous';
    await loadVideoMetadata(video, mediaUrl);
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const videoDuration = video.duration;
    if (!(videoWidth > 0 && videoHeight > 0 && Number.isFinite(videoDuration) && videoDuration > 0)) {
      fail('PACKAGED_RETOUCH_E2E_INVALID_VIDEO_METADATA');
    }

    // Verified packaged pose model through the REAL production IPC.
    const model = (await window.knouxImageStudioAPI.getVerifiedPoseModel()) as {
      status: string;
      modelId: string;
      reason?: string;
      buffer?: Uint8Array;
    };
    if (model.status !== 'ready' || !(model.buffer instanceof Uint8Array) || model.buffer.length === 0) {
      fail(`PACKAGED_RETOUCH_E2E_MODEL_UNAVAILABLE ${model.status} ${model.reason ?? ''}`);
    }

    // Body Retouch enabled with a deterministic nonzero Body Reshape control.
    const client = new BodyAnalysisClient(() => Promise.resolve(model));
    const tracker = new VideoBodyTracker();
    const tracks = new Map<string, VideoRetouchBodyTrack>();
    let state = createVideoRetouchState();
    state = addVideoRetouchLayer(state, {
      templateId: 'body-proof',
      category: 'body-shape',
      targetRegion: 'waist',
      strength: 100,
      parameters: { waist: -65, torsoWidth: -35 },
      applyScope: 'clip',
    });

    const canvas = document.createElement('canvas');
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const context = canvas.getContext('2d');
    if (!context) fail('PACKAGED_RETOUCH_E2E_NO_CANVAS');
    const processor = new VideoFrameProcessor();

    const frameCount = Math.max(1, Math.min(MAX_FRAMES, Math.round(videoDuration * FPS)));
    let confidenceMin = Number.POSITIVE_INFINITY;
    let freezeMin: number | null = null;
    let freezeMax: number | null = null;
    let previewPixelDelta = 0;

    try {
      for (let frame = 0; frame < frameCount; frame += 1) {
        const time = Math.min(Math.max(0, videoDuration - 1 / FPS), frame / FPS);
        // eslint-disable-next-line no-await-in-loop
        await seekVideo(video, time);
        context.drawImage(video, 0, 0, videoWidth, videoHeight);
        const input = context.getImageData(0, 0, videoWidth, videoHeight);
        // eslint-disable-next-line no-await-in-loop
        const result = await client.analyze({
          imageDataUrl: canvas.toDataURL('image/png'),
          imageWidth: videoWidth,
          imageHeight: videoHeight,
          maxBodies: 1,
        });
        if (result.status !== 'ready') fail(`PACKAGED_RETOUCH_E2E_ANALYSIS_FAILED frame=${frame} ${result.reason}`);
        if (result.bodies.length === 0) fail(`PACKAGED_RETOUCH_E2E_NO_BODY frame=${frame}`);
        recordVideoBodies(tracker, tracks, result, time);
        state.bodyTracks = [...tracks.values()];
        const geometry = resolveBodyGeometryForFrame(state, time, videoWidth, videoHeight, aggregateBodyControls(state.layers));
        if (geometry.strokes.length === 0) fail(`PACKAGED_RETOUCH_E2E_NO_STROKES frame=${frame}`);
        const options: { bodySegmentation?: BodySegmentationMask } = { bodySegmentation: result.segmentationMask };
        const zero = { ...state, layers: [{ ...state.layers[0], strength: 0 }] };
        const disabled = processor.process(input, { ...state, enabled: false }, time, options);
        const before = processor.process(input, { ...state, beforeAfter: 'before' as const }, time, {
          ...options,
          respectBeforeAfter: true,
        });
        const neutral = processor.process(input, zero, time, options);
        const rendered = processor.process(input, state, time, options);
        const delta = pixelDelta(input.data, rendered.imageData.data);
        if (pixelDelta(input.data, disabled.imageData.data) !== 0) fail(`PACKAGED_RETOUCH_E2E_DISABLED_MUTATED frame=${frame}`);
        if (pixelDelta(input.data, before.imageData.data) !== 0) fail(`PACKAGED_RETOUCH_E2E_BEFORE_MUTATED frame=${frame}`);
        if (pixelDelta(input.data, neutral.imageData.data) !== 0) fail(`PACKAGED_RETOUCH_E2E_ZERO_MUTATED frame=${frame}`);
        if (!(delta > 0)) fail(`PACKAGED_RETOUCH_E2E_NO_PREVIEW_DELTA frame=${frame}`);
        if (rendered.appliedLayerIds.length !== 1) fail(`PACKAGED_RETOUCH_E2E_LAYER_NOT_APPLIED frame=${frame}`);
        let freezeCoverage: number | null = null;
        let backgroundDelta = 0;
        if (result.segmentationMask && geometry.geometry) {
          const freeze = createBodyFreezeMask(result.segmentationMask, geometry.geometry);
          const frozen = freeze.data.filter((value, index) => index % 4 === 3 && value > 0).length;
          freezeCoverage = frozen / (videoWidth * videoHeight);
          if (!(freezeCoverage < 1)) fail(`PACKAGED_RETOUCH_E2E_FULLY_FROZEN frame=${frame}`);
          for (let index = 0; index < input.data.length; index += 4) {
            if (freeze.data[index + 3] === 255) {
              for (let channel = 0; channel < 3; channel += 1) {
                backgroundDelta += Math.abs(input.data[index + channel] - rendered.imageData.data[index + channel]);
              }
            }
          }
          if (backgroundDelta !== 0) fail(`PACKAGED_RETOUCH_E2E_BACKGROUND_MUTATED frame=${frame}`);
          freezeMin = freezeMin === null ? freezeCoverage : Math.min(freezeMin, freezeCoverage);
          freezeMax = freezeMax === null ? freezeCoverage : Math.max(freezeMax, freezeCoverage);
        }
        context.putImageData(new ImageData(rendered.imageData.data, videoWidth, videoHeight), 0, 0);
        status.frames.push(canvas.toDataURL('image/png'));
        const body = result.bodies[0];
        confidenceMin = Math.min(confidenceMin, body.confidence);
        previewPixelDelta = frame === 0 ? delta : previewPixelDelta;
        status.frameEvidence.push({
          frame,
          time,
          bodyCount: result.bodies.length,
          confidence: body.confidence,
          landmarks: Object.keys(body.landmarks).length,
          trackId: state.bodyTracks[0].bodyId,
          strokeCount: geometry.strokes.length,
          segmentationAvailable: result.segmentationAvailable,
          freezeCoverage,
          backgroundDelta,
          zeroDelta: 0,
          beforeDelta: 0,
          disabledDelta: 0,
          pixelDelta: delta,
        });
      }
    } finally {
      client.dispose();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    const first = status.frameEvidence[0];
    const summary: PackagedRetouchE2ESummary = {
      rendererReady,
      mediaOpened,
      videoStudioReady,
      retouchReady: status.frameEvidence.length === frameCount && videoStudioReady,
      product: buildInfo.product,
      packageVersion: buildInfo.version,
      buildSha: buildInfo.sha,
      packaged: buildInfo.packaged,
      sourcePath,
      mediaUrl,
      videoWidth,
      videoHeight,
      videoDuration,
      frameCount,
      fps: FPS,
      bodyDetectionCount: first.bodyCount,
      bodyTrackId: first.trackId,
      strokeCount: first.strokeCount,
      previewPixelDelta,
      confidenceMin,
      freezeCoverageMin: freezeMin,
      freezeCoverageMax: freezeMax,
      videoStudioProviders,
    };
    status.summary = summary;
    status.done = true;
    return summary;
  } catch (error) {
    status.failed = error instanceof Error ? error.stack ?? error.message : String(error);
    status.done = true;
    throw error;
  }
}

export function maybeStartPackagedRetouchE2E(): boolean {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return false;
  }
  if (params.get('knouxRetouchE2E') !== '1') return false;
  const source = params.get('source') ?? '';
  if (!source) {
    window.__knouxRetouchE2E = { started: true, done: true, failed: 'PACKAGED_RETOUCH_E2E_MISSING_SOURCE', summary: null, frames: [], frameEvidence: [] };
    return true;
  }
  void runPackagedRetouchE2E(source).catch(() => undefined);
  return true;
}
