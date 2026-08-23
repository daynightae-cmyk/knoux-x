import type { ImageStudioDocument, RetouchDocumentState } from '../../../core/image-studio/document/schema';

export function retouchSyncPayload(document: ImageStudioDocument): Array<{
  layerId: string;
  retouche: RetouchDocumentState | null;
}> {
  return document.layers
    .filter((layer) => layer.kind === 'raster')
    .map((layer) => ({
      layerId: layer.id,
      retouche: (layer as typeof layer & { retouche?: RetouchDocumentState }).retouche ?? null,
    }));
}

export async function syncRetouchState(document: ImageStudioDocument): Promise<void> {
  await window.knouxImageStudioAPI.syncRetouch(retouchSyncPayload(document));
}
