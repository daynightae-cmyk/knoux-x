import {
  addLayer,
  createImageStudioDocument,
  createRasterLayer,
} from '../../src/core/image-studio/document/document';
import { planExport } from '../../src/core/image-studio/export/export';
import { exportStudioImage, saveStudioProject } from '../../src/features/image-studio/documentCommands';
import { useImageStudioStore } from '../../src/features/image-studio/store/imageStudioStore';

const saveOptions = { title: 'Save project', failureMessage: 'Save failed' };
const sourceBytes = new Uint8Array([137, 80, 78, 71]);
const bridge = {
  syncRetouch: jest.fn(), save: jest.fn(), saveAs: jest.fn(),
  exportFlattened: jest.fn(), exportLayer: jest.fn(),
};
const file = { saveFile: jest.fn(), writeFile: jest.fn() };

function current() { return useImageStudioStore.getState(); }
function documentFixture() {
  const document = createImageStudioDocument({ title: 'Portrait', width: 80, height: 60 });
  const { layer } = createRasterLayer(document, {
    name: 'Original', dataUrl: 'data:image/png;base64,AAAA', width: 80, height: 60,
  });
  return addLayer(document, layer);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function exportOptions() {
  return {
    title: 'Export', failureMessage: 'Export failed',
    plan: planExport(current().currentDocument!.canvas, { format: 'png' }),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.assign(globalThis, { window: { knouxImageStudioAPI: bridge, knouxAPI: { file } } });
  current().reset();
  current().setCurrentDocument(documentFixture());
  current().setDocumentPath('/projects/portrait.knouximage');
  current().setActiveLayerId(current().currentDocument!.layers[0].id);
  current().addRetouchOperation({ type: 'makeup-tint', enabled: true, strength: 0.5, color: '#cc4466' });
  bridge.syncRetouch.mockResolvedValue(undefined);
  bridge.save.mockResolvedValue('/projects/portrait.knouximage');
  bridge.saveAs.mockResolvedValue('/projects/new.knouximage');
  file.saveFile.mockResolvedValue('/exports/portrait.png');
  file.writeFile.mockResolvedValue(undefined);
  bridge.exportFlattened.mockResolvedValue({ bytes: sourceBytes });
  bridge.exportLayer.mockResolvedValue({ bytes: sourceBytes });
});

test('saves the live retouch operations before acknowledging disk persistence', async () => {
  const pending = deferred<string>();
  const started = deferred<void>();
  bridge.save.mockImplementation(() => { started.resolve(); return pending.promise; });
  const saved = saveStudioProject(saveOptions);
  await started.promise;
  expect(bridge.syncRetouch).toHaveBeenCalledWith([expect.objectContaining({
    retouche: expect.objectContaining({ operations: [expect.objectContaining({ strength: 0.5 })] }),
  })]);
  expect(bridge.save).toHaveBeenCalledWith('/projects/portrait.knouximage');
  expect(current().dirty).toBe(true);
  expect(current().isLoading).toBe(true);
  pending.resolve('/projects/portrait.knouximage');
  await expect(saved).resolves.toBe('/projects/portrait.knouximage');
  expect(current().saved).toBe(true);
  expect(current().isLoading).toBe(false);
});

test('Save on an untitled project chooses a destination and reuses Save As', async () => {
  current().setDocumentPath(null);
  file.saveFile.mockResolvedValue('/projects/new.knouximage');
  await saveStudioProject(saveOptions);
  expect(bridge.save).not.toHaveBeenCalled();
  expect(bridge.saveAs).toHaveBeenCalledWith('/projects/new.knouximage');
  expect(current().documentPath).toBe('/projects/new.knouximage');
});

test('cancelled Save As leaves the old path and unsaved work untouched', async () => {
  file.saveFile.mockResolvedValue(null);
  await expect(saveStudioProject({ ...saveOptions, saveAs: true })).resolves.toBeNull();
  expect(bridge.syncRetouch).not.toHaveBeenCalled();
  expect(current().dirty).toBe(true);
  expect(current().documentPath).toBe('/projects/portrait.knouximage');
});

test.each(['sync', 'write', 'null'])('a %s failure cannot report a saved project', async failure => {
  if (failure === 'sync') bridge.syncRetouch.mockRejectedValue(new Error('Sync rejected'));
  if (failure === 'write') bridge.save.mockRejectedValue(new Error('Disk full'));
  if (failure === 'null') bridge.save.mockResolvedValue(null);
  await expect(saveStudioProject(saveOptions)).resolves.toBeNull();
  expect(current().dirty).toBe(true);
  expect(current().saved).toBe(false);
  expect(current().errors.length).toBe(1);
  expect(current().isLoading).toBe(false);
  if (failure === 'sync') expect(bridge.save).not.toHaveBeenCalled();
});

test('edits made during a save remain dirty and a second save cannot race it', async () => {
  const pending = deferred<string>();
  bridge.save.mockReturnValue(pending.promise);
  const first = saveStudioProject(saveOptions);
  await Promise.resolve();
  const op = current().currentDocument!.layers[0];
  expect(op.kind).toBe('raster');
  current().addRetouchOperation({ type: 'makeup-tint', enabled: true, strength: 0.9, color: '#cc4466' });
  await expect(saveStudioProject(saveOptions)).resolves.toBeNull();
  pending.resolve('/projects/portrait.knouximage');
  await first;
  expect(bridge.save).toHaveBeenCalledTimes(1);
  expect(current().dirty).toBe(true);
});

test('switching documents during a save cannot mark the replacement saved or change its path', async () => {
  const pending = deferred<string>();
  bridge.saveAs.mockReturnValue(pending.promise);
  const first = saveStudioProject({ ...saveOptions, saveAs: true });
  await Promise.resolve(); await Promise.resolve();
  current().setCurrentDocument(documentFixture());
  current().setDocumentPath('/projects/other.knouximage');
  current().setDirty(true);
  pending.resolve('/projects/new.knouximage');
  await first;
  expect(current().documentPath).toBe('/projects/other.knouximage');
  expect(current().dirty).toBe(true);
});

test('export writes the encoded bytes through the authorized file bridge without saving the project', async () => {
  await expect(exportStudioImage(exportOptions())).resolves.toBe('/exports/portrait.png');
  expect(bridge.syncRetouch).toHaveBeenCalledTimes(1);
  expect(file.writeFile).toHaveBeenCalledWith('/exports/portrait.png', sourceBytes);
  expect(current().dirty).toBe(true);
  expect(current().saved).toBe(false);
  expect(current().documentPath).toBe('/projects/portrait.knouximage');
});

test('layer export delivers the chosen layer, not a flattened replacement', async () => {
  const id = current().currentDocument!.layers[0].id;
  await exportStudioImage({ ...exportOptions(), layerId: id });
  expect(bridge.exportLayer).toHaveBeenCalledWith(id, expect.objectContaining({ width: 80, height: 60 }));
  expect(bridge.exportFlattened).not.toHaveBeenCalled();
  expect(file.writeFile).toHaveBeenCalledTimes(1);
});

test('cancelled export does not process, write, or report success', async () => {
  file.saveFile.mockResolvedValue(null);
  await expect(exportStudioImage(exportOptions())).resolves.toBeNull();
  expect(bridge.syncRetouch).not.toHaveBeenCalled();
  expect(bridge.exportFlattened).not.toHaveBeenCalled();
  expect(file.writeFile).not.toHaveBeenCalled();
  expect(current().dirty).toBe(true);
});

test.each(['empty', 'write'])('export %s failure is surfaced and preserves the project', async failure => {
  if (failure === 'empty') bridge.exportFlattened.mockResolvedValue({ bytes: new Uint8Array() });
  else file.writeFile.mockRejectedValue(new Error('Destination unavailable'));
  await expect(exportStudioImage(exportOptions())).resolves.toBeNull();
  expect(current().errors).toHaveLength(1);
  expect(current().dirty).toBe(true);
  expect(current().isLoading).toBe(false);
});

test('image export cannot overwrite the editable project', async () => {
  file.saveFile.mockResolvedValue('/projects/portrait.knouximage');
  await expect(exportStudioImage(exportOptions())).resolves.toBeNull();
  expect(file.writeFile).not.toHaveBeenCalled();
  expect(bridge.exportFlattened).not.toHaveBeenCalled();
});

test('document changes during the destination dialog cancel stale export', async () => {
  const pending = deferred<string>();
  file.saveFile.mockReturnValue(pending.promise);
  const exporting = exportStudioImage(exportOptions());
  current().setCurrentDocument(documentFixture());
  pending.resolve('/exports/stale.png');
  await expect(exporting).resolves.toBeNull();
  expect(file.writeFile).not.toHaveBeenCalled();
});
