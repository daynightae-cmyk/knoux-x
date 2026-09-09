import {
  projectDuration,
  type MultitrackProject,
  type TimelineItem,
  type TimelineTrack,
} from '../../core/creative/multitrackProject';
import { getTimelineVideoRetouchExportTemporal } from '../../core/creative/videoRetouchEffect';
import { transitionFadeOpacity } from '../../core/creative/transitionFade';
import type { VideoRetouchClipState } from '../../core/creative/videoRetouchTemporal';
import { VideoFrameProcessor } from '../image-editor/retouch/RetouchModule/Media/VideoFrameProcessor';

/**
 * Wall-clock delivery stalls (occluded windows, throttled animation frames,
 * heavy first-frame uploads) must not corrupt the media clock: time the
 * recorder runs but no frame is drawn would bake wall gaps into the output
 * or terminate the render on the first late frame. Any inter-frame gap
 * beyond the stall threshold freezes the media clock so every media instant
 * is still drawn exactly once, in order. Pure and unit-tested.
 */
export const RENDER_STALL_RESYNC_MS = 1000;

export function resyncMediaClock(startedAt: number, lastWall: number, wallNow: number): { startedAt: number; lastWall: number } {
  const wallGap = wallNow - lastWall;
  if (wallGap > RENDER_STALL_RESYNC_MS) {
    return { startedAt: startedAt + wallGap, lastWall: wallNow };
  }
  return { startedAt, lastWall: wallNow };
}

export type MobileTimelineRenderOptions = {
  width: number;
  height: number;
  fps: number;
  videoBitsPerSecond: number;
  onProgress?(percentage: number): void;
  cancelled?(): boolean;
};

type PreparedMedia = {
  item: TimelineItem;
  track: TimelineTrack;
  element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | null;
  gain?: GainNode;
  pan?: StereoPannerNode;
  retouchCanvas?: HTMLCanvasElement;
  retouchContext?: CanvasRenderingContext2D;
  retouchProcessor?: VideoFrameProcessor;
};

function recorderMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function isMediaElement(value: PreparedMedia['element']): value is HTMLVideoElement | HTMLAudioElement {
  return value instanceof HTMLMediaElement;
}

function waitMedia(element: HTMLMediaElement): Promise<void> {
  if (element.readyState >= element.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const loaded = (): void => { cleanup(); resolve(); };
    const failed = (): void => { cleanup(); reject(new Error('A timeline media item could not be decoded.')); };
    const cleanup = (): void => {
      element.removeEventListener('loadedmetadata', loaded);
      element.removeEventListener('error', failed);
    };
    element.addEventListener('loadedmetadata', loaded, { once: true });
    element.addEventListener('error', failed, { once: true });
  });
}

function waitImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('A timeline image item could not be decoded.'));
  });
}

function activeAt(item: TimelineItem, time: number): boolean {
  return time >= item.timelineStart && time < item.timelineStart + item.duration;
}

function transitionOpacity(item: TimelineItem, localTime: number): number {
  return transitionFadeOpacity(item.transform.opacity, item.transitionIn, item.transitionOut, localTime, item.duration);
}

function audioGain(item: TimelineItem, track: TimelineTrack, localTime: number): number {
  if (track.muted || item.audio.muted) return 0;
  let value = Math.max(0, Math.min(2, track.volume * item.audio.volume));
  if (item.audio.fadeIn > 0) value *= Math.min(1, localTime / item.audio.fadeIn);
  if (item.audio.fadeOut > 0) value *= Math.min(1, (item.duration - localTime) / item.audio.fadeOut);
  return Math.max(0, value);
}

function temporalRetouch(item: TimelineItem): VideoRetouchClipState | null {
  return getTimelineVideoRetouchExportTemporal(item);
}

function ensureRetouchBuffer(prepared: PreparedMedia, state: VideoRetouchClipState, width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  processor: VideoFrameProcessor;
} | null {
  if (!state.enabled) return null;
  if (!prepared.retouchCanvas) prepared.retouchCanvas = document.createElement('canvas');
  if (prepared.retouchCanvas.width !== width) prepared.retouchCanvas.width = width;
  if (prepared.retouchCanvas.height !== height) prepared.retouchCanvas.height = height;
  if (!prepared.retouchContext) prepared.retouchContext = prepared.retouchCanvas.getContext('2d', { alpha: true, willReadFrequently: true }) ?? undefined;
  if (!prepared.retouchProcessor) prepared.retouchProcessor = new VideoFrameProcessor();
  if (!prepared.retouchContext) return null;
  return { canvas: prepared.retouchCanvas, context: prepared.retouchContext, processor: prepared.retouchProcessor };
}

