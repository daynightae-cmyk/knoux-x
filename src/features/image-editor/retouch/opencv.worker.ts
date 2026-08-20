/**
 * KNOUX-X — OPENCV WORKER (Phase 5)
 *
 * Long-lived WASM worker. OpenCV.js is loaded exactly once per worker
 * lifetime; every cv.Mat created by a job is deleted in that job's `finally`
 * (reverse allocation order). The worker probes `cv.ximgproc` at configure
 * time and reports capability — callers must not assume guidedFilter exists.
 * When the WASM binary is absent from public/assets/opencv the worker still
 * responds, with `available: false`, so the renderer falls back to the JS
 * engine path gracefully.
 */

// OpenCV.js does not ship TypeScript types; the runtime surface is probed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CvRuntime = any;

export interface OpenCvCaps {
  available: boolean;
  ximgproc: boolean;
  version: string;
  reason?: string;
}

type ConfigureMessage = { type: 'configure'; wasmRoot: string };
type CancelMessage = { type: 'cancel'; jobId: string };
type GuidedSkinMessage = {
  type: 'guided-skin';
  jobId: string;
  image: ImageData;
  strength: number;
  texturePreserve: number;
  mask?: ImageData;
  eps?: number;
};

type IncomingMessage = ConfigureMessage | CancelMessage | GuidedSkinMessage;

let cvPromise: Promise<CvRuntime> | null = null;
let caps: OpenCvCaps = { available: false, ximgproc: false, version: '0.0.0', reason: 'OpenCV.js is not loaded.' };
let wasmRoot: string | null = null;
let cancelledJobId: string | null = null;

/** Download the WASM binary once per worker. Never per slider move. */
function loadOpenCv(root: string): Promise<CvRuntime> {
  if (cvPromise) return cvPromise;
  const normalizedRoot = root.replace(/\/?$/, '/');
  cvPromise = (async () => {
    const module = await import(/* @vite-ignore */ `${normalizedRoot}opencv.js`);
    const createCv = module.default ?? module;
    if (typeof createCv === 'function') {
      return await createCv({ locateFile: (file: string) => `${normalizedRoot}${file}` });
    }
    const globalCv = (globalThis as unknown as Record<string, CvRuntime>)['cv'];
    if (globalCv?.onRuntimeInitialized) {
      await new Promise<void>((resolve) => {
        globalCv.onRuntimeInitialized = resolve;
      });
      return globalCv;
    }
    throw new Error('OpenCV.js loaded but no runtime initializer was exposed.');
  })();
  return cvPromise;
}

function probeCaps(cv: CvRuntime): OpenCvCaps {
  return {
    available: true,
    ximgproc: typeof cv.ximgproc?.guidedFilter === 'function',
    version: String(cv.version ?? 'unknown'),
  };
}

async function configure(message: ConfigureMessage): Promise<void> {
  wasmRoot = message.wasmRoot;
  try {
    const cv = await loadOpenCv(message.wasmRoot);
    caps = probeCaps(cv);
    postMessage({ type: 'configured', caps });
  } catch (error) {
    caps = { available: false, ximgproc: false, version: '0.0.0', reason: error instanceof Error ? error.message : String(error) };
    postMessage({ type: 'configuration-error', caps });
  }
}

function cloneImageData(input: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(input.data), input.width, input.height);
}

/**
 * Guided skin smoothing through cv.ximgproc.guidedFilter when present.
 *
 * Mat discipline: every Mat allocated inside the job is deleted in `finally`,
 * in reverse allocation order. JavaScript GC never reclaims WASM memory.
 */
async function runGuidedSkin(cv: CvRuntime, message: GuidedSkinMessage): Promise<ImageData> {
  if (typeof cv.ximgproc?.guidedFilter !== 'function') {
    throw new Error('cv.ximgproc.guidedFilter is not present in this OpenCV build.');
  }
  const src = cv.matFromImageData(message.image);
  const gray8 = new cv.Mat();
  const guide = new cv.Mat();
  const dst = new cv.Mat();
  try {
    cv.cvtColor(src, gray8, cv.COLOR_RGBA2GRAY);
    gray8.convertTo(guide, cv.CV_32F, 1 / 255);
    const radius = Math.max(1, Math.min(24, Math.round(4 + message.strength * 12)));
    const eps = message.eps ?? 0.0001 + (1 - Math.max(0, Math.min(1, message.strength))) * 0.012;
    cv.ximgproc.guidedFilter(guide, src, dst, radius, eps, -1);

    const width = message.image.width;
    const height = message.image.height;
    const input = new Uint8ClampedArray(message.image.data);
    const output = new Uint8ClampedArray(dst.data());
    const result = cloneImageData(message.image);
    const blend = Math.max(0, Math.min(1, message.strength)) * (1 - Math.max(0, Math.min(0.95, message.texturePreserve)));

    for (let y = 0; y < height; y++) {
      if (cancelledJobId === message.jobId) throw new DOMException('Superseded by a newer interactive preview.', 'AbortError');
      for (let index = y * width * 4; index < (y + 1) * width * 4; index += 4) {
        if (message.mask && message.mask.data[index + 3] === 0) continue;
        const alpha = blend * (message.mask ? message.mask.data[index + 3] / 255 : 1);
        result.data[index] = input[index] + (output[index] - input[index]) * alpha;
        result.data[index + 1] = input[index + 1] + (output[index + 1] - input[index + 1]) * alpha;
        result.data[index + 2] = input[index + 2] + (output[index + 2] - input[index + 2]) * alpha;
      }
    }
    void width;
    void height;
    return result;
  } finally {
    dst.delete();
    guide.delete();
    gray8.delete();
    src.delete();
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>): void => {
  const message = event.data;
  if (message.type === 'configure') {
    void configure(message);
    return;
  }
  if (message.type === 'cancel') {
    cancelledJobId = message.jobId;
    return;
  }
  if (message.type === 'guided-skin') {
    void (async () => {
      try {
        if (!wasmRoot) throw new Error('OpenCV worker was not configured with an asset root.');
        const cv = await loadOpenCv(wasmRoot);
        const output = await runGuidedSkin(cv, message);
        (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(
          { type: 'result', jobId: message.jobId, image: output },
          [output.data.buffer as ArrayBuffer],
        );
      } catch (error) {
        postMessage({ type: 'failed', jobId: message.jobId, reason: error instanceof Error ? error.message : String(error) });
      }
    })();
  }
};