import { guidedSkinSmooth, patchHeal, type PatchHealRequest } from '../beauty/beautyOperations';

export interface RenderRoi { x: number; y: number; width: number; height: number; }
export type RetouchRenderOperation =
  | { kind: 'guided-skin'; strength: number; texturePreserve: number; roi?: RenderRoi; mask?: ImageData }
  | { kind: 'patch-heal'; request: PatchHealRequest; roi?: RenderRoi; mask?: ImageData };

type RenderRequest = { type: 'render'; jobId: string; image: ImageData; operation: RetouchRenderOperation };

function normalizeRoi(image: ImageData, requested?: RenderRoi): RenderRoi {
  if (!requested) return { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(requested.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(requested.y)));
  return { x, y, width: Math.max(1, Math.min(image.width - x, Math.ceil(requested.width))), height: Math.max(1, Math.min(image.height - y, Math.ceil(requested.height)))};
}

function cropImage(image: ImageData, roi: RenderRoi): ImageData {
  const crop = new ImageData(roi.width, roi.height);
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
  const output = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  for (let y = 0; y < roi.height; y++) output.data.set(rendered.data.subarray(y * roi.width * 4, (y + 1) * roi.width * 4), ((roi.y + y) * base.width + roi.x) * 4);
  return output;
}

function render(request: RenderRequest): ImageData {
  const roi = normalizeRoi(request.image, request.operation.roi);
  const crop = cropImage(request.image, roi);
  const mask = cropMask(request.operation.mask, roi);
  const rendered = request.operation.kind === 'guided-skin'
    ? guidedSkinSmooth(crop, request.operation.strength, request.operation.texturePreserve, mask)
    : patchHeal(crop, {
      ...request.operation.request,
      targetX: request.operation.request.targetX - roi.x,
      targetY: request.operation.request.targetY - roi.y,
      sourceX: request.operation.request.sourceX - roi.x,
      sourceY: request.operation.request.sourceY - roi.y,
    }, mask);
  return compositeRoi(request.image, roi, rendered);
}

self.onmessage = (event: MessageEvent<RenderRequest>): void => {
  try {
    const output = render(event.data);
    (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(
      { type: 'result', jobId: event.data.jobId, image: output },
      [output.data.buffer as ArrayBuffer],
    );
  } catch (error) {
    postMessage({ type: 'failed', jobId: event.data.jobId, reason: error instanceof Error ? error.message : String(error) });
  }
};
