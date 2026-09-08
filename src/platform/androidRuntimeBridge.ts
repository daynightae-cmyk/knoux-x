import type { BeginRecordingRequest, RecordingSessionSnapshot } from '../../electron/creative/recording-service';
import { initialRecordingState, reduceRecordingState } from '../core/creative/recordingState';
import { createMultitrackProject, type MultitrackProject } from '../core/creative/multitrackProject';
import { createSlideshowProject, type SlideshowProject } from '../core/creative/slideshowProject';
import {
  createGroupLayer,
  createImageStudioDocument,
  type NewImageStudioDocumentOptions,
} from '../core/image-studio/document/document';
import type {
  ImageBlendMode,
  ImageLayer,
  ImageStudioDocument,
  ImageTransform,
  LayerMask,
  RetouchDocumentState,
} from '../core/image-studio/document/schema';
import { getReleaseInfo } from '../releaseInfo';

import { installBrowserPreviewBridge } from './browserPreviewBridge';

const ANDROID_PREFIX = 'knoux-android:';
const activeRecordings = new Map<string, { snapshot: RecordingSessionSnapshot; chunks: Uint8Array[] }>();
const mediaFiles = new Map<string, File>();
const imageAutosaveListeners = new Set<(filePath: string) => void>();
let currentImageDocument: ImageStudioDocument | null = null;
let imageHistory: ImageStudioDocument[] = [];
let imageHistoryIndex = -1;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function key(name: string): string {
  return `${ANDROID_PREFIX}${name}`;
}

function readStored<T>(name: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key(name));
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function writeStored(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Keep the in-memory runtime usable even if WebView persistence is restricted.
  }
}

