import { FaceAnalysisClient } from '../../image-editor/retouch/faceAnalysisClient';
import { FaceTracker, type FaceObservation } from '../../image-editor/retouch/RetouchModule/Detection/FaceTracker';

import {
  cloneVideoRetouchState,
  setVideoRetouchAnalysis,
  type VideoRetouchClipState,
  type VideoRetouchFaceTrack,
  type VideoRetouchTrackingKeyframe,
} from './videoRetouchProject';

export interface VideoRetouchAnalysisRequest {
  sourceUrl: string;
  sourceIn: number;
  duration: number;
  playbackRate: number;
  fps: number;
  state: VideoRetouchClipState;
  signal?: AbortSignal;
  onProgress?(state: VideoRetouchClipState): void;
}

const MAX_ANALYSIS_EDGE = 960;
const MAX_ANALYSIS_SAMPLES = 900;

function waitForMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Video Retouch analysis cancelled.', 'AbortError'));
  if (video.readyState >= video.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const loaded = (): void => { cleanup(); resolve(); };
    const failed = (): void => { cleanup(); reject(new Error('The selected video could not be decoded for Retouch analysis.')); };
    const aborted = (): void => { cleanup(); reject(new DOMException('Video Retouch analysis cancelled.', 'AbortError')); };
    video.addEventListener('loadedmetadata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function seek(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Video Retouch analysis cancelled.', 'AbortError'));
  const target = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : time, time));
  if (Math.abs(video.currentTime - target) < 1 / 240 && video.readyState >= video.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('seeked', complete);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const complete = (): void => { cleanup(); resolve(); };
    const failed = (): void => { cleanup(); reject(new Error('A video frame could not be decoded during Retouch analysis.')); };
    const aborted = (): void => { cleanup(); reject(new DOMException('Video Retouch analysis cancelled.', 'AbortError')); };
    video.addEventListener('seeked', complete, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    try { video.currentTime = target; } catch (error) { cleanup(); reject(error); }
  });
}

function analysisDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_ANALYSIS_EDGE) return { width, height };
  const scale = MAX_ANALYSIS_EDGE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function observationOf(face: { id: string; confidence: number; bounds: { x: number; y: number; width: number; height: number }; landmarks: Array<{ x: number; y: number; z: number }> }): FaceObservation {
  return {
    observationId: face.id,
    confidence: face.confidence,
    bounds: { ...face.bounds },
    points: face.landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  };
}

function sourceOf(status: 'detected' | 'tracked' | 'reacquired' | 'fading'): VideoRetouchTrackingKeyframe['source'] {
  if (status === 'detected') return 'detected';
  if (status === 'reacquired') return 'reacquired';
  return 'tracked';
}

function pushFrame(map: Map<string, VideoRetouchFaceTrack>, frame: ReturnType<FaceTracker['snapshot']>[number], timestamp: number): void {
  const keyframe: VideoRetouchTrackingKeyframe = {
    timestamp,
    points: frame.points.map((point) => ({ ...point })),
    bounds: { ...frame.bounds },
    confidence: frame.confidence,
    opacity: frame.opacity,
    source: sourceOf(frame.status),
  };
  const current = map.get(frame.faceId);
  if (current) {
    current.keyframes.push(keyframe);
    current.lastConfidence = frame.confidence;
    current.lostFrames = frame.lostFrames;
    return;
  }
  map.set(frame.faceId, {
    faceId: frame.faceId,
    keyframes: [keyframe],
    lastConfidence: frame.confidence,
    lostFrames: frame.lostFrames,
  });
}

/**
 * Worker-backed MediaPipe face analysis sampled across a clip. The service
 * decodes one frame at a time, never loads the whole video into memory, and
 * stores normalized tracked landmarks for interpolation during preview/export.
 */
