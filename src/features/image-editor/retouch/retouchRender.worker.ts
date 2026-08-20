import { guidedSkinSmooth, patchHeal, type PatchHealRequest } from '../beauty/beautyOperations';

import { LiquifyMesh, type LiquifyMeshSettings, type LiquifyStroke } from './liquify/liquifyMesh';

export interface RenderRoi { x: number; y: number; width: number; height: number; }
export type RetouchRenderOperation =
  | { kind: 'guided-skin'; strength: number; texturePreserve: number; roi?: RenderRoi; mask?: ImageData }
  | { kind: 'patch-heal'; request: PatchHealRequest; roi?: RenderRoi; mask?: ImageData }
  | { kind: 'liquify-mesh'; strokes: LiquifyStroke[]; settings?: LiquifyMeshSettings; roi?: RenderRoi; mask?: ImageData };

type RenderRequest = { type: 'render'; jobId: string; image: ImageData; operation: RetouchRenderOperation };
type CancelRequest = { type: 'cancel'; jobId: string };

type IncomingMessage = RenderRequest | CancelRequest;

type RenderOutcome = { type: 'result'; image: ImageData } | { type: 'aborted' }

/**
 * Cooperative cancellation: the main thread posts { type: 'cancel' } and the
 * worker aborts between chunks. When an operation finishes before its cancel
 * message is processed, the pending cancel is flushed with one event-loop
 * tick and the stale job is still reported as aborted.
 */
let cancelledJobId: string | null = null;

function isAborted(jobId: string): boolean {
  return cancelledJobId === jobId;
}

function wake(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeRoi(image: ImageData, requested?: RenderRoi): RenderRoi {
  if (!requested) return { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(requested.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(requested.y)));
  return { x, y, width: Math.max(1, Math.min(image.width - x, Math.ceil(requested.width))), height: Math.max(1, Math.min(image.height - y, Math.ceil(requested.height)))};
}

function cropImage(image: ImageData, roi: RenderRoi): ImageData {
  const crop = { width: roi.width, height: roi.height, data: new Uint8ClampedArray(roi.width * roi.height * 4) } as ImageData;
  for (let y = 0; y < roi.height; y++) {
    const sourceStart = ((roi.y + y) * image.width + roi.x) * 4;
    crop.data.set(image.data.subarray(sourceStart, sourceStart + roi.width * 4), y * roi.width * 4);
  }
  return crop;
}

function cropMask(mask: ImageData | undefined, roi: RenderRoi): ImageData | undefined {
  return mask ? cropImage(mask, roi) : undefined;
}

function compositeRoi(base: ImageData, roi: RenderRoi, rendered: ImageData): ImageData {
  const output = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) } as ImageData;
  for (let y = 0; y < roi.height; y++) output.data.set(rendered.data.subarray(y * roi.width * 4, (y + 1) * roi.width * 4), ((roi.y + y) * base.width + roi.x) * 4);
  return output;
}

async function render(request: RenderRequest): Promise<RenderOutcome> {
  const jobId = request.jobId;
  const roi = normalizeRoi(request.image, request.operation.roi);
  const crop = cropImage(request.image, roi);
  const mask = cropMask(request.operation.mask, roi);

  let rendered: ImageData;
  if (request.operation.kind === 'guided-skin') {
    rendered = guidedSkinSmooth(crop, request.operation.strength, request.operation.texturePreserve, mask, () => isAborted(jobId));
  } else if (request.operation.kind === 'patch-heal') {
    rendered = patchHeal(crop, {
      ...request.operation.request,
      targetX: request.operation.request.targetX - roi.x,
      targetY: request.operation.request.targetY - roi.y,
      sourceX: request.operation.request.sourceX - roi.x,
      sourceY: request.operation.request.sourceY - roi.y,
    }, mask, () => isAborted(jobId));
  } else if (request.operation.strokes.length === 0) {
    rendered = crop;
  } else {
    const mesh = new LiquifyMesh(crop.width, crop.height, request.operation.settings);
    mesh.applyStrokes(request.operation.strokes, mask, () => isAborted(jobId));
    if (isAborted(jobId)) return { type: 'aborted' };
    rendered = mesh.warp(crop, () => isAborted(jobId));
  }

  // Let a pending cancel message for this job be processed before reporting.
  await wake();
  if (isAborted(jobId)) return { type: 'aborted' };
  return { type: 'result', image: compositeRoi(request.image, roi, rendered) };
}

self.onmessage = (event: MessageEvent<IncomingMessage>): void => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelledJobId = message.jobId;
    return;
  }
  void render(message).then((outcome) => {
    if (outcome.type === 'aborted') {
      postMessage({ type: 'aborted', jobId: message.jobId });
      return;
    }
    const post = (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage;
    post(
      { type: 'result', jobId: message.jobId, image: outcome.image },
      [outcome.image.data.buffer as ArrayBuffer],
    );
  }).catch((error) => {
    postMessage({ type: 'failed', jobId: message.jobId, reason: error instanceof Error ? error.message : String(error) });
  });
};