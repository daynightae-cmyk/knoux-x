export const RENDER_FINAL_FRAME_DRAIN_MS = 300;

export const RENDER_ENCODER_TAIL_DRAIN_MS = 800;

export const RENDER_FRAME_WRITE_QUEUE_LIMIT = 6;

export function renderFrameCaptureIntervalMs(fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.max(1, Math.round(1000 / safeFps) - 2);
}

export interface FramePacer {
  shouldCapture(nowMs: number): boolean;
}

export function createFramePacer(fps: number): FramePacer {
  const interval = renderFrameCaptureIntervalMs(fps);
  let lastCapture = Number.NEGATIVE_INFINITY;
  return {
    shouldCapture(nowMs: number): boolean {
      if (nowMs - lastCapture < interval) return false;
      lastCapture = nowMs;
      return true;
    },
  };
}

type ManualFrameTrack = MediaStreamTrack & { requestFrame?: () => void };

interface CapturedVideoFrame {
  close(): void;
}

type VideoFrameConstructor = new (
  source: HTMLCanvasElement,
  init: { timestamp: number; duration: number },
) => CapturedVideoFrame;

interface FrameWriter {
  write(frame: CapturedVideoFrame): Promise<void>;
  close(): Promise<void>;
}

interface TrackGeneratorLike extends MediaStreamTrack {
  writable: { getWriter(): FrameWriter };
}

interface TrackGeneratorConstructor {
  new (init: { kind: 'video' }): TrackGeneratorLike;
}

function trackGeneratorConstructor(): TrackGeneratorConstructor | null {
  const scope = globalThis as {
    MediaStreamTrackGenerator?: TrackGeneratorConstructor;
    VideoTrackGenerator?: TrackGeneratorConstructor;
  };
  return scope.MediaStreamTrackGenerator ?? scope.VideoTrackGenerator ?? null;
}

function videoFrameConstructor(): VideoFrameConstructor | null {
  return (globalThis as { VideoFrame?: VideoFrameConstructor }).VideoFrame ?? null;
}

function stopWhenIdle(recorder: MediaRecorder, settle: () => void): void {
  if (recorder.state !== 'inactive') recorder.stop();
  settle();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export interface PacedCanvasCapture {
  stream: MediaStream;
  captureFrame: ((timeSeconds: number) => void) | null;
  finalize: (recorder: MediaRecorder, settle: () => void, durationSeconds: number) => void;
}

function createGeneratorCapture(
  canvas: HTMLCanvasElement,
  fps: number,
  Generator: TrackGeneratorConstructor,
  Frame: VideoFrameConstructor,
): PacedCanvasCapture {
  const generator = new Generator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  const stream = new MediaStream([generator]);
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const frameDurationMicros = Math.max(1, Math.round(1_000_000 / safeFps));
  const baseIntervalMs = Math.max(1, Math.round(1000 / safeFps));
  const pending = new Set<Promise<void>>();
  let closed = false;
  let backoffFactor = 1;
  let nextAllowedAt = 0;
  let calmStreak = 0;

  const dynamicLimit = (): number => Math.max(1, Math.round(RENDER_FRAME_WRITE_QUEUE_LIMIT / backoffFactor));

  const captureFrame = (timeSeconds: number): void => {
    if (closed) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < nextAllowedAt) return;
    if (pending.size >= dynamicLimit()) {
      backoffFactor = Math.min(8, backoffFactor * 1.5);
      calmStreak = 0;
      nextAllowedAt = now + baseIntervalMs * backoffFactor * 2;
      return;
    }
    let frame: CapturedVideoFrame;
    try {
      frame = new Frame(canvas, {
        timestamp: Math.max(0, Math.round((Number.isFinite(timeSeconds) ? timeSeconds : 0) * 1_000_000)),
        duration: frameDurationMicros,
      });
    } catch {
      return;
    }
    const write: Promise<void> = writer.write(frame).then(
      () => {
        pending.delete(write);
        try { frame.close(); } catch { /* frame release is best effort */ }
      },
      () => {
        pending.delete(write);
        try { frame.close(); } catch { /* frame release is best effort */ }
      },
    );
    pending.add(write);
    calmStreak += 1;
    if (backoffFactor > 1 && calmStreak >= 8) {
      backoffFactor = Math.max(1, backoffFactor / 1.5);
      calmStreak = 0;
    }
  };

  const finalize = (recorder: MediaRecorder, settle: () => void, durationSeconds: number): void => {
    if (closed) {
      stopWhenIdle(recorder, settle);
      return;
    }
    closed = true;
    let tail: Promise<void> = Promise.resolve();
    try {
      const frame = new Frame(canvas, {
        timestamp: Math.max(0, Math.round((Number.isFinite(durationSeconds) ? durationSeconds : 0) * 1_000_000)),
        duration: frameDurationMicros,
      });
      tail = writer.write(frame).then(
        () => { try { frame.close(); } catch { /* frame release is best effort */ } },
        () => { try { frame.close(); } catch { /* frame release is best effort */ } },
      );
    } catch {
      tail = Promise.resolve();
    }
    void Promise.race([
      Promise.all([...pending, tail]).catch(() => undefined),
      delay(5000),
    ]).then(() => Promise.race([
      writer.close().catch(() => undefined),
      delay(3000),
    ])).then(() => delay(RENDER_ENCODER_TAIL_DRAIN_MS)).then(() => {
      stopWhenIdle(recorder, settle);
    });
  };

  return { stream, captureFrame, finalize };
}

export function createPacedCanvasCapture(canvas: HTMLCanvasElement, fps: number): PacedCanvasCapture {
  const Generator = trackGeneratorConstructor();
  const Frame = videoFrameConstructor();
  if (Generator && Frame) {
    try {
      return createGeneratorCapture(canvas, fps, Generator, Frame);
    } catch {
      // Fall through to the canvas capture path when track generation is unavailable.
    }
  }

  const manualStream = canvas.captureStream(0);
  const track = manualStream.getVideoTracks()[0] as ManualFrameTrack | undefined;
  if (track && typeof track.requestFrame === 'function') {
    const requestFrame = (): void => track.requestFrame?.();
    return {
      stream: manualStream,
      captureFrame: () => requestFrame(),
      finalize: (recorder, settle) => {
        requestFrame();
        window.setTimeout(() => stopWhenIdle(recorder, settle), RENDER_FINAL_FRAME_DRAIN_MS);
      },
    };
  }
  manualStream.getTracks().forEach((streamTrack) => streamTrack.stop());
  const fallbackFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return {
    stream: canvas.captureStream(fallbackFps),
    captureFrame: null,
    finalize: (recorder, settle) => stopWhenIdle(recorder, settle),
  };
}

export function finalizePacedCapture(
  capture: PacedCanvasCapture,
  recorder: MediaRecorder,
  settle: () => void,
  durationSeconds = 0,
): void {
  capture.finalize(recorder, settle, durationSeconds);
}