function removeStored(name: string): void {
  try {
    window.localStorage.removeItem(key(name));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function noopSubscription(): () => void {
  return () => undefined;
}

function isAndroidNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = window.Capacitor;
  if (!capacitor || capacitor.getPlatform?.() !== 'android') return false;
  return capacitor.isNativePlatform?.() ?? true;
}

function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    const finish = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function rememberFile(file: File): string {
  const id = `${file.name}:${file.size}:${file.lastModified}`;
  mediaFiles.set(id, file);
  return id;
}

function mediaUrl(filePath: string): string {
  const file = mediaFiles.get(filePath);
  if (!file) throw new Error('The selected Android media file is no longer available. Choose it again.');
  return URL.createObjectURL(file);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function recordingHistory(): RecordingSessionSnapshot[] {
  return readStored<RecordingSessionSnapshot[]>('recordings', []);
}

function recordingSnapshot(request: BeginRecordingRequest, id: string): RecordingSessionSnapshot {
  let state = reduceRecordingState(initialRecordingState, { type: 'START_COUNTDOWN' });
  state = reduceRecordingState(state, { type: 'START' });
  const extension = request.mimeType.includes('ogg') ? 'ogg' : 'webm';
  return {
    id,
    encoderId: randomId('encoder'),
    source: request.source,
    mimeType: request.mimeType,
    state,
    outputPath: `${request.suggestedName || 'KNOUX-recording'}.${extension}`,
    startedAt: new Date().toISOString(),
    bytesWritten: 0,
    acceptedVideoFrames: 0,
    droppedFrames: 0,
    activeDurationMs: 0,
    metersActive: true,
  };
}

function installCreativeOverrides(): void {
  const base = window.knouxCreativeAPI;
  const recording = {
    ...base.recording,
    requestMediaPermission: async (): Promise<boolean> => Boolean(navigator.mediaDevices),
    begin: async (request: BeginRecordingRequest): Promise<RecordingSessionSnapshot | null> => {
      const id = randomId('recording');
      const snapshot = recordingSnapshot(request, id);
      activeRecordings.set(id, { snapshot, chunks: [] });
      return clone(snapshot);
    },
    append: async (sessionId: string, chunk: ArrayBuffer | Uint8Array): Promise<RecordingSessionSnapshot> => {
      const session = activeRecordings.get(sessionId);
      if (!session) throw new Error('Android recording session was not found.');
      const bytes = chunk instanceof Uint8Array ? new Uint8Array(chunk) : new Uint8Array(chunk.slice(0));
      session.chunks.push(bytes);
      session.snapshot.bytesWritten += bytes.byteLength;
      session.snapshot.acceptedVideoFrames += 1;
      return clone(session.snapshot);
    },
    pause: async (sessionId: string): Promise<RecordingSessionSnapshot> => {
      const session = activeRecordings.get(sessionId);
      if (!session) throw new Error('Android recording session was not found.');
      session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'PAUSE' });
      session.snapshot.metersActive = false;
      return clone(session.snapshot);
    },
    resume: async (sessionId: string): Promise<RecordingSessionSnapshot> => {
      const session = activeRecordings.get(sessionId);
      if (!session) throw new Error('Android recording session was not found.');
      session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'RESUME' });
      session.snapshot.metersActive = true;
      return clone(session.snapshot);
    },
    finish: async (sessionId: string): Promise<RecordingSessionSnapshot> => {
      const session = activeRecordings.get(sessionId);
      if (!session) throw new Error('Android recording session was not found.');
      session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'STOP' });
      session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'COMPLETE' });
      session.snapshot.completedAt = new Date().toISOString();
      session.snapshot.metersActive = false;
      const parts = session.chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer);
      const blob = new Blob(parts, { type: session.snapshot.mimeType });
      if (blob.size > 0) downloadBlob(blob, session.snapshot.outputPath);
      const result = clone(session.snapshot);
      activeRecordings.delete(sessionId);
      writeStored('recordings', [result, ...recordingHistory()].slice(0, 100));
      return result;
    },
    cancel: async (sessionId: string): Promise<RecordingSessionSnapshot> => {
      const session = activeRecordings.get(sessionId);
      if (!session) throw new Error('Android recording session was not found.');
      session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'CANCEL' });
      session.snapshot.metersActive = false;
      const result = clone(session.snapshot);
      activeRecordings.delete(sessionId);
      return result;
    },
    list: async (): Promise<RecordingSessionSnapshot[]> => [
      ...Array.from(activeRecordings.values(), (entry) => clone(entry.snapshot)),
      ...recordingHistory(),
    ],
    showItem: async (): Promise<void> => undefined,
  };

  const capture = {
    ...base.capture,
    getDesktopSources: async () => [{
      id: 'screen:android',
      name: 'Android screen',
      displayId: 'android-display',
      thumbnail: '',
      appIcon: null,
    }],
  };

  const media = {
    ...base.media,
    open: async (): Promise<{ filePath: string; mediaUrl: string } | null> => {
      const file = (await pickFiles('video/*,audio/*'))[0];
      if (!file) return null;
      const filePath = rememberFile(file);
      return { filePath, mediaUrl: mediaUrl(filePath) };
    },
    toUrl: async (filePath: string): Promise<string> => mediaUrl(filePath),
  };

  window.knouxCreativeAPI = { ...base, recording, capture, media } as Window['knouxCreativeAPI'];
}

