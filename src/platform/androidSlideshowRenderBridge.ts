import type { SlideshowRenderSnapshot } from '../../electron/creative/slideshow-render-service';
import type { SlideshowRenderFormat } from '../core/creative/slideshowRender';
import {
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
  type SlideshowAudioTrack,
  type SlideshowProject,
  type SlideshowSlide,
} from '../core/creative/slideshowProject';

const listeners = new Set<(snapshot: SlideshowRenderSnapshot) => void>();
const jobs = new Map<string, SlideshowRenderSnapshot>();
const results = new Map<string, { blob: Blob; fileName: string }>();
const cancelFlags = new Set<string>();

function randomId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function mimeFor(format: SlideshowRenderFormat): string {
  if (format === 'gif') return '';
  const candidates = format === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function clone(snapshot: SlideshowRenderSnapshot): SlideshowRenderSnapshot {
  return structuredClone(snapshot);
}

function publish(snapshot: SlideshowRenderSnapshot): void {
  jobs.set(snapshot.id, clone(snapshot));
  listeners.forEach((listener) => listener(clone(snapshot)));
}

function cleanName(value: string): string {
  return value.normalize('NFC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'KNOUX-slideshow';
}

function waitImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('A slideshow image could not be decoded.'));
  });
}

function waitMedia(media: HTMLMediaElement): Promise<void> {
  if (media.readyState >= media.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const loaded = (): void => { cleanup(); resolve(); };
    const failed = (): void => { cleanup(); reject(new Error('A slideshow media item could not be decoded.')); };
    const cleanup = (): void => {
      media.removeEventListener('loadedmetadata', loaded);
      media.removeEventListener('error', failed);
    };
    media.addEventListener('loadedmetadata', loaded, { once: true });
    media.addEventListener('error', failed, { once: true });
  });
}

function drawFitted(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  slide: SlideshowSlide,
): void {
  const fill = slide.fit !== 'fit';
  const scale = (fill ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight)) * slide.cropZoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const focalOffsetX = (slide.focalX - 0.5) * Math.max(0, drawWidth - width);
  const focalOffsetY = (slide.focalY - 0.5) * Math.max(0, drawHeight - height);
  context.drawImage(source, (width - drawWidth) / 2 - focalOffsetX, (height - drawHeight) / 2 - focalOffsetY, drawWidth, drawHeight);
}

function transitionAlpha(slide: SlideshowSlide, local: number): number {
  if (slide.transition === 'none' || slide.transitionDuration <= 0) return 1;
  const incoming = Math.min(1, local / Math.max(0.001, slide.transitionDuration));
  const outgoing = Math.min(1, (slide.duration - local) / Math.max(0.001, slide.transitionDuration));
  return Math.max(0, Math.min(1, Math.min(incoming, outgoing)));
}

function drawTitle(context: CanvasRenderingContext2D, slide: SlideshowSlide, width: number, height: number): void {
  context.fillStyle = slide.backgroundColor || '#000000';
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.font = `700 ${Math.max(34, Math.round(width * 0.055))}px system-ui, sans-serif`;
  context.fillText(slide.title || (slide.kind === 'end-card' ? 'Thank you' : 'KNOUX X'), width / 2, height * 0.45, width * 0.86);
  if (slide.caption) {
    context.fillStyle = 'rgba(255,255,255,.82)';
    context.font = `500 ${Math.max(20, Math.round(width * 0.024))}px system-ui, sans-serif`;
    context.fillText(slide.caption, width / 2, height * 0.58, width * 0.82);
  }
}

function drawCaption(context: CanvasRenderingContext2D, slide: SlideshowSlide, width: number, height: number): void {
  if (!slide.caption || slide.kind === 'title' || slide.kind === 'end-card') return;
  const fontSize = Math.max(18, Math.round(width * 0.022));
  context.save();
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const metrics = context.measureText(slide.caption);
  const boxWidth = Math.min(width * 0.9, metrics.width + fontSize * 1.4);
  context.fillStyle = 'rgba(0,0,0,.62)';
  context.fillRect((width - boxWidth) / 2, height - fontSize * 3.2, boxWidth, fontSize * 2.1);
  context.fillStyle = '#ffffff';
  context.fillText(slide.caption, width / 2, height - fontSize * 2.15, boxWidth - fontSize);
  context.restore();
}

function audioTrackEnd(track: SlideshowAudioTrack, projectDurationSeconds: number): number {
  const available = track.sourceOut ?? track.sourceDuration ?? projectDurationSeconds;
  const span = Math.max(0, available - track.sourceIn);
  return track.start + (track.loop ? projectDurationSeconds : span);
}

