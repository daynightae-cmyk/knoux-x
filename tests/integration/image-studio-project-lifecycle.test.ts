import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { ImageStudioService } from '../../electron/image-studio/image-studio-service';
import { planExport } from '../../src/core/image-studio/export/plan';
import { exportStudioImage, saveStudioProject } from '../../src/features/image-studio/documentCommands';
import { applyRetouchToBuffer } from '../../src/features/image-studio/retouch/retouchPreviewBridge';
import { useImageStudioStore } from '../../src/features/image-studio/store/imageStudioStore';
import type { RetouchDocumentState } from '../../src/core/image-studio/document/schema';

test('real disk save/restart/reopen and masked PNG/JPEG/WebP exports preserve source and project state', async () => {
  const root = path.resolve('_temp/live-evidence', `retouch-r1-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  const fixture = path.resolve('tests/android/fixtures/portrait-two-faces.jpg');
  const sourceFile = await fs.readFile(fixture);
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const sourceHash = digest(sourceFile);
  const { data: original, info } = await sharp(sourceFile).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let networkCalls = 0;
  const denyNetwork = async (): Promise<never> => { networkCalls++; throw new Error('Local retouch must not use the network'); };
  const makeService = async () => {
    const service = new ImageStudioService({
      userDataDir: root, autosaveDir: path.join(root, 'autosave'), recoveryIndexPath: path.join(root, 'recovery.json'),
      events: { autosave: () => {}, recoveryAvailable: () => {}, jobProgress: () => {}, jobComplete: () => {}, jobFailed: () => {} },
      http: { get: denyNetwork, post: denyNetwork, delete: denyNetwork },
    });
    await service.initialize();
    return service;
  };
  let service = await makeService();
  const store = () => useImageStudioStore.getState();
  let destination: string | null = null;
  // Adapt the existing renderer commands to the real backend and disk, not mock processing.
  Object.assign(globalThis, { window: {
    knouxImageStudioAPI: {
      syncRetouch: (updates: Parameters<ImageStudioService['syncRetouchState']>[0]) => service.syncRetouchState(updates),
      save: async (file: string) => (await service.save(file)).path,
      saveAs: async (file: string) => (await service.saveAs(file)).path,
      exportFlattened: (plan: Parameters<ImageStudioService['renderPlan']>[0]) => service.renderPlan(plan),
      exportLayer: (id: string, plan: Parameters<ImageStudioService['renderPlan']>[0]) => service.renderLayerPlan(id, plan),
    },
    knouxAPI: { file: { saveFile: async () => destination, writeFile: (file: string, bytes: Uint8Array) => fs.writeFile(file, bytes) } },
  } });
  try {
    store().reset();
    store().setCurrentDocument(await service.importImage(fixture));
    store().setDocumentPath(null);
    const layerId = store().currentDocument!.layers[0].id;
    store().setActiveLayerId(layerId);
    const mask = new Uint8ClampedArray(original.length);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width / 2; x++) mask[(y * info.width + x) * 4 + 3] = 255;
    }
    store().addRetouchMask({ id: 'left-half', width: info.width, height: info.height, alphaDataUrl: Buffer.from(mask).toString('base64'), featherPx: 0, inverted: false });
    store().addRetouchOperation({ type: 'makeup-tint', enabled: true, color: '#e85578', strength: 0.6, maskId: 'left-half' });
    const snapshot = store().currentDocument!;
    const retouch = (snapshot.layers[0] as { retouche: RetouchDocumentState }).retouche;
    const preview = await applyRetouchToBuffer({ width: info.width, height: info.height, data: new Uint8ClampedArray(original) }, retouch, 'export');
    const project = path.join(root, 'portrait.knouximage');
    destination = project;
    expect(await saveStudioProject({ title: 'Save', failureMessage: 'Save failed' })).toBe(project);
    expect(store().saved).toBe(true);

    // A new backend instance models application restart; the renderer loads the saved document.
    service.close();
    service = await makeService();
    store().setCurrentDocument(await service.open(project));
    expect((store().currentDocument!.layers[0] as { retouche: RetouchDocumentState }).retouche).toEqual(retouch);
    const outputs = [];
    let changedPixels = 0;
    let outsideMaskChangedPixels = 0;
    let changedAlphaPixels = 0;
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      destination = path.join(root, `portrait.${format}`);
      const plan = planExport(snapshot.canvas, { format, preserveAlpha: true, ...(format === 'png' ? {} : { quality: 0.94 }) });
      expect(await exportStudioImage({ plan, title: 'Export', failureMessage: 'Export failed' })).toBe(destination);
      const file = await fs.readFile(destination);
      const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBe(info.width);
      expect(decoded.info.height).toBe(info.height);
      if (format === 'png') {
        expect(decoded.data.equals(Buffer.from(preview.data))).toBe(true);
        for (let pixel = 0; pixel < info.width * info.height; pixel++) {
          const index = pixel * 4;
          const changed = !decoded.data.subarray(index, index + 4).equals(original.subarray(index, index + 4));
          if (pixel % info.width >= info.width / 2) outsideMaskChangedPixels += Number(changed);
          else if (changed) changedPixels++;
          changedAlphaPixels += Number(decoded.data[index + 3] !== original[index + 3]);
        }
        expect(changedPixels).toBeGreaterThan(0);
        expect(outsideMaskChangedPixels).toBe(0);
        expect(changedAlphaPixels).toBe(0);
      }
      outputs.push({ path: destination, format, bytes: file.length, sha256: digest(file), width: info.width, height: info.height });
    }
    // Exporting new edits must not silently save those edits to the project on disk.
    store().setActiveLayerId(layerId);
    const op = retouch.operations[0];
    store().updateRetouchOperation(op.id, { strength: 0 });
    destination = path.join(root, 'zero-strength.png');
    await exportStudioImage({ plan: planExport(snapshot.canvas, { format: 'png' }), title: 'Export', failureMessage: 'Export failed' });
    expect((await sharp(destination).ensureAlpha().raw().toBuffer()).equals(original)).toBe(true);
    expect(store().dirty).toBe(true);
    expect(JSON.parse(await fs.readFile(project, 'utf8')).document.layers[0].retouche.operations[0].strength).toBe(0.6);
    expect(digest(await fs.readFile(fixture))).toBe(sourceHash);
    expect(networkCalls).toBe(0);
    await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({
      success: true, runtime: 'Node 20 real ImageStudioService and renderer commands; not Electron IPC',
      fixture, fixtureProvenance: 'repository-authored SVG raster, not human/model-inference evidence',
      sourceHash, originalUnchanged: true, restartReopenExact: true, previewPngExact: true,
      outsideMaskUnchanged: true, alphaUnchanged: true, zeroStrengthExact: true,
      unsavedEditsPreservedAfterExport: true, changedPixels, networkCalls, outputs,
    }, null, 2));
    console.log(`R1 real image evidence: ${path.join(root, 'evidence.json')}`);
  } finally {
    service.close();
    store().reset();
  }
}, 120000);