function installCoreOverrides(): void {
  const settingsListeners = new Set<(settingKey: string, value: unknown) => void>();
  const base = window.knouxAPI;
  const settings = {
    ...base.settings,
    get: async <T>(settingKey: string, defaultValue?: T): Promise<T> => readStored<T>(`setting:${settingKey}`, defaultValue as T),
    set: async <T>(settingKey: string, value: T): Promise<void> => {
      writeStored(`setting:${settingKey}`, value);
      settingsListeners.forEach((listener) => listener(settingKey, value));
    },
    getAll: async () => ({}),
    reset: async (settingKey?: string): Promise<void> => { if (settingKey) removeStored(`setting:${settingKey}`); },
    export: async (): Promise<string> => JSON.stringify({ runtime: 'android', exportedAt: new Date().toISOString() }, null, 2),
    onChange: (callback: (settingKey: string, value: unknown) => void): (() => void) => {
      settingsListeners.add(callback);
      return () => settingsListeners.delete(callback);
    },
  };
  const system = {
    ...base.system,
    getInfo: async () => {
      const release = getReleaseInfo();
      return {
        product: 'Knoux X' as const,
        version: release.version,
        platform: 'android',
        arch: 'mobile',
        sha: release.sha ?? 'unrecorded',
        branch: 'main',
        builtAt: release.builtAt ?? 'unrecorded',
        packaged: true,
        electronVersion: 'not-applicable',
        chromeVersion: navigator.userAgent,
        nodeVersion: 'not-applicable',
      };
    },
    getBuildInfo: async () => {
      const release = getReleaseInfo();
      return {
        product: 'Knoux X' as const,
        version: release.version,
        sha: release.sha ?? 'unrecorded',
        branch: 'main',
        builtAt: release.builtAt ?? 'unrecorded',
        packaged: true,
        electronVersion: 'not-applicable',
        chromeVersion: navigator.userAgent,
        nodeVersion: 'not-applicable',
      };
    },
  };
  window.knouxAPI = { ...base, settings, system } as Window['knouxAPI'];
}

function persistMultitrack(project: MultitrackProject, filePath?: string): string {
  const target = filePath || `knoux-android://multitrack/${project.id}.knouxmultitrack`;
  writeStored(`multitrack:${target}`, project);
  const recents = readStored<string[]>('multitrack:recents', []).filter((entry) => entry !== target);
  writeStored('multitrack:recents', [target, ...recents].slice(0, 30));
  return target;
}

function installMultitrackBridge(): void {
  const api = {
    create: async (name: string) => createMultitrackProject(randomId('project'), name),
    open: async () => {
      const file = (await pickFiles('.knouxmultitrack,.json,application/json'))[0];
      if (!file) return null;
      const project = JSON.parse(await file.text()) as MultitrackProject;
      const filePath = persistMultitrack(project, `knoux-android://picked/${file.name}`);
      return { project, filePath, migrated: false };
    },
    openRecent: async (filePath: string) => {
      const project = readStored<MultitrackProject | null>(`multitrack:${filePath}`, null);
      return project ? { project: clone(project), filePath, migrated: false } : null;
    },
    save: async (project: MultitrackProject, filePath?: string) => persistMultitrack(project, filePath),
    autosave: async (project: MultitrackProject) => persistMultitrack(project, `knoux-android://autosave/${project.id}.knouxmultitrack`),
    recoveries: async () => [],
    recent: async () => readStored<string[]>('multitrack:recents', []),
    clearRecent: async () => writeStored('multitrack:recents', []),
  };
  window.knouxMultitrackAPI = api as unknown as Window['knouxMultitrackAPI'];
}

function persistSlideshow(project: SlideshowProject, filePath?: string): string {
  const target = filePath || `knoux-android://slideshow/${project.id}.knouxslideshow`;
  writeStored(`slideshow:${target}`, project);
  const recents = readStored<string[]>('slideshow:recents', []).filter((entry) => entry !== target);
  writeStored('slideshow:recents', [target, ...recents].slice(0, 30));
  return target;
}

async function importSlideshowAssets() {
  const files = await pickFiles('image/*,video/*,audio/*', true);
  const assets = files.flatMap((file) => {
    const family = file.type.startsWith('image/') ? 'image' as const
      : file.type.startsWith('video/') ? 'video' as const
        : file.type.startsWith('audio/') ? 'audio' as const : null;
    if (!family) return [];
    const filePath = rememberFile(file);
    return [{ filePath, mediaUrl: mediaUrl(filePath), family, duration: null }];
  });
  return { assets, accepted: assets.length, skipped: files.length - assets.length, failed: 0, issues: [], rootPath: null };
}

