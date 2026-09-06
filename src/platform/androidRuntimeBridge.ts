import type { RecordingSessionSnapshot } from '../../electron/creative/recording-service';
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
import { installBrowserPreviewBridge } from './browserPreviewBridge';

const ANDROID_PREFIX = 'knoux-android:';
const imageStudioListeners = {
  autosave: new Set<(path: string) => void>(),
};

interface StoredRecording {
  snapshot: RecordingSessionSnapshot;
  chunks: Uint8Array[];
}

const activeRecordings = new Map<string, StoredRecording>();
const mediaFiles = new Map<string, File>();
let currentImageDocument: ImageStudioDocument | null = null;
let imageHistory: ImageStudioDocument[] = [];
let imageHistoryIndex = -1;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(key: string): string {
  return `${ANDROID_PREFIX}${key}`;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // The app remains usable in memory if WebView storage is unavailable.
  }
}

function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(storageKey(key));
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
    const cleanup = (): void => input.remove();
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    }, { once: true });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve([]);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function rememberFile(file: File): string {
  const id = `${file.name}:${file.size}:${file.lastModified}`;
  const previous = mediaFiles.get(id);
  if (previous && previous !== file) {
    // File objects do not require explicit disposal; object URLs are created on demand.
  }
  mediaFiles.set(id, file);
  return id;
}

function fileUrl(id: string): string {
  const file = mediaFiles.get(id);
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

function downloadText(text: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function baseRecordingSnapshot(
  id: string,
  request: { source: 'player' | 'window' | 'display'; mimeType: string; suggestedName?: string },
): RecordingSessionSnapshot {
  let state = reduceRecordingState(initialRecordingState, { type: 'START_COUNTDOWN' });
  state = reduceRecordingState(state, { type: 'START' });
  const extension = request.mimeType.includes('ogg') ? 'ogg' : 'webm';
  return {
    id,
    encoderId: randomId('android-encoder'),
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

function recordingHistory(): RecordingSessionSnapshot[] {
  return readStored<RecordingSessionSnapshot[]>('recordings', []);
}

function storeRecording(snapshot: RecordingSessionSnapshot): void {
  writeStored('recordings', [snapshot, ...recordingHistory()].slice(0, 100));
}

function installAndroidRecordingBridge(): void {
  const recording = window.knouxCreativeAPI.recording;
  recording.requestMediaPermission = async () => Boolean(navigator.mediaDevices);
  recording.begin = async (request) => {
    const id = randomId('recording');
    const snapshot = baseRecordingSnapshot(id, request);
    activeRecordings.set(id, { snapshot, chunks: [] });
    return clone(snapshot);
  };
  recording.append = async (sessionId, chunk) => {
    const session = activeRecordings.get(sessionId);
    if (!session) throw new Error('Android recording session was not found.');
    const bytes = chunk instanceof Uint8Array ? new Uint8Array(chunk) : new Uint8Array(chunk.slice(0));
    session.chunks.push(bytes);
    session.snapshot.bytesWritten += bytes.byteLength;
    session.snapshot.acceptedVideoFrames += 1;
    return clone(session.snapshot);
  };
  recording.pause = async (sessionId) => {
    const session = activeRecordings.get(sessionId);
    if (!session) throw new Error('Android recording session was not found.');
    session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'PAUSE' });
    session.snapshot.metersActive = false;
    return clone(session.snapshot);
  };
  recording.resume = async (sessionId) => {
    const session = activeRecordings.get(sessionId);
    if (!session) throw new Error('Android recording session was not found.');
    session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'RESUME' });
    session.snapshot.metersActive = true;
    return clone(session.snapshot);
  };
  recording.finish = async (sessionId) => {
    const session = activeRecordings.get(sessionId);
    if (!session) throw new Error('Android recording session was not found.');
    session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'STOP' });
    session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'COMPLETE' });
    session.snapshot.completedAt = new Date().toISOString();
    session.snapshot.metersActive = false;
    const blobParts = session.chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer);
    const blob = new Blob(blobParts, { type: session.snapshot.mimeType });
    if (blob.size > 0) downloadBlob(blob, session.snapshot.outputPath);
    const finished = clone(session.snapshot);
    activeRecordings.delete(sessionId);
    storeRecording(finished);
    return finished;
  };
  recording.cancel = async (sessionId) => {
    const session = activeRecordings.get(sessionId);
    if (!session) throw new Error('Android recording session was not found.');
    session.snapshot.state = reduceRecordingState(session.snapshot.state, { type: 'CANCEL' });
    session.snapshot.metersActive = false;
    const cancelled = clone(session.snapshot);
    activeRecordings.delete(sessionId);
    return cancelled;
  };
  recording.list = async () => [
    ...Array.from(activeRecordings.values(), (entry) => clone(entry.snapshot)),
    ...recordingHistory(),
  ];
  recording.showItem = async () => undefined;

  window.knouxCreativeAPI.capture.getDesktopSources = async () => [{
    id: 'screen:android',
    name: 'Android screen',
    displayId: 'android-display',
    thumbnail: '',
    appIcon: null,
  }];
}

