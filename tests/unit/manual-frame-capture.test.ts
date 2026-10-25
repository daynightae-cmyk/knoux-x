import {
  RENDER_FINAL_FRAME_DRAIN_MS,
  RENDER_FRAME_WRITE_QUEUE_LIMIT,
  createFramePacer,
  createPacedCanvasCapture,
  finalizePacedCapture,
  renderFrameCaptureIntervalMs,
} from '../../src/features/export/manualFrameCapture';

type TrackStub = {
  requestFrame?: jest.Mock;
  stop: jest.Mock;
};

function streamFrom(tracks: TrackStub[]): MediaStream {
  return {
    getVideoTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function canvasFrom(captureStream: jest.Mock): HTMLCanvasElement {
  return { captureStream } as unknown as HTMLCanvasElement;
}

type GeneratorGlobals = {
  MediaStreamTrackGenerator?: unknown;
  VideoTrackGenerator?: unknown;
  VideoFrame?: unknown;
  MediaStream?: unknown;
};

const globalRecord = globalThis as GeneratorGlobals;

function withGeneratorStubs<T>(run: (writer: { write: jest.Mock; close: jest.Mock; frames: Array<{ timestamp: number; duration: number; closed: boolean }> }) => T): T {
  const frames: Array<{ timestamp: number; duration: number; closed: boolean }> = [];
  class FakeFrame {
    timestamp: number;
    duration: number;
    closed = false;
    constructor(_source: unknown, init: { timestamp: number; duration: number }) {
      this.timestamp = init.timestamp;
      this.duration = init.duration;
      frames.push(this);
    }
    close(): void { this.closed = true; }
  }
  const write = jest.fn(() => Promise.resolve());
  const close = jest.fn(() => Promise.resolve());
  class FakeGenerator {
    writable = { getWriter: () => ({ write, close }) };
  }
  const previousMsg = globalRecord.MediaStreamTrackGenerator;
  const previousVtg = globalRecord.VideoTrackGenerator;
  const previousFrame = globalRecord.VideoFrame;
  const previousStream = globalRecord.MediaStream;
  globalRecord.MediaStreamTrackGenerator = FakeGenerator;
  globalRecord.VideoTrackGenerator = undefined;
  globalRecord.VideoFrame = FakeFrame;
  globalRecord.MediaStream = class FakeMediaStream {
    tracks: unknown[];
    constructor(tracks: unknown[]) { this.tracks = tracks; }
  };
  try {
    return run({ write, close, frames });
  } finally {
    globalRecord.MediaStreamTrackGenerator = previousMsg;
    globalRecord.VideoTrackGenerator = previousVtg;
    globalRecord.VideoFrame = previousFrame;
    globalRecord.MediaStream = previousStream;
  }
}

function withoutGeneratorStubs<T>(run: () => T): T {
  const previousMsg = globalRecord.MediaStreamTrackGenerator;
  const previousVtg = globalRecord.VideoTrackGenerator;
  const previousFrame = globalRecord.VideoFrame;
  globalRecord.MediaStreamTrackGenerator = undefined;
  globalRecord.VideoTrackGenerator = undefined;
  globalRecord.VideoFrame = undefined;
  try {
    return run();
  } finally {
    globalRecord.MediaStreamTrackGenerator = previousMsg;
    globalRecord.VideoTrackGenerator = previousVtg;
    globalRecord.VideoFrame = previousFrame;
  }
}

function withWindowStub<T>(run: () => T, drainImmediately = true): T {
  const windowRecord = globalThis as { window?: unknown };
  const original = windowRecord.window;
  windowRecord.window = {
    setTimeout: (handler: () => void) => {
      if (drainImmediately) handler();
      return 1;
    },
  };
  try {
    return run();
  } finally {
    windowRecord.window = original;
  }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

describe('manual frame capture contract', () => {
  test('derives a capture cadence slightly under the target frame interval', () => {
    expect(renderFrameCaptureIntervalMs(30)).toBe(31);
    expect(renderFrameCaptureIntervalMs(24)).toBe(40);
    expect(renderFrameCaptureIntervalMs(60)).toBe(15);
    expect(renderFrameCaptureIntervalMs(0)).toBe(31);
    expect(renderFrameCaptureIntervalMs(Number.NaN)).toBe(31);
    expect(renderFrameCaptureIntervalMs(1000)).toBe(1);
  });

  test('paces manual frame requests to the target cadence', () => {
    const pacer = createFramePacer(30);
    expect(pacer.shouldCapture(0)).toBe(true);
    expect(pacer.shouldCapture(10)).toBe(false);
    expect(pacer.shouldCapture(30)).toBe(false);
    expect(pacer.shouldCapture(31)).toBe(true);
    expect(pacer.shouldCapture(55)).toBe(false);
    expect(pacer.shouldCapture(62)).toBe(true);
  });

  test('prefers the compositor-independent track generator when available', () => {
    withGeneratorStubs(({ write, frames }) => {
      const captureStream = jest.fn();
      const capture = createPacedCanvasCapture(canvasFrom(captureStream), 30);
      expect(captureStream).not.toHaveBeenCalled();
      expect(capture.captureFrame).not.toBeNull();
      capture.captureFrame?.(0.5);
      capture.captureFrame?.(1.25);
      expect(write).toHaveBeenCalledTimes(2);
      expect(frames[0].timestamp).toBe(500000);
      expect(frames[1].timestamp).toBe(1250000);
      expect(frames.some((frame) => frame.closed)).toBe(false);
    });
  });

  test('writes a final timestamped frame and stops the recorder before closing the writer', async () => {
    await withGeneratorStubs(async ({ write, close, frames }) => {
      const windowRecord = globalThis as { window?: unknown };
      const previousWindow = windowRecord.window;
      windowRecord.window = { setTimeout: (handler: () => void) => { handler(); return 1; } };
      try {
        const capture = createPacedCanvasCapture(canvasFrom(jest.fn()), 30);
        capture.captureFrame?.(0.25);
        const settle = jest.fn();
        const recorder = { state: 'recording', stop: jest.fn() } as unknown as MediaRecorder;
        finalizePacedCapture(capture, recorder, settle, 3.5);
        expect(write).toHaveBeenCalledTimes(2);
        expect(frames[frames.length - 1].timestamp).toBe(3500000);
        await flushAsync();
        await flushAsync();
        expect(close).toHaveBeenCalledTimes(1);
        expect(recorder.stop).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledTimes(1);
        expect(recorder.stop.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
        expect(frames.every((frame) => frame.closed)).toBe(true);
      } finally {
        windowRecord.window = previousWindow;
      }
    });
  });

  test('applies adaptive backpressure so the offer rate converges to encoder throughput', () => {
    withGeneratorStubs(({ write }) => {
      const never = new Promise<void>(() => undefined);
      write.mockImplementation(() => never);
      const capture = createPacedCanvasCapture(canvasFrom(jest.fn()), 30);
      for (let index = 0; index <= RENDER_FRAME_WRITE_QUEUE_LIMIT + 3; index += 1) {
        capture.captureFrame?.(index * 0.033);
      }
      expect(write).toHaveBeenCalledTimes(RENDER_FRAME_WRITE_QUEUE_LIMIT);
    });
  });

  test('uses the manual canvas track when no generator exists and keeps drain semantics', () => {
    withoutGeneratorStubs(() => {
      const track: TrackStub = { requestFrame: jest.fn(), stop: jest.fn() };
      const manual = streamFrom([track]);
      const captureStream = jest.fn().mockReturnValue(manual);
      const capture = createPacedCanvasCapture(canvasFrom(captureStream), 30);
      expect(captureStream).toHaveBeenCalledTimes(1);
      expect(captureStream).toHaveBeenCalledWith(0);
      expect(capture.stream).toBe(manual);
      expect(capture.captureFrame).not.toBeNull();
      capture.captureFrame?.(0.5);
      expect(track.requestFrame).toHaveBeenCalledTimes(1);
      const stopped: string[] = [];
      const recorder = {
        state: 'recording',
        stop: jest.fn(() => { stopped.push('stop'); }),
      } as unknown as MediaRecorder;
      withWindowStub(() => {
        finalizePacedCapture(capture, recorder, () => stopped.push('settle'), 3.5);
      });
      expect(track.requestFrame).toHaveBeenCalledTimes(2);
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(stopped).toEqual(['stop', 'settle']);
      expect(RENDER_FINAL_FRAME_DRAIN_MS).toBeGreaterThan(0);
    });
  });

  test('falls back to the automatic capture rate when manual capture is unavailable', () => {
    withoutGeneratorStubs(() => {
      const track: TrackStub = { stop: jest.fn() };
      const manual = streamFrom([track]);
      const automatic = streamFrom([{ stop: jest.fn() }]);
      const captureStream = jest.fn().mockReturnValueOnce(manual).mockReturnValueOnce(automatic);
      const capture = createPacedCanvasCapture(canvasFrom(captureStream), 30);
      expect(captureStream).toHaveBeenNthCalledWith(1, 0);
      expect(captureStream).toHaveBeenNthCalledWith(2, 30);
      expect(capture.stream).toBe(automatic);
      expect(capture.captureFrame).toBeNull();
      expect(track.stop).toHaveBeenCalledTimes(1);
    });
  });

  test('never restarts an already inactive recorder but still settles the render loop', () => {
    withoutGeneratorStubs(() => {
      const capture = createPacedCanvasCapture(canvasFrom(jest.fn().mockReturnValue(streamFrom([{ stop: jest.fn() }]))), 30);
      const recorder = { state: 'inactive', stop: jest.fn() } as unknown as MediaRecorder;
      const settle = jest.fn();
      finalizePacedCapture(capture, recorder, settle, 3.5);
      expect(recorder.stop).not.toHaveBeenCalled();
      expect(settle).toHaveBeenCalledTimes(1);
    });
  });
});