function installSlideshowBridge(): void {
  const api = {
    create: async (name: string, template: Parameters<typeof createSlideshowProject>[2]) => createSlideshowProject(randomId('slideshow'), name, template),
    importFiles: importSlideshowAssets,
    importFolder: importSlideshowAssets,
    open: async () => {
      const file = (await pickFiles('.knouxslideshow,.json,application/json'))[0];
      if (!file) return null;
      const project = JSON.parse(await file.text()) as SlideshowProject;
      const filePath = persistSlideshow(project, `knoux-android://picked/${file.name}`);
      return { project, filePath, migrated: false };
    },
    openRecent: async (filePath: string) => {
      const project = readStored<SlideshowProject | null>(`slideshow:${filePath}`, null);
      return project ? { project: clone(project), filePath, migrated: false } : null;
    },
    save: async (project: SlideshowProject, filePath?: string) => persistSlideshow(project, filePath),
    autosave: async (project: SlideshowProject) => persistSlideshow(project, `knoux-android://autosave/${project.id}.knouxslideshow`),
    recoveries: async () => [],
    recoverBackup: async () => null,
    preflight: async () => ({ ready: true, issues: [], assets: [] }),
    relinkFile: async () => null,
    relinkFolder: async () => ({ rootPath: null, matches: [], unresolved: [], ambiguous: [] }),
    recent: async () => readStored<string[]>('slideshow:recents', []),
    clearRecent: async () => writeStored('slideshow:recents', []),
    render: async () => null,
    renderJobs: async () => [],
    cancelRender: async () => false,
    openOutput: async () => undefined,
    revealOutput: async () => undefined,
    onRenderProgress: noopSubscription,
  };
  window.knouxSlideshowAPI = api as unknown as Window['knouxSlideshowAPI'];
}

function pushImageHistory(document: ImageStudioDocument): void {
  imageHistory = imageHistory.slice(0, imageHistoryIndex + 1);
  imageHistory.push(clone(document));
  if (imageHistory.length > 100) imageHistory.shift();
  imageHistoryIndex = imageHistory.length - 1;
}

function commitImage(document: ImageStudioDocument, remember = true): ImageStudioDocument {
  const next = clone(document);
  next.updatedAt = new Date().toISOString();
  currentImageDocument = next;
  writeStored('image-studio:current', next);
  if (remember) pushImageHistory(next);
  return clone(next);
}

function requireImage(): ImageStudioDocument {
  if (!currentImageDocument) throw new Error('Create or open an Image Studio document first.');
  return clone(currentImageDocument);
}

function updateLayer(layerId: string, update: (layer: ImageLayer) => ImageLayer): ImageStudioDocument {
  const document = requireImage();
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error('Image Studio layer was not found.');
  document.layers[index] = update(clone(document.layers[index]));
  return commitImage(document);
}

