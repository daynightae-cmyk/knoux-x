import type { ExportPlan } from '../../core/image-studio/export/export';

import { syncRetouchState } from './retouch/syncRetouchState';
import { useImageStudioStore } from './store/imageStudioStore';

/** Both the toolbar and keyboard shortcut must save the same retouch snapshot. */
export async function saveStudioProject(options: {
  title: string;
  failureMessage: string;
  saveAs?: boolean;
}): Promise<string | null> {
  const state = useImageStudioStore.getState();
  if (!state.currentDocument || state.isLoading) return null;
  const documentId = state.currentDocument.documentId;
  state.setLoading(true);
  try {
    const choosePath = options.saveAs || !state.documentPath;
    const path = choosePath
      ? await window.knouxAPI.file.saveFile({
        title: options.title,
        defaultPath: 'untitled.knouximage',
        filters: [{ name: 'KNOUX Image', extensions: ['knouximage'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      : state.documentPath;
    if (!path) return null;
    const snapshot = useImageStudioStore.getState().currentDocument;
    if (!snapshot || snapshot.documentId !== documentId) return null;
    await syncRetouchState(snapshot);
    const savedPath = choosePath
      ? await window.knouxImageStudioAPI.saveAs(path)
      : await window.knouxImageStudioAPI.save(path);
    if (!savedPath) throw new Error(options.failureMessage);
    const current = useImageStudioStore.getState();
    if (current.currentDocument?.documentId === documentId) {
      current.setDocumentPath(savedPath);
      // Edits made while disk I/O was pending have not been saved.
      if (current.currentDocument === snapshot) current.setSaved(true);
    }
    return savedPath;
  } catch (error) {
    const current = useImageStudioStore.getState();
    current.addError(error instanceof Error ? error.message : options.failureMessage);
    if (current.currentDocument?.documentId === documentId) current.setSaved(false);
    return null;
  } finally {
    useImageStudioStore.getState().setLoading(false);
  }
}

/** Export is a separate artifact; it must never mark the editable project saved. */
export async function exportStudioImage(options: {
  plan: ExportPlan;
  title: string;
  failureMessage: string;
  layerId?: string;
}): Promise<string | null> {
  const state = useImageStudioStore.getState();
  const snapshot = state.currentDocument;
  if (!snapshot || state.isLoading) return null;
  state.setLoading(true);
  try {
    const name = Array.from(snapshot.title, character => character.charCodeAt(0) < 32 ? '_' : character)
      .join('').replace(/[<>:"/\\|?*]/g, '_').slice(0, 100) || 'untitled';
    const path = await window.knouxAPI.file.saveFile({
      title: options.title,
      defaultPath: `${name}-edited.${options.plan.extension}`,
      filters: [{ name: options.plan.format.toUpperCase(), extensions: [options.plan.extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (!path || useImageStudioStore.getState().currentDocument !== snapshot) return null;
    if (state.documentPath && path.replace(/\\/g, '/').toLowerCase() === state.documentPath.replace(/\\/g, '/').toLowerCase()) {
      throw new Error(options.failureMessage);
    }
    await syncRetouchState(snapshot);
    const result = options.layerId
      ? await window.knouxImageStudioAPI.exportLayer(options.layerId, options.plan)
      : await window.knouxImageStudioAPI.exportFlattened(options.plan);
    if (!result?.bytes?.byteLength) throw new Error(options.failureMessage);
    await window.knouxAPI.file.writeFile(
      path,
      result.bytes as Parameters<typeof window.knouxAPI.file.writeFile>[1],
    );
    return path;
  } catch (error) {
    useImageStudioStore.getState().addError(error instanceof Error ? error.message : options.failureMessage);
    return null;
  } finally {
    useImageStudioStore.getState().setLoading(false);
  }
}