function persistMultitrack(project: MultitrackProject, path?: string): string {
  const target = path || `knoux-android://multitrack/${project.id}.knouxmultitrack`;
  writeStored(`multitrack:${target}`, project);
  const recents = readStored<string[]>('multitrack:recents', []).filter((entry) => entry !== target);
  writeStored('multitrack:recents', [target, ...recents].slice(0, 30));
  return target;
}

function installMultitrackBridge(): void {
  const api = {
    create: async (name: string) => createMultitrackProject(randomId('project'), name),
    open: async () => {
      const files = await pickFiles('.knouxmultitrack,.json,application/json');
      const file = files[0];
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

function persistSlideshow(project: SlideshowProject, path?: string): string {
  const target = path || `knoux-android://slideshow/${project.id}.knouxslideshow`;
  writeStored(`slideshow:${target}`, project);
  const recents = readStored<string[]>('slideshow:recents', []).filter((entry) => entry !== target);
  writeStored('slideshow:recents', [target, ...recents].slice(0, 30));
  return target;
}

function slideshowFamily(file: File): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

async function slideshowImport(multiple: boolean): Promise<{
  assets: Array<{ filePath: string; mediaUrl: string; family: 'image' | 'video' | 'audio'; duration: number | null }>;
  accepted: number;
  skipped: number;
  failed: number;
  issues: Array<{ filePath: string; reason: string }>;
  rootPath: string | null;
}> {
  const files = await pickFiles('image/*,video/*,audio/*', multiple);
  const assets = files.flatMap((file) => {
    const family = slideshowFamily(file);
    if (!family) return [];
    const id = rememberFile(file);
    return [{ filePath: id, mediaUrl: fileUrl(id), family, duration: null }];
  });
  return {
    assets,
    accepted: assets.length,
    skipped: files.length - assets.length,
    failed: 0,
    issues: [],
    rootPath: null,
  };
}

function installSlideshowBridge(): void {
  const api = {
    create: async (name: string, template: Parameters<typeof createSlideshowProject>[2]) =>
      createSlideshowProject(randomId('slideshow'), name, template),
    importFiles: async () => slideshowImport(true),
    importFolder: async () => slideshowImport(true),
    open: async () => {
      const files = await pickFiles('.knouxslideshow,.json,application/json');
      const file = files[0];
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

function requireImageDocument(): ImageStudioDocument {
  if (!currentImageDocument) throw new Error('Create or open an Image Studio document first.');
  return clone(currentImageDocument);
}

function updateImageLayer(layerId: string, update: (layer: ImageLayer) => ImageLayer): ImageStudioDocument {
  const document = requireImageDocument();
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error('Image Studio layer was not found.');
  document.layers[index] = update(clone(document.layers[index]));
  return commitImage(document);
}

async function imageExport(options: { format?: 'png' | 'jpeg' | 'webp'; quality?: number | null; width?: number; height?: number }): Promise<{
  bytes: Uint8Array;
  plan: object;
  width: number;
  height: number;
  mime: string;
  extension: string;
}> {
  const document = requireImageDocument();
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
    context.setTransform(
      layer.transform.a * width / document.canvas.width,
      layer.transform.b,
      layer.transform.c,
      layer.transform.d * height / document.canvas.height,
      layer.transform.e * width / document.canvas.width,
      layer.transform.f * height / document.canvas.height,
    );
    context.drawImage(image, 0, 0);
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

  const create = async (request: NewImageStudioDocumentOptions): Promise<ImageStudioDocument> => {
    const document = createImageStudioDocument(request);
    imageHistory = [];
    imageHistoryIndex = -1;
    return commitImage(document);
  };

  const api = {
    create,
    open: async () => {
      const files = await pickFiles('.knouximage,.json,application/json');
      const file = files[0];
      if (!file) return null;
      return commitImage(JSON.parse(await file.text()) as ImageStudioDocument);
    },
    save: async (filePath?: string) => {
      const document = requireImageDocument();
      const path = filePath || `knoux-android://image/${document.documentId}.knouximage`;
      writeStored(`image:${path}`, document);
      downloadText(JSON.stringify(document, null, 2), `${document.title || 'KNOUX-image'}.knouximage`);
      return path;
    },
    saveAs: async (filePath: string) => {
      const document = requireImageDocument();
      writeStored(`image:${filePath}`, document);
      return filePath;
    },
    close: async () => { currentImageDocument = null; },
    getCurrent: async () => currentImageDocument ? clone(currentImageDocument) : null,
    syncRetouch: async (updates: Array<{ layerId: string; retouche: RetouchDocumentState | null }>) => {
      const document = requireImageDocument();
      for (const update of updates) {
        const layer = document.layers.find((entry) => entry.id === update.layerId);
        if (layer?.kind === 'raster') layer.retouche = update.retouche ?? undefined;
      }
      return commitImage(document, false);
    },
    recent: async () => [],
    migrate: async () => requireImageDocument(),
    validate: async () => ({ valid: true }),
    recover: async () => currentImageDocument ? clone(currentImageDocument) : createImageStudioDocument(),
    createLayer: async (layer: ImageLayer) => {
      const document = requireImageDocument();
      document.layers.push(clone(layer));
      document.activeLayerId = layer.id;
      return commitImage(document);
    },
    deleteLayer: async (layerId: string) => {
      const document = requireImageDocument();
      const before = document.layers.length;
      document.layers = document.layers.filter((layer) => layer.id !== layerId && layer.parentId !== layerId);
      if (document.activeLayerId === layerId) document.activeLayerId = null;
      if (document.layers.length === before) return false;
      commitImage(document);
      return true;
    },
    duplicateLayer: async (layerId: string) => {
      const document = requireImageDocument();
      const source = document.layers.find((layer) => layer.id === layerId);
      if (!source) throw new Error('Image Studio layer was not found.');
      const duplicate = clone(source);
      duplicate.id = randomId('layer');
      duplicate.name = `${duplicate.name} copy`;
      duplicate.createdAt = new Date().toISOString();
      duplicate.updatedAt = duplicate.createdAt;
      document.layers.push(duplicate);
      document.activeLayerId = duplicate.id;
      return commitImage(document);
    },
    renameLayer: async (layerId: string, name: string) => {
      updateImageLayer(layerId, (layer) => ({ ...layer, name: name.normalize('NFC').trim().slice(0, 200), updatedAt: new Date().toISOString() }));
      return true;
    },
    reorderLayers: async (layerIds: string[]) => {
      const document = requireImageDocument();
      const byId = new Map(document.layers.map((layer) => [layer.id, layer]));
      const ordered = layerIds.map((id) => byId.get(id)).filter((layer): layer is ImageLayer => Boolean(layer));
      const remaining = document.layers.filter((layer) => !layerIds.includes(layer.id));
      document.layers = [...ordered, ...remaining];
      commitImage(document);
      return true;
    },
    groupLayers: async (layerIds: string[], groupName?: string) => {
      const document = requireImageDocument();
      const group = createGroupLayer({ name: groupName || 'Group' });
      document.layers = document.layers.map((layer) => layerIds.includes(layer.id) ? { ...layer, parentId: group.id } : layer);
      document.layers.push(group);
      document.activeLayerId = group.id;
      return commitImage(document);
    },
    ungroupLayers: async (groupLayerId: string) => {
      const document = requireImageDocument();
      document.layers = document.layers
        .filter((layer) => layer.id !== groupLayerId)
        .map((layer) => layer.parentId === groupLayerId ? { ...layer, parentId: null } : layer);
      commitImage(document);
      return true;
    },
    setVisibility: async (id: string, visible: boolean) => { updateImageLayer(id, (layer) => ({ ...layer, visible })); return true; },
    setLocked: async (id: string, locked: boolean) => { updateImageLayer(id, (layer) => ({ ...layer, locked })); return true; },
    setOpacity: async (id: string, opacity: number) => { updateImageLayer(id, (layer) => ({ ...layer, opacity: Math.max(0, Math.min(1, opacity)) })); return true; },
    setBlendMode: async (id: string, blendMode: ImageBlendMode) => { updateImageLayer(id, (layer) => ({ ...layer, blendMode })); return true; },
    setTransform: async (id: string, transform: ImageTransform) => { updateImageLayer(id, (layer) => ({ ...layer, transform: clone(transform) })); return true; },
    addMask: async (id: string, mask: LayerMask) => { updateImageLayer(id, (layer) => ({ ...layer, mask: clone(mask) })); return true; },
    updateMask: async (id: string, mask: Partial<LayerMask>) => { updateImageLayer(id, (layer) => ({ ...layer, mask: layer.mask ? { ...layer.mask, ...mask } : null })); return true; },
    removeMask: async (id: string) => { updateImageLayer(id, (layer) => ({ ...layer, mask: null })); return true; },
    applyAdjustment: async () => true,
    undo: async () => {
      if (imageHistoryIndex <= 0) return false;
      imageHistoryIndex -= 1;
      currentImageDocument = clone(imageHistory[imageHistoryIndex]);
      writeStored('image-studio:current', currentImageDocument);
      return true;
    },
    redo: async () => {
      if (imageHistoryIndex >= imageHistory.length - 1) return false;
      imageHistoryIndex += 1;
      currentImageDocument = clone(imageHistory[imageHistoryIndex]);
      writeStored('image-studio:current', currentImageDocument);
      return true;
    },
    canUndo: async () => imageHistoryIndex > 0,
    canRedo: async () => imageHistoryIndex < imageHistory.length - 1,
    createCheckpoint: async () => true,
    importImage: async () => requireImageDocument(),
    importAsLayer: async () => requireImageDocument(),
    exportDocument: imageExport,
    exportFlattened: imageExport,
    exportLayer: async (_layerId: string, options: Parameters<typeof imageExport>[0]) => imageExport(options),
    inspectFormat: async () => ({}),
    autosaveStatus: async () => ({ available: Boolean(currentImageDocument) }),
    triggerAutosave: async () => {
      const document = requireImageDocument();
      const path = `knoux-android://autosave/${document.documentId}.knouximage`;
      writeStored(`image:${path}`, document);
      imageStudioListeners.autosave.forEach((listener) => listener(path));
      return path;
    },
    recoverySessions: async () => [],
    restoreRecovery: async () => currentImageDocument ? clone(currentImageDocument) : {},
    discardRecovery: async () => true,
    listProviders: async () => [],
    providerStatus: async () => ({}),
    listModels: async () => [],
    refreshModels: async () => [],
    validateCredential: async () => ({ valid: false, reason: 'Provider validation is unavailable until a provider is configured.' }),
    setCredential: async () => ({}),
    removeCredential: async () => true,
    createJob: async () => randomId('image-job'),
    cancelJob: async () => true,
    retryJob: async (jobId: string) => jobId,
    getJob: async () => null,
    listJobs: async () => [],
    removeJob: async () => true,
    importResult: async () => requireImageDocument(),
    getVerifiedFaceModel: async () => ({ status: 'unavailable', modelId: 'android-native-pending', reason: 'No local face model is installed.' }),
    getVerifiedPoseModel: async () => ({ status: 'unavailable', modelId: 'android-native-pending', reason: 'No local pose model is installed.' }),
    importRetouchAsset: async () => ({}),
    readRetouchProxy: async () => null,
    releaseRetouchAsset: async () => true,
    readAsset: async () => null,
    onAutosave: (callback: (filePath: string) => void) => { imageStudioListeners.autosave.add(callback); return () => imageStudioListeners.autosave.delete(callback); },
    onJobProgress: noopSubscription,
    onJobComplete: noopSubscription,
    onJobFailed: noopSubscription,
    onRecoveryAvailable: noopSubscription,
  };
  window.knouxImageStudioAPI = api as unknown as Window['knouxImageStudioAPI'];
}

function installAudioToolsBridge(): void {
  const api = {
    analyze: async () => null,
    process: async () => null,
    jobs: async () => [],
    cancel: async () => false,
    onProgress: noopSubscription,
  };
  window.knouxAudioToolsAPI = api as unknown as Window['knouxAudioToolsAPI'];
}

function installVideoStudioBridge(): void {
  const plans: unknown[] = readStored<unknown[]>('video-studio:plans', []);
  const branches: Array<Record<string, unknown>> = readStored<Array<Record<string, unknown>>>('video-studio:branches', []);
  const api = {
    listProviders: async () => [],
    providerStatus: async () => [],
    listModels: async () => [],
    createJob: async () => ({ id: randomId('video-job'), status: 'queued', phase: 'local' }),
    cancelJob: async () => true,
    retryJob: async (jobId: string) => ({ id: jobId, status: 'queued', phase: 'local' }),
    getJob: async () => null,
    listJobs: async () => [],
    removeJob: async () => true,
    aiHealth: async () => ({ available: false, providers: [] }),
    aiEntitlement: async () => ({ entitled: false, reason: 'No Android AI provider configured.' }),
    aiPlan: async () => null,
    aiSettingsGet: async () => readStored('video-studio:ai-settings', {}),
    aiSettingsSet: async (settings: unknown) => { writeStored('video-studio:ai-settings', settings); return true; },
    gatewayConfigGet: async () => readStored('video-studio:gateway', {}),
    gatewayConfigSet: async (config: unknown) => { writeStored('video-studio:gateway', config); return true; },
    setCredential: async () => true,
    offlineJobs: async () => [],
    analyzeEditImpact: async () => ({ affectedOperations: [], warnings: [], summary: 'Local Android edit analysis is ready.' }),
    replayEditPlan: async (project: unknown) => ({ project: clone(project) }),
    recordPlan: async (_project: unknown, plan: unknown) => {
      const record = { id: randomId('plan'), plan: clone(plan), createdAt: new Date().toISOString() };
      plans.unshift(record);
      writeStored('video-studio:plans', plans);
      return record;
    },
    listPlans: async () => clone(plans),
    getPlan: async (recordId: string) => clone(plans.find((entry) => typeof entry === 'object' && entry !== null && (entry as { id?: string }).id === recordId) ?? null),
    removePlan: async (recordId: string) => {
      const index = plans.findIndex((entry) => typeof entry === 'object' && entry !== null && (entry as { id?: string }).id === recordId);
      if (index < 0) return false;
      plans.splice(index, 1);
      writeStored('video-studio:plans', plans);
      return true;
    },
    createBranch: async (project: unknown, label: string, parentBranchId?: string) => {
      const record = { id: randomId('branch'), label, parentBranchId: parentBranchId ?? null, project: clone(project), createdAt: new Date().toISOString() };
      branches.unshift(record);
      writeStored('video-studio:branches', branches);
      return record;
    },
    listBranches: async () => clone(branches),
    getBranch: async (branchId: string) => clone(branches.find((entry) => entry.id === branchId) ?? null),
    removeBranch: async (branchId: string) => {
      const index = branches.findIndex((entry) => entry.id === branchId);
      if (index < 0) return false;
      branches.splice(index, 1);
      writeStored('video-studio:branches', branches);
      return true;
    },
    compareBranches: async (leftBranchId: string, rightBranchId: string) => ({ leftBranchId, rightBranchId, comparable: true }),
    onJobPhase: noopSubscription,
    onJobProgress: noopSubscription,
    onJobComplete: noopSubscription,
    onJobFailed: noopSubscription,
    onJobCancelled: noopSubscription,
    onFlushed: noopSubscription,
  };
  window.knouxVideoStudioAPI = api as unknown as Window['knouxVideoStudioAPI'];
}

function installAndroidCoreOverrides(): void {
  const settingsListeners = new Set<(key: string, value: unknown) => void>();
  window.knouxAPI.settings.get = async <T>(key: string, defaultValue?: T) => readStored<T>(`setting:${key}`, defaultValue as T);
  window.knouxAPI.settings.set = async <T>(key: string, value: T) => {
    writeStored(`setting:${key}`, value);
    settingsListeners.forEach((listener) => listener(key, value));
  };
  window.knouxAPI.settings.getAll = async () => ({});
  window.knouxAPI.settings.reset = async (key?: string) => {
    if (key) removeStored(`setting:${key}`);
  };
  window.knouxAPI.settings.export = async () => JSON.stringify({ runtime: 'android', exportedAt: new Date().toISOString() }, null, 2);
  window.knouxAPI.settings.onChange = (callback) => {
    settingsListeners.add(callback);
    return () => settingsListeners.delete(callback);
  };

  window.knouxAPI.system.getInfo = async () => ({
    product: 'KNOUX Player X',
    version: '2.0.0-android',
    platform: 'android',
    arch: 'mobile',
    sha: 'runtime',
    branch: 'main',
    builtAt: new Date().toISOString(),
    packaged: true,
    electronVersion: 'not-applicable',
    chromeVersion: navigator.userAgent,
    nodeVersion: 'not-applicable',
  });
  window.knouxAPI.system.getBuildInfo = async () => ({
    product: 'KNOUX Player X',
    version: '2.0.0-android',
    sha: 'runtime',
    branch: 'main',
    builtAt: new Date().toISOString(),
    packaged: true,
    electronVersion: 'not-applicable',
  });

  window.knouxCreativeAPI.media.open = async () => {
    const files = await pickFiles('video/*,audio/*');
    const file = files[0];
    if (!file) return null;
    const filePath = rememberFile(file);
    return { filePath, mediaUrl: fileUrl(filePath) };
  };
  window.knouxCreativeAPI.media.toUrl = async (filePath: string) => fileUrl(filePath);
}

function installRecordingSelectorBridge(): void {
  const api = {
    selectRegion: async () => null,
    completeRegionSelection: async () => false,
    cancelRegionSelection: async () => false,
  };
  window.knouxRecordingAPI = api as unknown as Window['knouxRecordingAPI'];
}

export function installAndroidRuntimeBridge(): boolean {
  if (!isAndroidNativeRuntime()) return false;

  // Reuse the complete safe base namespaces, then promote them into a native Android contract.
  installBrowserPreviewBridge();
  window.knouxRuntime = Object.freeze({
    edition: 'android',
    product: 'KNOUX Player X',
    bridgeVersion: 2,
  });
  document.documentElement.dataset.runtime = 'android';
  document.documentElement.dataset.platform = 'android';

  installAndroidCoreOverrides();
  installAndroidRecordingBridge();
  installRecordingSelectorBridge();
  installMultitrackBridge();
  installSlideshowBridge();
  installAudioToolsBridge();
  installImageStudioBridge();
  installVideoStudioBridge();

  return true;
}