async function executeRender(project: SlideshowProject, format: SlideshowRenderFormat, snapshot: SlideshowRenderSnapshot): Promise<void> {
  const mime = mimeFor(format);
  if (!mime) {
    throw new Error(format === 'mp4'
      ? 'This Android WebView does not expose MP4 MediaRecorder. Update Android System WebView or use a device with MP4 recording support.'
      : format === 'gif' ? 'GIF slideshow export is not supported by the Android local renderer yet.' : 'No WebM encoder is available.');
  }
  const size = slideshowOutputSize(project);
  const duration = slideshowDuration(project);
  if (duration <= 0 || project.slides.length === 0) throw new Error('Add at least one photo or video before rendering.');
  const ranges = slideTimelineRanges(project.slides);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Android slideshow canvas is unavailable.');

  const slideMedia = new Map<string, HTMLImageElement | HTMLVideoElement>();
  for (const slide of project.slides) {
    if (!slide.sourcePath || slide.kind === 'title' || slide.kind === 'end-card') continue;
    const url = await window.knouxCreativeAPI.media.toUrl(slide.sourcePath);
    if (slide.kind === 'image') {
      const image = new Image();
      image.src = url;
      await waitImage(image);
      slideMedia.set(slide.id, image);
    } else {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.playsInline = true;
      video.src = url;
      await waitMedia(video);
      slideMedia.set(slide.id, video);
    }
  }

  const audioContext = new AudioContext({ sampleRate: 48_000, latencyHint: 'playback' });
  const destination = audioContext.createMediaStreamDestination();
  const audioEntries: Array<{ track: SlideshowAudioTrack; element: HTMLAudioElement; gain: GainNode }> = [];
  for (const track of project.audioTracks) {
    const url = await window.knouxCreativeAPI.media.toUrl(track.sourcePath);
    const element = document.createElement('audio');
    element.preload = 'auto';
    element.src = url;
    element.loop = track.loop;
    await waitMedia(element);
    const source = audioContext.createMediaElementSource(element);
    const gain = audioContext.createGain();
    source.connect(gain).connect(destination);
    gain.gain.value = 0;
    audioEntries.push({ track, element, gain });
  }

  const stream = canvas.captureStream(project.fps);
  destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(4_000_000, Math.round(size.width * size.height * project.fps * 0.08)), audioBitsPerSecond: 192_000 });
  const output = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener('error', () => reject(new Error('Android slideshow encoder failed.')), { once: true });
    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mime })), { once: true });
  });

  snapshot.status = 'rendering';
  snapshot.percentage = 1;
  publish(snapshot);
  await audioContext.resume();
  recorder.start(1000);
  const startedAt = performance.now();

  try {
    await new Promise<void>((resolve) => {
      const frame = (): void => {
        if (cancelFlags.has(snapshot.id)) {
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
          return;
        }
        const time = (performance.now() - startedAt) / 1000;
        context.fillStyle = project.backgroundColor || '#000000';
        context.fillRect(0, 0, size.width, size.height);

        project.slides.forEach((slide, index) => {
          const range = ranges[index];
          if (!range || time < range.start || time >= range.end) return;
          const local = Math.max(0, time - range.start);
          context.save();
          context.globalAlpha = transitionAlpha(slide, local);
          if (slide.kind === 'title' || slide.kind === 'end-card') {
            drawTitle(context, slide, size.width, size.height);
          } else {
            const media = slideMedia.get(slide.id);
            if (media instanceof HTMLVideoElement) {
              const target = slide.sourceIn + Math.min(slide.duration, local);
              if (Math.abs(media.currentTime - target) > 0.18) {
                try { media.currentTime = target; } catch { /* best effort seek */ }
              }
              media.muted = true;
              if (media.paused) void media.play().catch(() => undefined);
              drawFitted(context, media, media.videoWidth || 1, media.videoHeight || 1, size.width, size.height, slide);
            } else if (media instanceof HTMLImageElement) {
              drawFitted(context, media, media.naturalWidth || 1, media.naturalHeight || 1, size.width, size.height, slide);
            }
            drawCaption(context, slide, size.width, size.height);
          }
          context.restore();
        });

        audioEntries.forEach(({ track, element, gain }) => {
          const end = audioTrackEnd(track, duration);
          const active = time >= track.start && time < end;
          if (!active) {
            gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
            if (!element.paused) element.pause();
            return;
          }
          const local = time - track.start;
          const sourceTime = track.sourceIn + (track.loop && element.duration > 0 ? local % element.duration : local);
          if (Math.abs(element.currentTime - sourceTime) > 0.2) {
            try { element.currentTime = Math.max(0, Math.min(Number.isFinite(element.duration) ? element.duration : sourceTime, sourceTime)); } catch { /* best effort */ }
          }
          let volume = Math.max(0, Math.min(2, track.volume));
          if (track.fadeIn > 0) volume *= Math.min(1, local / track.fadeIn);
          if (track.fadeOut > 0 && end - time < track.fadeOut) volume *= Math.max(0, (end - time) / track.fadeOut);
          gain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.01);
          if (element.paused) void element.play().catch(() => undefined);
        });

        snapshot.percentage = Math.max(1, Math.min(99, (time / duration) * 100));
        snapshot.progress = { jobId: snapshot.id, timeSeconds: Math.min(duration, time) };
        publish(snapshot);
        if (time >= duration) {
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    const blob = await output;
    if (cancelFlags.has(snapshot.id)) {
      snapshot.status = 'canceled';
      snapshot.completedAt = new Date().toISOString();
      snapshot.percentage = 0;
      publish(snapshot);
      return;
    }
    if (blob.size === 0) throw new Error('Android slideshow rendering produced an empty file.');
    const extension = format === 'mp4' ? 'mp4' : 'webm';
    const fileName = `${cleanName(project.name)}.${extension}`;
    results.set(snapshot.id, { blob, fileName });
    snapshot.status = 'completed';
    snapshot.percentage = 100;
    snapshot.outputPath = `knoux-android-render://${snapshot.id}/${fileName}`;
    snapshot.completedAt = new Date().toISOString();
    snapshot.progress = { jobId: snapshot.id, timeSeconds: duration };
    snapshot.outputExists = true;
    snapshot.executionStrategy = 'android-canvas-mediarecorder';
    publish(snapshot);
  } finally {
    slideMedia.forEach((media) => {
      if (media instanceof HTMLVideoElement) { media.pause(); media.removeAttribute('src'); media.load(); }
      else media.removeAttribute('src');
    });
    audioEntries.forEach(({ element }) => { element.pause(); element.removeAttribute('src'); element.load(); });
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
    cancelFlags.delete(snapshot.id);
  }
}

async function saveResult(jobId: string): Promise<void> {
  const result = results.get(jobId);
  if (!result) throw new Error('The rendered slideshow output is not available.');
  const extension = result.fileName.split('.').pop() ?? 'mp4';
  const destination = await window.knouxAPI.file.saveFile({
    title: 'Save KNOUX slideshow',
    defaultPath: result.fileName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (!destination) return;
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  await window.knouxAPI.file.writeFile(
    destination,
    bytes as unknown as Parameters<typeof window.knouxAPI.file.writeFile>[1],
  );
}

export function installAndroidSlideshowRenderBridge(): void {
  if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxSlideshowAPI !== 'object') return;
  const base = window.knouxSlideshowAPI;
  window.knouxSlideshowAPI = {
    ...base,
    render: async (project: SlideshowProject, format: SlideshowRenderFormat): Promise<SlideshowRenderSnapshot | null> => {
      if (jobs.size >= 8 && Array.from(jobs.values()).filter((job) => !['completed', 'failed', 'canceled'].includes(job.status)).length >= 2) {
        throw new Error('Wait for an active slideshow render to finish before starting another.');
      }
      const id = randomId();
      const durationSeconds = slideshowDuration(project);
      const snapshot: SlideshowRenderSnapshot = {
        id,
        status: 'preparing',
        outputPath: null,
        format,
        progress: { jobId: id, timeSeconds: 0 },
        percentage: 0,
        durationSeconds,
        error: null,
        warning: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        probe: null,
        validation: null,
        previousOutputSha256: null,
        outputExists: false,
        executionStrategy: 'android-canvas-mediarecorder',
      };
      publish(snapshot);
      void executeRender(project, format, snapshot).catch((reason) => {
        snapshot.status = cancelFlags.has(id) ? 'canceled' : 'failed';
        snapshot.error = reason instanceof Error ? reason.message : 'Android slideshow rendering failed.';
        snapshot.completedAt = new Date().toISOString();
        publish(snapshot);
        cancelFlags.delete(id);
      });
      return clone(snapshot);
    },
    renderJobs: async () => Array.from(jobs.values()).map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    cancelRender: async (jobId: string): Promise<boolean> => {
      const snapshot = jobs.get(jobId);
      if (!snapshot || ['completed', 'failed', 'canceled'].includes(snapshot.status)) return false;
      cancelFlags.add(jobId);
      return true;
    },
    openOutput: saveResult,
    revealOutput: saveResult,
    onRenderProgress: (callback: (snapshot: SlideshowRenderSnapshot) => void): (() => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as Window['knouxSlideshowAPI'];
}