function retouchedVisualSource(
  prepared: PreparedMedia,
  source: HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  localTime: number,
): CanvasImageSource {
  const state = temporalRetouch(prepared.item);
  if (!state) return source;
  const buffer = ensureRetouchBuffer(prepared, state, sourceWidth, sourceHeight);
  if (!buffer) return source;
  buffer.context.clearRect(0, 0, sourceWidth, sourceHeight);
  buffer.context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const sourceFrame = buffer.context.getImageData(0, 0, sourceWidth, sourceHeight);
  const result = buffer.processor.process(sourceFrame, state, localTime);
  buffer.context.putImageData(result.imageData, 0, 0);
  return buffer.canvas;
}

function drawVisual(
  context: CanvasRenderingContext2D,
  prepared: PreparedMedia,
  outputWidth: number,
  outputHeight: number,
  time: number,
): void {
  const { item, element } = prepared;
  const localTime = time - item.timelineStart;
  const opacity = transitionOpacity(item, localTime);
  if (opacity <= 0) return;

  if (item.kind === 'text' || item.kind === 'subtitle') {
    const text = item.text;
    if (!text) return;
    context.save();
    context.globalAlpha = opacity;
    context.translate(outputWidth / 2 + item.transform.positionX, outputHeight / 2 + item.transform.positionY);
    context.rotate(item.transform.rotation * Math.PI / 180);
    context.scale(item.transform.scale * (item.transform.flipHorizontal ? -1 : 1), item.transform.scale * (item.transform.flipVertical ? -1 : 1));
    context.font = `${text.fontWeight} ${Math.max(12, text.fontSize)}px ${text.fontFamily}`;
    context.textAlign = text.align === 'start' ? 'left' : text.align === 'end' ? 'right' : 'center';
    context.textBaseline = 'middle';
    if (text.backgroundColor !== 'transparent') {
      const metrics = context.measureText(text.text);
      const padding = Math.max(8, text.fontSize * 0.2);
      context.fillStyle = text.backgroundColor;
      context.fillRect(-metrics.width / 2 - padding, -text.fontSize / 2 - padding, metrics.width + padding * 2, text.fontSize + padding * 2);
    }
    if (text.strokeWidth > 0) {
      context.lineWidth = text.strokeWidth;
      context.strokeStyle = text.strokeColor;
      context.strokeText(text.text, 0, 0);
    }
    context.fillStyle = text.color;
    context.fillText(text.text, 0, 0);
    context.restore();
    return;
  }

  if (!(element instanceof HTMLVideoElement || element instanceof HTMLImageElement)) return;
  const sourceWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
  const sourceHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
  if (sourceWidth < 1 || sourceHeight < 1) return;
  const visualSource = retouchedVisualSource(prepared, element, sourceWidth, sourceHeight, localTime);

  const cropLeft = Math.max(0, Math.min(0.95, item.transform.cropLeft));
  const cropRight = Math.max(0, Math.min(0.95, item.transform.cropRight));
  const cropTop = Math.max(0, Math.min(0.95, item.transform.cropTop));
  const cropBottom = Math.max(0, Math.min(0.95, item.transform.cropBottom));
  const sx = sourceWidth * cropLeft;
  const sy = sourceHeight * cropTop;
  const sw = Math.max(1, sourceWidth * (1 - cropLeft - cropRight));
  const sh = Math.max(1, sourceHeight * (1 - cropTop - cropBottom));
  const baseScale = Math.min(outputWidth / sw, outputHeight / sh);
  const drawWidth = sw * baseScale;
  const drawHeight = sh * baseScale;

  context.save();
  context.globalAlpha = opacity;
  context.globalCompositeOperation = item.transform.blendMode === 'normal' ? 'source-over' : item.transform.blendMode;
  context.translate(outputWidth / 2 + item.transform.positionX, outputHeight / 2 + item.transform.positionY);
  context.rotate(item.transform.rotation * Math.PI / 180);
  context.scale(item.transform.scale * (item.transform.flipHorizontal ? -1 : 1), item.transform.scale * (item.transform.flipVertical ? -1 : 1));
  context.drawImage(visualSource, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

export async function renderMultitrackProject(
  project: MultitrackProject,
  options: MobileTimelineRenderOptions,
): Promise<{ blob: Blob; mimeType: string; duration: number }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This Android WebView does not expose MediaRecorder.');
  const mimeType = recorderMime();
  if (!mimeType) throw new Error('No supported on-device video encoder is available.');
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The current project timeline is empty.');

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(options.width / 2) * 2);
  canvas.height = Math.max(2, Math.round(options.height / 2) * 2);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas timeline rendering is unavailable.');

  const visibleTracks = [...project.tracks].filter((track) => !track.hidden).sort((left, right) => left.order - right.order);
  const solo = visibleTracks.some((track) => track.solo);
  const renderedTracks = solo ? visibleTracks.filter((track) => track.solo) : visibleTracks;
  const prepared: PreparedMedia[] = [];
  const audioContext = new AudioContext({ sampleRate: project.settings.audioSampleRate || 48_000, latencyHint: 'playback' });
  const audioDestination = audioContext.createMediaStreamDestination();

  for (const track of renderedTracks) {
    for (const item of track.items) {
      let element: PreparedMedia['element'] = null;
      if (item.sourcePath && ['video', 'audio', 'image', 'overlay'].includes(item.kind)) {
        const url = await window.knouxCreativeAPI.media.toUrl(item.sourcePath);
        if (item.kind === 'image') {
          const image = new Image();
          image.src = url;
          await waitImage(image);
          element = image;
        } else if (item.kind === 'audio') {
          const media = document.createElement('audio');
          media.preload = 'auto';
          media.src = url;
          await waitMedia(media);
          element = media;
        } else {
          const media = document.createElement('video');
          media.preload = 'auto';
          media.playsInline = true;
          media.src = url;
          await waitMedia(media);
          element = media;
        }
      }
      const entry: PreparedMedia = { item, track, element };
      if (isMediaElement(element)) {
        const source = audioContext.createMediaElementSource(element);
        const gain = audioContext.createGain();
        const pan = audioContext.createStereoPanner();
        source.connect(gain).connect(pan).connect(audioDestination);
        gain.gain.value = 0;
        pan.pan.value = Math.max(-1, Math.min(1, item.audio.pan + track.pan));
        entry.gain = gain;
        entry.pan = pan;
      }
      prepared.push(entry);
    }
  }

  const stream = canvas.captureStream(options.fps);
  audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond,
    audioBitsPerSecond: 192_000,
  });
  const completion = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener('error', () => reject(new Error('The project encoder stopped unexpectedly.')), { once: true });
    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
  });

  await audioContext.resume();
  recorder.start(1000);
  let startedAt = performance.now();
  let lastWall = startedAt;

  try {
    await new Promise<void>((resolve, reject) => {
      const frame = (): void => {
        if (options.cancelled?.()) {
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
          return;
        }
        const wallNow = performance.now();
        const resynced = resyncMediaClock(startedAt, lastWall, wallNow);
        startedAt = resynced.startedAt;
        lastWall = resynced.lastWall;
        const time = (wallNow - startedAt) / 1000;
        context.fillStyle = project.settings.backgroundColor || '#000000';
        context.fillRect(0, 0, canvas.width, canvas.height);

        for (const entry of prepared) {
          const { item, element, gain } = entry;
          const active = activeAt(item, time);
          if (isMediaElement(element)) {
            if (active) {
              const local = Math.max(0, time - item.timelineStart);
              const target = item.sourceIn + local * item.playbackRate;
              if (Math.abs(element.currentTime - target) > 0.18) {
                try { element.currentTime = Math.max(0, Math.min(Number.isFinite(element.duration) ? element.duration : target, target)); } catch { /* decoder seeking can reject transiently */ }
              }
              element.playbackRate = Math.max(0.1, Math.min(4, item.playbackRate));
              if (gain) gain.gain.setTargetAtTime(audioGain(item, entry.track, local), audioContext.currentTime, 0.01);
              if (element.paused) void element.play().catch(() => undefined);
            } else {
              if (gain) gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
              if (!element.paused) element.pause();
            }
          }
          if (active) drawVisual(context, entry, canvas.width, canvas.height, time);
        }

        options.onProgress?.(Math.min(100, (time / duration) * 100));
        if (time >= duration) {
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      try { requestAnimationFrame(frame); } catch (error) { reject(error); }
    });

    const blob = await completion;
    if (options.cancelled?.()) throw new DOMException('Project export cancelled.', 'AbortError');
    if (blob.size === 0) throw new Error('The project encoder produced an empty file.');
    options.onProgress?.(100);
    return { blob, mimeType, duration };
  } finally {
    prepared.forEach(({ element, retouchProcessor }) => {
      retouchProcessor?.clearCache();
      if (isMediaElement(element)) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      } else if (element instanceof HTMLImageElement) {
        element.removeAttribute('src');
      }
    });
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
  }
}