async function exportImage(options: { format?: 'png' | 'jpeg' | 'webp'; quality?: number | null; width?: number; height?: number }) {
  const document = requireImage();
  const width = Math.max(1, Math.round(options.width ?? document.canvas.width));
  const height = Math.max(1, Math.round(options.height ?? document.canvas.height));
  const format = options.format ?? 'png';
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Android Image Studio canvas is unavailable.');
  if (document.canvas.backgroundMode !== 'transparent') {
    context.fillStyle = document.canvas.backgroundColor;
    context.fillRect(0, 0, width, height);
  }
  for (const layer of document.layers) {
    if (!layer.visible || layer.kind !== 'raster') continue;
    const asset = document.embeddedAssets.find((entry) => entry.id === layer.assetId);
    if (!asset) continue;
    const image = new Image();
    image.src = asset.dataUrl;
    await image.decode();
    context.save();
    context.globalAlpha = layer.opacity;
    context.drawImage(image, 0, 0, width, height);
    context.restore();
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image export failed.')), mime, options.quality ?? undefined);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  downloadBlob(blob, `${document.title || 'KNOUX-image'}.${format === 'jpeg' ? 'jpg' : format}`);
  return { bytes, plan: { format, width, height }, width, height, mime, extension: format };
}

function installImageStudioBridge(): void {
  currentImageDocument = readStored<ImageStudioDocument | null>('image-studio:current', null);
  if (currentImageDocument) pushImageHistory(currentImageDocument);
  const api = {
    create: async (request: NewImageStudioDocumentOptions) => {
      imageHistory = [];
      imageHistoryIndex = -1;
      return commitImage(createImageStudioDocument(request));
    },
    open: async () => {
      const file = (await pickFiles('.knouximage,.json,application/json'))[0];
      return file ? commitImage(JSON.parse(await file.text()) as ImageStudioDocument) : null;
    },
    save: async (filePath?: string) => {
      const document = requireImage();
      const target = filePath || `knoux-android://image/${document.documentId}.knouximage`;
      writeStored(`image:${target}`, document);
      downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), `${document.title || 'KNOUX-image'}.knouximage`);
      return target;
    },
    saveAs: async (filePath: string) => { writeStored(`image:${filePath}`, requireImage()); return filePath; },
    close: async () => { currentImageDocument = null; },
    getCurrent: async () => currentImageDocument ? clone(currentImageDocument) : null,
    syncRetouch: async (updates: Array<{ layerId: string; retouche: RetouchDocumentState | null }>) => {
      const document = requireImage();
      for (const update of updates) {
        const layer = document.layers.find((entry) => entry.id === update.layerId);
        if (layer?.kind === 'raster') layer.retouche = update.retouche ?? undefined;
      }
      return commitImage(document, false);
    },
    recent: async () => [],
    migrate: async () => requireImage(),
    validate: async () => ({ valid: true }),
    recover: async () => currentImageDocument ? clone(currentImageDocument) : createImageStudioDocument(),
    createLayer: async (layer: ImageLayer) => { const doc = requireImage(); doc.layers.push(clone(layer)); doc.activeLayerId = layer.id; return commitImage(doc); },
    deleteLayer: async (layerId: string) => { const doc = requireImage(); const before = doc.layers.length; doc.layers = doc.layers.filter((layer) => layer.id !== layerId && layer.parentId !== layerId); if (doc.layers.length === before) return false; commitImage(doc); return true; },
    duplicateLayer: async (layerId: string) => { const doc = requireImage(); const source = doc.layers.find((layer) => layer.id === layerId); if (!source) throw new Error('Image Studio layer was not found.'); const copy = clone(source); copy.id = randomId('layer'); copy.name = `${copy.name} copy`; copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt; doc.layers.push(copy); doc.activeLayerId = copy.id; return commitImage(doc); },
    renameLayer: async (id: string, name: string) => { updateLayer(id, (layer) => ({ ...layer, name: name.normalize('NFC').trim().slice(0, 200) })); return true; },
    reorderLayers: async (ids: string[]) => { const doc = requireImage(); const byId = new Map(doc.layers.map((layer) => [layer.id, layer])); doc.layers = [...ids.map((id) => byId.get(id)).filter((layer): layer is ImageLayer => Boolean(layer)), ...doc.layers.filter((layer) => !ids.includes(layer.id))]; commitImage(doc); return true; },
    groupLayers: async (ids: string[], name?: string) => { const doc = requireImage(); const group = createGroupLayer({ name: name || 'Group' }); doc.layers = doc.layers.map((layer) => ids.includes(layer.id) ? { ...layer, parentId: group.id } : layer); doc.layers.push(group); return commitImage(doc); },
    ungroupLayers: async (groupId: string) => { const doc = requireImage(); doc.layers = doc.layers.filter((layer) => layer.id !== groupId).map((layer) => layer.parentId === groupId ? { ...layer, parentId: null } : layer); commitImage(doc); return true; },
    setVisibility: async (id: string, visible: boolean) => { updateLayer(id, (layer) => ({ ...layer, visible })); return true; },
    setLocked: async (id: string, locked: boolean) => { updateLayer(id, (layer) => ({ ...layer, locked })); return true; },
    setOpacity: async (id: string, opacity: number) => { updateLayer(id, (layer) => ({ ...layer, opacity: Math.max(0, Math.min(1, opacity)) })); return true; },
    setBlendMode: async (id: string, blendMode: ImageBlendMode) => { updateLayer(id, (layer) => ({ ...layer, blendMode })); return true; },
    setTransform: async (id: string, transform: ImageTransform) => { updateLayer(id, (layer) => ({ ...layer, transform: clone(transform) })); return true; },
    addMask: async (id: string, mask: LayerMask) => { updateLayer(id, (layer) => ({ ...layer, mask: clone(mask) })); return true; },
    updateMask: async (id: string, mask: Partial<LayerMask>) => { updateLayer(id, (layer) => ({ ...layer, mask: layer.mask ? { ...layer.mask, ...mask } : null })); return true; },
    removeMask: async (id: string) => { updateLayer(id, (layer) => ({ ...layer, mask: null })); return true; },
    applyAdjustment: async () => true,
    undo: async () => { if (imageHistoryIndex <= 0) return false; imageHistoryIndex -= 1; currentImageDocument = clone(imageHistory[imageHistoryIndex]); writeStored('image-studio:current', currentImageDocument); return true; },
    redo: async () => { if (imageHistoryIndex >= imageHistory.length - 1) return false; imageHistoryIndex += 1; currentImageDocument = clone(imageHistory[imageHistoryIndex]); writeStored('image-studio:current', currentImageDocument); return true; },
    canUndo: async () => imageHistoryIndex > 0,
    canRedo: async () => imageHistoryIndex < imageHistory.length - 1,
    createCheckpoint: async () => true,
    importImage: async () => requireImage(),
    importAsLayer: async () => requireImage(),
    exportDocument: exportImage,
    exportFlattened: exportImage,
    exportLayer: async (_layerId: string, options: Parameters<typeof exportImage>[0]) => exportImage(options),
    inspectFormat: async () => ({}),
    autosaveStatus: async () => ({ available: Boolean(currentImageDocument) }),
    triggerAutosave: async () => { const doc = requireImage(); const path = `knoux-android://autosave/${doc.documentId}.knouximage`; writeStored(`image:${path}`, doc); imageAutosaveListeners.forEach((listener) => listener(path)); return path; },
    recoverySessions: async () => [],
    restoreRecovery: async () => currentImageDocument ? clone(currentImageDocument) : {},
    discardRecovery: async () => true,
    listProviders: async () => [],
    providerStatus: async () => ({}),
    listModels: async () => [],
    refreshModels: async () => [],
    validateCredential: async () => ({ valid: false, reason: 'No Android provider is configured.' }),
    setCredential: async () => ({}),
    removeCredential: async () => true,
    createJob: async () => randomId('image-job'),
    cancelJob: async () => true,
    retryJob: async (jobId: string) => jobId,
    getJob: async () => null,
    listJobs: async () => [],
    removeJob: async () => true,
    importResult: async () => requireImage(),
    getVerifiedFaceModel: async () => ({ status: 'unavailable', modelId: 'android-local', reason: 'No local face model is installed.' }),
    getVerifiedPoseModel: async () => ({ status: 'unavailable', modelId: 'android-local', reason: 'No local pose model is installed.' }),
    importRetouchAsset: async () => ({}),
    readRetouchProxy: async () => null,
    releaseRetouchAsset: async () => true,
    readAsset: async () => null,
    onAutosave: (callback: (path: string) => void) => { imageAutosaveListeners.add(callback); return () => { imageAutosaveListeners.delete(callback); }; },
    onJobProgress: noopSubscription,
    onJobComplete: noopSubscription,
    onJobFailed: noopSubscription,
    onRecoveryAvailable: noopSubscription,
  };
  window.knouxImageStudioAPI = api as unknown as Window['knouxImageStudioAPI'];
}