export class VideoRetouchAnalyzer {
  async analyze(request: VideoRetouchAnalysisRequest): Promise<VideoRetouchClipState> {
    if (!window.knouxImageStudioAPI?.getVerifiedFaceModel) throw new Error('The local face model service is unavailable.');
    const duration = Math.max(0, request.duration);
    if (duration <= 0) throw new Error('Video Retouch analysis requires a non-empty clip duration.');
    const fps = Math.max(1, Number.isFinite(request.fps) ? request.fps : 30);
    const intervalFrames = Math.max(1, request.state.tracking.fullDetectionIntervalFrames);
    const requestedStep = intervalFrames / fps;
    const sampleStep = Math.max(requestedStep, duration / MAX_ANALYSIS_SAMPLES, 1 / fps);
    const totalSamples = Math.max(1, Math.floor(duration / sampleStep) + 1);
    let state = setVideoRetouchAnalysis(request.state, {
      status: 'detecting',
      progress: 0,
      processedFrames: 0,
      sampledFrames: totalSamples,
      message: 'Analyzing faces locally…',
    });
    request.onProgress?.(cloneVideoRetouchState(state));

    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.src = request.sourceUrl;
    const client = new FaceAnalysisClient(() => window.knouxImageStudioAPI.getVerifiedFaceModel());
    const tracker = new FaceTracker({
      smoothingFactor: state.tracking.smoothingFactor,
      maximumLostFrames: state.tracking.maximumLostFrames,
      reacquireFrames: state.tracking.reacquireFrames,
      minimumConfidence: state.tracking.minimumConfidence,
    });
    const tracks = new Map<string, VideoRetouchFaceTrack>();
    let selectedFaceId = state.selectedFaceId;

    try {
      await waitForMetadata(video, request.signal);
      const dimensions = analysisDimensions(video.videoWidth, video.videoHeight);
      if (dimensions.width < 1 || dimensions.height < 1) throw new Error('The video has invalid frame dimensions.');
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!context) throw new Error('Video Retouch frame extraction is unavailable on this device.');

      for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
        if (request.signal?.aborted) throw new DOMException('Video Retouch analysis cancelled.', 'AbortError');
        const localTime = Math.min(duration, sampleIndex * sampleStep);
        const sourceTime = Math.max(0, request.sourceIn + localTime * Math.max(0.1, request.playbackRate));
        await seek(video, sourceTime, request.signal);
        context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
        const frameDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const result = await client.analyze({
          imageDataUrl: frameDataUrl,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
          maxFaces: 8,
        });
        const observations = result.status === 'ready' ? result.faces.map(observationOf) : [];
        const frameTracks = tracker.update(observations);
        for (const frame of frameTracks) pushFrame(tracks, frame, localTime);
        if (!selectedFaceId && frameTracks.length > 0) {
          selectedFaceId = [...frameTracks]
            .sort((left, right) => (right.bounds.width * right.bounds.height) - (left.bounds.width * left.bounds.height))[0]?.faceId ?? null;
        }
        const progress = ((sampleIndex + 1) / totalSamples) * 100;
        state = setVideoRetouchAnalysis(state, {
          status: 'tracking',
          progress,
          processedFrames: sampleIndex + 1,
          sampledFrames: totalSamples,
          message: `Tracking faces · ${sampleIndex + 1}/${totalSamples}`,
        });
        state.faceTracks = Array.from(tracks.values()).map((track) => ({
          ...track,
          keyframes: track.keyframes.map((frame) => ({ ...frame, points: frame.points.map((point) => ({ ...point })), bounds: { ...frame.bounds } })),
        }));
        state.selectedFaceId = selectedFaceId;
        request.onProgress?.(cloneVideoRetouchState(state));
      }

      state = setVideoRetouchAnalysis(state, {
        status: tracks.size > 0 ? 'ready' : 'no-face',
        progress: 100,
        processedFrames: totalSamples,
        sampledFrames: totalSamples,
        message: tracks.size > 0 ? `${tracks.size} tracked face${tracks.size === 1 ? '' : 's'} ready.` : 'No stable face was detected in this clip.',
      });
      state.faceTracks = Array.from(tracks.values());
      state.selectedFaceId = selectedFaceId;
      return state;
    } catch (error) {
      if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        state = setVideoRetouchAnalysis(state, { status: 'cancelled', message: 'Video Retouch analysis cancelled.' });
        return state;
      }
      state = setVideoRetouchAnalysis(state, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      return state;
    } finally {
      client.dispose();
      tracker.reset();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }
}