function installOtherFeatureBridges(): void {
  window.knouxRecordingAPI = {
    selectRegion: async () => null,
    completeRegionSelection: async () => false,
    cancelRegionSelection: async () => false,
  } as unknown as Window['knouxRecordingAPI'];

  window.knouxAudioToolsAPI = {
    analyze: async () => null,
    process: async () => null,
    jobs: async () => [],
    cancel: async () => false,
    onProgress: noopSubscription,
  } as unknown as Window['knouxAudioToolsAPI'];

  const plans: Array<Record<string, unknown>> = readStored<Array<Record<string, unknown>>>('video-studio:plans', []);
  const branches: Array<Record<string, unknown>> = readStored<Array<Record<string, unknown>>>('video-studio:branches', []);
  window.knouxVideoStudioAPI = {
    listProviders: async () => [], providerStatus: async () => [], listModels: async () => [],
    createJob: async () => ({ id: randomId('video-job'), status: 'queued', phase: 'local' }), cancelJob: async () => true, retryJob: async (id: string) => ({ id, status: 'queued', phase: 'local' }), getJob: async () => null, listJobs: async () => [], removeJob: async () => true,
    aiHealth: async () => ({ available: false, providers: [] }), aiEntitlement: async () => ({ entitled: false }), aiPlan: async () => null,
    aiSettingsGet: async () => readStored('video-studio:ai-settings', {}), aiSettingsSet: async (settings: unknown) => { writeStored('video-studio:ai-settings', settings); return true; },
    gatewayConfigGet: async () => readStored('video-studio:gateway', {}), gatewayConfigSet: async (config: unknown) => { writeStored('video-studio:gateway', config); return true; }, setCredential: async () => true, offlineJobs: async () => [],
    analyzeEditImpact: async () => ({ affectedOperations: [], warnings: [] }), replayEditPlan: async (project: unknown) => ({ project: clone(project) }),
    recordPlan: async (_project: unknown, plan: unknown) => { const record = { id: randomId('plan'), plan: clone(plan), createdAt: new Date().toISOString() }; plans.unshift(record); writeStored('video-studio:plans', plans); return record; },
    listPlans: async () => clone(plans), getPlan: async (id: string) => clone(plans.find((entry) => entry.id === id) ?? null), removePlan: async (id: string) => { const index = plans.findIndex((entry) => entry.id === id); if (index < 0) return false; plans.splice(index, 1); writeStored('video-studio:plans', plans); return true; },
    createBranch: async (project: unknown, label: string, parentBranchId?: string) => { const branch = { id: randomId('branch'), label, parentBranchId: parentBranchId ?? null, project: clone(project), createdAt: new Date().toISOString() }; branches.unshift(branch); writeStored('video-studio:branches', branches); return branch; },
    listBranches: async () => clone(branches), getBranch: async (id: string) => clone(branches.find((entry) => entry.id === id) ?? null), removeBranch: async (id: string) => { const index = branches.findIndex((entry) => entry.id === id); if (index < 0) return false; branches.splice(index, 1); writeStored('video-studio:branches', branches); return true; }, compareBranches: async (leftBranchId: string, rightBranchId: string) => ({ leftBranchId, rightBranchId, comparable: true }),
    onJobPhase: noopSubscription, onJobProgress: noopSubscription, onJobComplete: noopSubscription, onJobFailed: noopSubscription, onJobCancelled: noopSubscription, onFlushed: noopSubscription,
  } as unknown as Window['knouxVideoStudioAPI'];
}

export function installAndroidRuntimeBridge(): boolean {
  if (!isAndroidNativeRuntime()) return false;
  installBrowserPreviewBridge();
  window.knouxRuntime = Object.freeze({ edition: 'android', product: 'Knoux X', bridgeVersion: 2 });
  document.documentElement.dataset.runtime = 'android';
  document.documentElement.dataset.platform = 'android';
  installCoreOverrides();
  installCreativeOverrides();
  installMultitrackBridge();
  installSlideshowBridge();
  installImageStudioBridge();
  installOtherFeatureBridges();
  return true;
}
