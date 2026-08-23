import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { emptyEntitlement } from '../../src/core/image-studio/ai/entitlement';
import { AiGateway, buildGatewayRequest } from '../ai-gateway/orchestrator';
import type { ResultFinalizer } from '../ai-gateway/orchestrator';
import { createHttpClient } from '../ai-gateway/http-client';
import type { HttpClient } from '../ai-gateway/http-client';
import { FalAdapter } from '../ai-gateway/fal-adapter';
import { HfAdapter } from '../ai-gateway/hf-adapter';
import { KnouxCloudAdapter } from '../ai-gateway/knoux-adapter';
import { adjustmentKinds, applyAdjustment } from '../../src/core/image-studio/adjustments/adjustments';
import {
  findImageModel,
  IMAGE_MODELS,
  modelsForTask,
  PROVIDERS,
} from '../../src/core/image-studio/ai/catalog';
import type { ImageProviderId } from '../../src/core/image-studio/ai/catalog';
import {
  ConsentManager,
  ImageStudioCredentialManager,
  MemoryConsentStore,
  MemorySecretVault,
  validateApiKey,
} from '../../src/core/image-studio/ai/credentials';
import type {
  ConsentScope,
  ConsentStore,
  KeyValidationResult,
  ProviderCredentialStatus,
  SecretCipher,
  SecretVault,
} from '../../src/core/image-studio/ai/credentials';
import {
  addGeneratedLayer,
  createGeneratedAILayer,
  registerProvenance,
  setProvenanceAccepted,
} from '../../src/core/image-studio/ai/generation';
import { OfflineFirstQueue } from '../../src/core/image-studio/ai/offline';
import type {
  AiJobStore,
  ConnectivityState,
  DeferredAiJob,
  OfflineConnectivityAdapter,
} from '../../src/core/image-studio/ai/offline';
import {
  addEmbeddedAsset,
  addLayer,
  createEmbeddedAsset,
  createImageStudioDocument,
  createRasterLayer,
  migrateLegacyFlatImage,
} from '../../src/core/image-studio/document/document';
import {
  IMAGE_STUDIO_LIMITS,
} from '../../src/core/image-studio/document/schema';
import type {
  AIImageProvenance,
  ImageLayer,
  ImageStudioDocument,
  ImageTask,
  LayerMask,
  RetouchOperationRecord,
  RetouchMaskRecord,
} from '../../src/core/image-studio/document/schema';
import {
  dataUrlOf,
  encodeBmp,
  encodePng,
  encodeSvg,
  exportBuffer,
  planExport,
} from '../../src/core/image-studio/export/export';
import type { ExportOptions, ExportPlan, RasterEncoder } from '../../src/core/image-studio/export/export';
import {
  detectForeignFormat,
  importForeignImage,
  importNativeDocument,
} from '../../src/core/image-studio/import/import';
import type { ImageDecoder } from '../../src/core/image-studio/import/import';
import { blendModeExists } from '../../src/core/image-studio/layers/blendModes';
import {
  duplicateLayer,
  groupLayers,
  reorderLayer,
  ungroup,
  validateLayerTree,
} from '../../src/core/image-studio/layers/layerTree';
import {
  clearRecoveryRecord,
  deserializeDocument,
  findRecoverableDocuments,
  ImageStudioAutosaveController,
  openDocument,
  readRecoveryIndex,
  saveDocument,
  writeRecoveryRecord,
} from '../../src/core/image-studio/persistence/storage';
import type {
  HashFunction,
  StorageAdapter,
} from '../../src/core/image-studio/persistence/storage';
import {
  flattenDocument,
} from '../../src/core/image-studio/raster/compositor';
import type { RgbaBuffer } from '../../src/core/image-studio/raster/compositor';
import { migrateToCurrent } from '../../src/core/image-studio/system/migrations';
import {
  renderRetouchPipeline,
} from '../../src/features/image-editor/retouch/retouchEngine';
import type {
  RetouchOperation,
} from '../../src/features/image-editor/retouch/retouchEngine';
import {
  documentRetouchOpToEngineOp,
  documentMasksToEngineMasks,
  applyRetouchToBuffer,
} from '../../src/features/image-studio/retouch/retouchPreviewBridge';

const AUTOSAVE_INTERVAL_MS = 60_000;
const MAX_RECENT_PROJECTS = 20;
const MAX_UNDO_SNAPSHOTS = 100;
const MAX_JOB_PROMPT_LENGTH = 10_000;
const MOCK_OUTPUT_MAX_DIMENSION = 512;
const EXPORT_FORMATS = ['png', 'jpeg', 'webp', 'bmp', 'svg'] as const;

export type CredentialStorageMode = 'encrypted-at-rest' | 'session-only';

export interface ImageStudioServiceEvents {
  autosave(filePath: string): void;
  jobProgress(job: DeferredAiJob): void;
  jobComplete(jobId: string, provenance: AIImageProvenance): void;
  jobFailed(jobId: string, error: string): void;
  recoveryAvailable(session: RecoverySession): void;
}

export interface RecoverySession {
  documentId: string;
  autosavePath: string;
  savedAt: string;
  reason: 'crash' | 'manual' | 'shutdown';
}

export interface StringListStore {
  load(): string[];
  save(items: string[]): void;
}

export interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface JobRecord {
  job: DeferredAiJob;
  status: JobStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outputDataUrl: string | null;
  provenanceId: string | null;
}

export interface ImageStudioJobStore extends AiJobStore {
  loadHistory(): JobRecord[];
  saveHistory(records: JobRecord[]): void;
}

export interface ImageStudioServiceOptions {
  userDataDir: string;
  autosaveDir: string;
  recoveryIndexPath: string;
  applicationVersion?: string;
  events: ImageStudioServiceEvents;
  adapter?: StorageAdapter;
  hash?: HashFunction;
  recents?: StringListStore;
  vault?: SecretVault;
  consentStore?: ConsentStore;
  credentialStorageMode?: CredentialStorageMode;
  jobsStore?: ImageStudioJobStore;
  autosaveIntervalMs?: number;
  connectivity?: OfflineConnectivityAdapter;
  maxQueueSize?: number;
  /** HTTP client for the AI gateway (injectable for tests). */
  http?: HttpClient;
  /** KNOUX Cloud gateway base URL; empty disables KNOUX Cloud jobs. */
  gatewayBaseUrl?: string;
  /** Static session token or resolver for KNOUX Cloud. */
  gatewaySessionToken?: string | (() => Promise<string | null>);
}

interface HistorySnapshot {
  kind: 'edit' | 'checkpoint';
  document: ImageStudioDocument;
}

interface ExportRender {
  bytes: Uint8Array;
  plan: ExportPlan;
  width: number;
  height: number;
  mime: string;
  extension: string;
}

export function sha256Hash(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

export function createFsStorageAdapter(): StorageAdapter {
  return {
    async readText(target) {
      return fs.readFile(target, 'utf8');
    },
    async writeText(target, content) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    },
    async exists(target) {
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }
    },
    async stat(target) {
      const stats = await fs.stat(target);
      return { modifiedAt: stats.mtime.toISOString() };
    },
    async mkdirp(target) {
      await fs.mkdir(target, { recursive: true });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertAbsolutePath(filePath: string, label: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || filePath.includes('\u0000')) {
    throw new TypeError(`${label} is invalid.`);
  }
  if (!path.isAbsolute(filePath)) throw new TypeError(`${label} must be an absolute path.`);
  return path.normalize(filePath);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) throw new RangeError('Value must be finite.');
  return Math.min(Math.max(rounded, minimum), maximum);
}

function deterministicPrng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** Shared in-memory cipher used when safeStorage is unavailable. */
export function createMemoryCipher(): SecretCipher & { sessionOnly: boolean } {
  const enc = new Map<string, string>();
  return {
    sessionOnly: true,
    async encrypt(plaintext) {
      const token = randomUUID();
      const ciphertext = `mem:${token}`;
      enc.set(ciphertext, plaintext);
      return ciphertext;
    },
    async decrypt(ciphertext) {
      const plaintext = enc.get(ciphertext);
      if (plaintext === undefined) throw new Error('Session credential is unavailable.');
      return plaintext;
    },
  };
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9+.-]+;base64,/.test(value);
}

async function decodeDataUrl(dataUrl: string): Promise<RgbaBuffer> {
  if (!isDataUrl(dataUrl)) throw new TypeError('Embedded asset is not a data URL.');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Buffer.from(base64, 'base64');
  const { data, info } = await sharp(bytes)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

const sharpDecoder: ImageDecoder = {
  async decode(bytes, mime) {
    const { data, info } = await sharp(Buffer.from(bytes))
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      mime,
      buffer: { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
    };
  },
};

/** Re-encode a remote result to PNG with real measured dimensions. */
const sharpResultFinalizer: ResultFinalizer = {
  async finalize(bytes, mime) {
    const image = await sharpDecoder.decode(bytes, mime);
    return {
      dataUrl: dataUrlOf(encodePng(image.buffer), 'image/png'),
      width: image.width,
      height: image.height,
    };
  },
};

/**
 * Normalize a static or resolver-style KNOUX Cloud session token into a
 * resolver, with an explicit narrowing helper for TypeScript.
 */
function gatewaySessionTokenOf(
  value: string | (() => Promise<string | null>) | undefined
): () => Promise<string | null> {
  if (typeof value === 'function') return value;
  return () => Promise.resolve(value ?? null);
}

/**
 * Build the real AI gateway for this build: Hugging Face and fal.ai run
 * through their committed adapters; KNOUX Cloud runs only when a gateway
 * base URL and session token are configured, otherwise it is honestly
 * reported as unconfigured by the orchestrator.
 */
function createGateway(options: {
  credentials: ImageStudioCredentialManager;
  http: HttpClient;
  gatewayBaseUrl: string;
  gatewaySessionToken: () => Promise<string | null>;
}): AiGateway {
  const knouxAdapter = new KnouxCloudAdapter({
    gatewayBaseUrl: () => options.gatewayBaseUrl,
    sessionToken: options.gatewaySessionToken,
    http: options.http,
  });
  return new AiGateway({
    adapters: {
      huggingface: new HfAdapter({
        apiKey: () => options.credentials.resolveKey('huggingface').catch(() => null),
        http: options.http,
      }),
      fal: new FalAdapter({
        apiKey: () => options.credentials.resolveKey('fal').catch(() => null),
        http: options.http,
      }),
      'knoux-cloud': knouxAdapter,
      openrouter: undefined,
      local: undefined,
      mock: undefined,
    },
    getCredential: (provider) => options.credentials.resolveKey(provider).catch(() => null),
    getEntitlement: async () => {
      try {
        return await knouxAdapter.fetchEntitlement();
      } catch {
        return emptyEntitlement();
      }
    },
    finalizer: sharpResultFinalizer,
  });
}

const sharpRasterEncoder: RasterEncoder = {
  async encode(buffer, plan) {
    switch (plan.format) {
      case 'png':
        return encodePng(buffer);
      case 'bmp':
        return encodeBmp(buffer);
      case 'svg':
        return encodeSvg(buffer, plan);
      case 'jpeg': {
        const quality = Math.round((plan.quality ?? 0.9) * 100);
        const bytes = await sharp(buffer.data, {
          raw: { width: buffer.width, height: buffer.height, channels: 4 },
        })
          .jpeg({ quality })
          .toBuffer();
        return new Uint8Array(bytes);
      }
      case 'webp': {
        const quality = Math.round((plan.quality ?? 0.9) * 100);
        const bytes = await sharp(buffer.data, {
          raw: { width: buffer.width, height: buffer.height, channels: 4 },
        })
          .webp({ quality })
          .toBuffer();
        return new Uint8Array(bytes);
      }
      default:
        throw new TypeError(`Unsupported export format "${plan.format}".`);
    }
  },
};

export class ImageStudioService {
  private readonly userDataDir: string;
  private readonly autosaveDir: string;
  private readonly recoveryIndexPath: string;
  private readonly applicationVersion: string;
  private readonly events: ImageStudioServiceEvents;
  private readonly adapter: StorageAdapter;
  private readonly hash: HashFunction;
  private readonly recents: StringListStore;
  private readonly credentialStorageMode: CredentialStorageMode;
  private readonly jobsStore: ImageStudioJobStore;
  private readonly autosaveController: ImageStudioAutosaveController;
  private readonly queue: OfflineFirstQueue;
  private readonly credentials: ImageStudioCredentialManager;
  private readonly connectivity: OfflineConnectivityAdapter;
  private readonly maxQueueSize: number;

  private current: ImageStudioDocument | null = null;
  private currentPath: string | null = null;
  private dirty = false;
  private closed = false;
  private readonly undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private readonly jobHistory = new Map<string, JobRecord>();
  private runningJobs = new Set<string>();
  private readonly gateway: AiGateway;
  private readonly gatewayConfigured: boolean;

  constructor(options: ImageStudioServiceOptions) {
    this.userDataDir = assertAbsolutePath(options.userDataDir, 'Image Studio data directory');
    this.autosaveDir = assertAbsolutePath(options.autosaveDir, 'Image Studio autosave directory');
    this.recoveryIndexPath = assertAbsolutePath(options.recoveryIndexPath, 'Image Studio recovery index');
    this.applicationVersion = options.applicationVersion ?? '';
    this.events = options.events;
    this.adapter = options.adapter ?? createFsStorageAdapter();
    this.hash = options.hash ?? sha256Hash;
    this.recents = options.recents ?? this.defaultRecents();
    this.credentialStorageMode = options.credentialStorageMode ?? 'encrypted-at-rest';
    this.jobsStore = options.jobsStore ?? this.defaultJobsStore();
    this.connectivity = options.connectivity ?? { isOnline: async () => false };
    this.maxQueueSize = options.maxQueueSize ?? 50;
    this.gatewayConfigured = Boolean(options.gatewayBaseUrl) && Boolean(gatewaySessionTokenOf(options.gatewaySessionToken));

    const consentStore = options.consentStore ?? new MemoryConsentStore();
    const consent = new ConsentManager(consentStore);
    const vault = options.vault ?? new MemorySecretVault(createMemoryCipher());
    this.credentials = new ImageStudioCredentialManager(vault, consent);
    this.gateway = createGateway({
      credentials: this.credentials,
      http: options.http ?? createHttpClient(),
      gatewayBaseUrl: options.gatewayBaseUrl ?? '',
      gatewaySessionToken: gatewaySessionTokenOf(options.gatewaySessionToken),
    });

    this.autosaveController = new ImageStudioAutosaveController({
      adapter: this.adapter,
      hash: this.hash,
      intervalMs: options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS,
      onError: (error) => {
        this.events.jobFailed('autosave', error.message);
      },
    });

    this.queue = new OfflineFirstQueue({
      store: this.jobsStore,
      connectivity: this.connectivity,
      maxQueueSize: this.maxQueueSize,
      onJobScheduled: (job) => this.events.jobProgress(job),
      onJobDiscarded: (jobId, reason) => {
        const record = this.jobHistory.get(jobId);
        if (record) {
          record.status = 'failed';
          record.error = `Job was discarded: ${reason}`;
          record.finishedAt = new Date().toISOString();
        }
        this.events.jobFailed(jobId, `Job was discarded: ${reason}`);
      },
      onFlushed: (jobIds) => {
        for (const jobId of jobIds) {
          const record = this.jobHistory.get(jobId);
          if (!record) continue;
          const queued = this.queue.queuedJobs().find((entry) => entry.jobId === jobId);
          if (queued) this.events.jobProgress(queued);
          if (this.runningJobs.has(jobId)) continue;
          const job = this.jobHistory.get(jobId)?.job ?? queued;
          if (job) void this.executeJob(job).catch(() => undefined);
        }
      },
    });
  }

  async initialize(): Promise<void> {
    await this.adapter.mkdirp(this.userDataDir);
    await this.adapter.mkdirp(this.autosaveDir);
    await this.queue.initialize();
    this.queue.startAutoRecheck();
    for (const record of this.jobsStore.loadHistory()) this.jobHistory.set(record.job.jobId, record);
    this.autosaveController.start();
    const sessions = await this.recoverySessions();
    for (const session of sessions) this.events.recoveryAvailable(session);
    await this.refresh();
  }

  async refresh(): Promise<ConnectivityState> {
    return this.queue.refresh();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Document lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  create(request: {
    title?: string;
    width?: number;
    height?: number;
    backgroundMode?: string;
    backgroundColor?: string;
    applicationVersion?: string;
  }): ImageStudioDocument {
    const document = createImageStudioDocument({
      title: request.title,
      width: request.width,
      height: request.height,
      backgroundMode: request.backgroundMode as ImageStudioDocument['canvas']['backgroundMode'] | undefined,
      backgroundColor: request.backgroundColor,
      applicationVersion: this.applicationVersion,
    });
    this.current = document;
    this.currentPath = null;
    this.dirty = false;
    this.resetHistory();
    return document;
  }

  async open(filePath: string): Promise<ImageStudioDocument> {
    const target = assertAbsolutePath(filePath, 'Image Studio project path');
    if (!(await this.adapter.exists(target))) throw new Error('Image Studio file does not exist.');
    const content = await this.adapter.readText(target);
    let document: ImageStudioDocument;
    try {
      const result = await importNativeDocument(content, {
        hash: this.hash,
        applicationVersion: this.applicationVersion,
      });
      document = result.document;
    } catch (nativeError) {
      let payload: unknown;
      try {
        payload = JSON.parse(content);
      } catch {
        throw nativeError;
      }
      try {
        document = migrateLegacyFlatImage(legacyPayloadOf(payload));
      } catch {
        throw nativeError;
      }
    }
    this.current = document;
    this.currentPath = target;
    this.dirty = false;
    this.resetHistory();
    this.pushRecent(target);
    return document;
  }

  async save(target: string | null): Promise<{ path: string | null; at: string | null }> {
    const document = this.requireCurrent();
    const resolved = target ?? this.currentPath;
    if (!resolved) return { path: null, at: null };
    const savedPath = assertAbsolutePath(resolved, 'Image Studio save path');
    const at = await saveDocument(document, savedPath, {
      adapter: this.adapter,
      hash: this.hash,
      applicationVersion: this.applicationVersion,
    });
    this.current = { ...document, recovery: { ...document.recovery, lastSavedAt: at } };
    this.currentPath = savedPath;
    this.dirty = false;
    this.pushRecent(savedPath);
    return { path: savedPath, at };
  }

  saveAs(filePath: string): Promise<{ path: string; at: string }> {
    const target = assertAbsolutePath(filePath, 'Image Studio save path');
    return this.save(target).then((result) => {
      if (!result.path || !result.at) throw new Error('Image Studio save failed.');
      return { path: result.path, at: result.at };
    });
  }

  getCurrent(): ImageStudioDocument | null {
    return this.current ? structuredClone(this.current) : null;
  }

  currentPathHint(): string | null {
    return this.currentPath;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  recent(): string[] {
    return this.recents.load().slice(0, MAX_RECENT_PROJECTS);
  }

  async validateFile(filePath: string): Promise<object> {
    const target = assertAbsolutePath(filePath, 'Image Studio project path');
    if (!(await this.adapter.exists(target))) return { ok: false, errors: ['File does not exist.'] };
    const content = await this.adapter.readText(target);
    const warnings: string[] = [];
    try {
      const result = await deserializeDocument(content, {
        hash: this.hash,
        applicationVersion: this.applicationVersion,
        onIntegrityWarning: (message) => warnings.push(message),
      });
      return {
        ok: result.integrity && Object.values(result.assetIntegrity).every(Boolean),
        schema: 'knoux-image-studio',
        schemaVersion: result.document.schemaVersion,
        documentId: result.document.documentId,
        title: result.document.title,
        integrity: result.integrity,
        assetIntegrity: result.assetIntegrity,
        warnings,
      };
    } catch (error) {
      return {
        ok: false,
        schema: 'unknown',
        errors: [error instanceof Error ? error.message : 'Validation failed.'],
      };
    }
  }

  async migrateFile(filePath: string): Promise<object> {
    const target = assertAbsolutePath(filePath, 'Image Studio project path');
    if (!(await this.adapter.exists(target))) throw new Error('Image Studio file does not exist.');
    const content = await this.adapter.readText(target);
    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch (error) {
      throw new Error(`Image Studio file is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`);
    }
    let document: ImageStudioDocument;
    try {
      const migrated = migrateToCurrent(payload);
      document = migrated;
    } catch {
      try {
        document = migrateLegacyFlatImage(legacyPayloadOf(payload));
      } catch {
        throw new Error('Payload is neither a current Image Studio document nor a legacy flat image.');
      }
    }
    return {
      document,
      documentId: document.documentId,
      title: document.title,
      appliedMigrations: document.migrationHistory,
    };
  }

  async recoverFile(filePath: string): Promise<object> {
    const target = assertAbsolutePath(filePath, 'Image Studio project path');
    const sessions = await this.recoverySessions(target);
    const session = sessions.find((entry) => entry.autosavePath === this.autosavePathFor(target));
    if (!session) {
      return { restored: false, recoveryPath: null, document: this.current };
    }
    const restored = await this.restoreRecovery(session.autosavePath);
    return { restored: true, ...restored };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Layer operations
  // ═══════════════════════════════════════════════════════════════════════════

  createLayer(layer: ImageLayer): ImageStudioDocument {
    return this.mutate((document) => addLayer(document, layer));
  }

  deleteLayer(layerId: string): boolean {
    this.requireLayer(layerId);
    this.mutate((document) => ({
      ...document,
      layers: removeLayerSafe(document.layers, layerId),
      activeLayerId: document.activeLayerId === layerId ? null : document.activeLayerId,
    }));
    return true;
  }

  duplicateLayerOp(layerId: string): ImageStudioDocument {
    this.requireLayer(layerId);
    return this.mutate((document) => ({
      ...document,
      layers: duplicateLayer(document.layers, layerId, `layer-${randomUUID()}`),
    }));
  }

  renameLayer(layerId: string, name: string): boolean {
    const value = typeof name === 'string' ? name.normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax) : '';
    if (value.length === 0) throw new TypeError('Layer name must not be empty.');
    this.requireLayer(layerId);
    this.mutate((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, name: value, updatedAt: new Date().toISOString() } : entry
      ),
    }));
    return true;
  }

  reorderLayersOp(layerIds: string[]): boolean {
    if (!Array.isArray(layerIds) || layerIds.length === 0) throw new TypeError('Layer order is invalid.');
    const document = this.requireCurrent();
    if (layerIds.length !== document.layers.length) throw new RangeError('Layer order must include every layer.');
    const present = new Set(document.layers.map((layer) => layer.id));
    for (const layerId of layerIds) {
      if (typeof layerId !== 'string' || !present.has(layerId)) throw new TypeError('Layer order references an unknown layer.');
    }
    this.mutate((doc) => {
      let next = doc.layers;
      layerIds.forEach((layerId, index) => {
        next = reorderLayer(next, layerId, index);
      });
      return { ...doc, layers: next };
    });
    return true;
  }

  groupLayersOp(layerIds: string[], groupName?: string): ImageStudioDocument {
    if (!Array.isArray(layerIds) || layerIds.length < 2) {
      throw new RangeError('Grouping requires at least two layers.');
    }
    return this.mutate((document) => {
      const groupId = `layer-${randomUUID()}`;
      let next = groupLayers(document.layers, layerIds, groupId);
      if (groupName && typeof groupName === 'string') {
        const name = groupName.normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax);
        if (name.length > 0) {
          next = next.map((entry) =>
            entry.id === groupId ? { ...entry, name } : entry
          );
        }
      }
      return { ...document, layers: next, activeLayerId: groupId };
    });
  }

  ungroupLayersOp(groupId: string): boolean {
    this.requireLayer(groupId);
    this.mutate((document) => ({ ...document, layers: ungroup(document.layers, groupId) }));
    return true;
  }

  setVisibility(layerId: string, visible: boolean): boolean {
    this.requireLayer(layerId);
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, visible: Boolean(visible), updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  setLocked(layerId: string, locked: boolean): boolean {
    this.requireLayer(layerId);
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, locked: Boolean(locked), updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  setOpacity(layerId: string, opacity: number): boolean {
    this.requireLayer(layerId);
    if (!Number.isFinite(opacity) || opacity < IMAGE_STUDIO_LIMITS.opacityMin || opacity > IMAGE_STUDIO_LIMITS.opacityMax) {
      throw new RangeError('Layer opacity must be between 0 and 1.');
    }
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, opacity, updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  setBlendMode(layerId: string, blendMode: string): boolean {
    this.requireLayer(layerId);
    if (!blendModeExists(blendMode)) throw new TypeError('Unsupported layer blend mode.');
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, blendMode, updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  setTransform(layerId: string, transform: ImageLayer['transform']): boolean {
    this.requireLayer(layerId);
    if (!isRecord(transform)) throw new TypeError('Layer transform is invalid.');
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      if (typeof transform[key] !== 'number' || !Number.isFinite(transform[key]) || Math.abs(transform[key]) > 1e6) {
        throw new TypeError('Layer transform contains an invalid value.');
      }
    }
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, transform: { ...transform }, updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  addMask(layerId: string, mask: LayerMask): boolean {
    this.requireLayer(layerId);
    if (!isRecord(mask) || typeof mask.assetId !== 'string') throw new TypeError('Layer mask is invalid.');
    const document = this.requireCurrent();
    if (!document.embeddedAssets.some((asset) => asset.id === mask.assetId)) {
      throw new Error('Layer mask references a missing embedded asset.');
    }
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, mask: normalizeMask(mask), updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  updateMask(layerId: string, patch: Partial<LayerMask>): boolean {
    const layer = this.requireLayer(layerId);
    const existing = layer.mask;
    if (!existing) throw new Error('Layer has no mask to update.');
    if (!isRecord(patch)) throw new TypeError('Layer mask patch is invalid.');
    if (patch.assetId !== undefined && typeof patch.assetId !== 'string') throw new TypeError('Layer mask asset ID is invalid.');
    return this.mutateBoolean((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, mask: normalizeMask({ ...existing, ...patch }), updatedAt: new Date().toISOString() } : entry
      ),
    }));
  }

  removeMask(layerId: string): boolean {
    const layer = this.requireLayer(layerId);
    if (!layer.mask) return false;
    this.mutate((document) => ({
      ...document,
      layers: document.layers.map((entry) =>
        entry.id === layerId ? { ...entry, mask: null, updatedAt: new Date().toISOString() } : entry
      ),
    }));
    return true;
  }

  async applyAdjustmentOp(layerId: string, adjustmentType: string, parameters: object): Promise<boolean> {
    const layer = this.requireLayer(layerId);
    if (layer.kind !== 'raster') throw new TypeError('Adjustments can only be applied to raster layers.');
    const kinds = adjustmentKinds();
    if (!kinds.includes(adjustmentType as never)) throw new TypeError('Unsupported adjustment type.');
    if (parameters !== undefined && !isRecord(parameters)) throw new TypeError('Adjustment parameters are invalid.');
    const document = this.requireCurrent();
    const asset = document.embeddedAssets.find((entry) => entry.id === layer.assetId);
    if (!asset) throw new Error('Raster layer references a missing embedded asset.');
    const buffer = await decodeDataUrl(asset.dataUrl);
    const adjustedBuffer = applyAdjustment(adjustmentType as never, buffer, parameters as Record<string, unknown>);
    this.mutate((doc) => {
      const { layer: newLayer, asset: newAsset } = createRasterLayer(doc, {
        id: layer.id,
        name: layer.name,
        assetId: layer.assetId,
        dataUrl: dataUrlOf(encodePng(adjustedBuffer), 'image/png'),
        width: adjustedBuffer.width,
        height: adjustedBuffer.height,
        mime: 'image/png',
        parentId: layer.parentId,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
      });
      doc.embeddedAssets = doc.embeddedAssets.map((entry) =>
        entry.id === layer.assetId ? newAsset : entry
      );
      doc.layers = doc.layers.map((entry) =>
        entry.id === layer.id ? newLayer : entry
      );
      if (doc.activeLayerId === layer.id) doc.activeLayerId = newLayer.id;
      return doc;
    });
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // History
  // ═══════════════════════════════════════════════════════════════════════════

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot || snapshot.kind === 'checkpoint') {
      if (snapshot) this.undoStack.push(snapshot);
      return false;
    }
    const current = this.requireCurrent();
    this.redoStack.push({ kind: 'edit', document: structuredClone(current) });
    this.current = snapshot.document;
    this.dirty = true;
    return true;
  }

  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    const current = this.requireCurrent();
    this.undoStack.push({ kind: 'edit', document: structuredClone(current) });
    this.current = snapshot.document;
    this.dirty = true;
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.some((snapshot) => snapshot.kind === 'edit');
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  createCheckpoint(): boolean {
    const document = this.requireCurrent();
    this.undoStack.push({ kind: 'checkpoint', document: structuredClone(document) });
    if (this.undoStack.length > MAX_UNDO_SNAPSHOTS) this.undoStack.shift();
    this.redoStack = [];
    const now = new Date().toISOString();
    this.current = {
      ...document,
      historyCheckpoint: {
        checkpointId: `checkpoint-${randomUUID()}`,
        operationCount: this.undoStack.length,
        createdAt: now,
        memoryLimit: 200,
      },
      updatedAt: now,
    };
    this.dirty = true;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Import
  // ═══════════════════════════════════════════════════════════════════════════

  async importImage(filePath: string): Promise<ImageStudioDocument> {
    const target = assertAbsolutePath(filePath, 'Image file path');
    const bytes = new Uint8Array(await fs.readFile(target));
    const result = await importForeignImage(bytes, {
      decoder: sharpDecoder,
      title: path.basename(target, path.extname(target)),
      applicationVersion: this.applicationVersion,
    });
    if (result.warnings.length > 0 && result.document.layers.length === 0) {
      throw new Error(result.warnings.join(' '));
    }
    this.current = result.document;
    this.currentPath = null;
    this.dirty = false;
    this.resetHistory();
    return result.document;
  }

  async importAsLayer(filePath: string): Promise<ImageStudioDocument> {
    const target = assertAbsolutePath(filePath, 'Image file path');
    const bytes = new Uint8Array(await fs.readFile(target));
    const format = detectForeignFormat(bytes);
    if (format === 'unknown') throw new Error('Unsupported image format.');
    const image = await sharpDecoder.decode(bytes, 'image/png');
    return this.mutate((document) => {
      const { layer, asset } = createRasterLayer(document, {
        name: path.basename(target, path.extname(target)),
        dataUrl: dataUrlOf(encodePng(image.buffer), 'image/png'),
        width: image.width,
        height: image.height,
      });
      const withAsset = addEmbeddedAsset(document, {
        id: asset.id,
        dataUrl: asset.dataUrl,
        mime: 'image/png',
        width: asset.width,
        height: asset.height,
      });
      const withLayer = addLayer(withAsset.document, layer);
      return { ...withLayer, activeLayerId: layer.id };
    });
  }

  async inspectFormat(filePath: string): Promise<object> {
    const target = assertAbsolutePath(filePath, 'Image file path');
    if (!(await this.adapter.exists(target))) return { exists: false };
    const bytes = new Uint8Array(await fs.readFile(target));
    const format = detectForeignFormat(bytes);
    if (format === 'unknown') return { exists: true, format: 'unknown', supported: false };
    const image = await sharpDecoder.decode(bytes, 'image/png');
    return {
      exists: true,
      format,
      supported: true,
      width: image.width,
      height: image.height,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════════════════

  async resolveExportPlan(plan?: ExportPlan): Promise<ExportPlan> {
    const document = this.requireCurrent();
    if (plan === undefined) {
      return planExport({ width: document.canvas.width, height: document.canvas.height }, { format: 'png' });
    }
    if (!isRecord(plan) || !EXPORT_FORMATS.includes(plan.format as never)) {
      throw new TypeError('Export format is unsupported.');
    }
    return planExport({ width: document.canvas.width, height: document.canvas.height }, exportOptionsOf(plan));
  }

  async renderPlan(plan: ExportPlan): Promise<ExportRender> {
    const document = this.requireCurrent();
    const flattened = await this.flatten(document);
    const rendered = await exportBuffer(flattened, exportOptionsOf(plan), sharpRasterEncoder);
    return {
      bytes: rendered.bytes,
      plan: rendered.plan,
      width: rendered.plan.width,
      height: rendered.plan.height,
      mime: rendered.mime,
      extension: rendered.extension,
    };
  }

  async renderLayerPlan(layerId: string, plan: ExportPlan): Promise<ExportRender> {
    const document = this.requireCurrent();
    const layer = this.requireLayer(layerId);
    const layerDoc: ImageStudioDocument = {
      ...document,
      canvas: { ...document.canvas, backgroundMode: 'transparent' },
      layers: [layer],
    };
    const flattened = await this.flatten(layerDoc);
    const rendered = await exportBuffer(flattened, exportOptionsOf(plan), sharpRasterEncoder);
    return {
      bytes: rendered.bytes,
      plan: rendered.plan,
      width: rendered.plan.width,
      height: rendered.plan.height,
      mime: rendered.mime,
      extension: rendered.extension,
    };
  }

  async writeExport(filePath: string, bytes: Uint8Array): Promise<void> {
    const target = assertAbsolutePath(filePath, 'Export destination path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async validateExport(filePath: string, plan: ExportPlan): Promise<{ ok: boolean; warnings: string[] }> {
    const target = assertAbsolutePath(filePath, 'Export destination path');
    const warnings: string[] = [];
    if (!(await this.adapter.exists(target))) {
      return { ok: false, warnings: ['Export file does not exist.'] };
    }
    const metadata = await sharp(target).metadata();
    if (metadata.width !== plan.width || metadata.height !== plan.height) {
      warnings.push(`Exported dimensions (${metadata.width}x${metadata.height}) do not match the plan (${plan.width}x${plan.height}).`);
    }
    if (metadata.format && metadata.format !== plan.format) {
      warnings.push(`Exported format (${metadata.format}) does not match the plan (${plan.format}).`);
    }
    return { ok: warnings.length === 0, warnings };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Autosave & recovery
  // ═══════════════════════════════════════════════════════════════════════════

  autosaveStatus(filePath?: string): object {
    const document = this.current;
    const target = filePath === undefined ? this.currentPath : assertAbsolutePath(filePath, 'Image Studio project path');
    return {
      dirty: this.dirty,
      hasDocument: document !== null,
      documentId: document?.documentId ?? null,
      currentPath: this.currentPath,
      requestedPath: target,
      lastSavedAt: document?.recovery.lastSavedAt ?? null,
      autosaveAt: document?.recovery.autosaveAt ?? null,
      autosavePath: document?.recovery.autosavePath ?? null,
    };
  }

  async triggerAutosave(filePath?: string): Promise<string> {
    const document = this.requireCurrent();
    const autosavePath =
      filePath === undefined
        ? path.join(this.autosaveDir, `knoux-image-studio.autosave-${document.documentId}.json`)
        : this.autosavePathFor(assertAbsolutePath(filePath, 'Image Studio project path'));
    await this.performAutosave(document, autosavePath);
    return autosavePath;
  }

  async recoverySessions(filePath?: string): Promise<RecoverySession[]> {
    const records = await findRecoverableDocuments({
      adapter: this.adapter,
      hash: this.hash,
      indexPath: this.recoveryIndexPath,
    });
    const requested = filePath === undefined ? null : assertAbsolutePath(filePath, 'Image Studio project path');
    return records
      .filter((record) => requested === null || record.autosavePath === this.autosavePathFor(requested))
      .map((record) => ({
        documentId: record.documentId,
        autosavePath: record.autosavePath,
        savedAt: record.savedAt,
        reason: record.reason,
      }));
  }

  async restoreRecovery(recoveryPath: string): Promise<object> {
    const target = this.assertAutosavePath(recoveryPath);
    const result = await openDocument(target, {
      adapter: this.adapter,
      hash: this.hash,
      applicationVersion: this.applicationVersion,
    });
    result.document.recovery.crashRecovered = true;
    this.current = result.document;
    this.currentPath = null;
    this.dirty = true;
    this.resetHistory();
    return {
      document: result.document,
      documentId: result.document.documentId,
      recoveryPath: target,
      integrity: result.integrity,
      restoredAt: new Date().toISOString(),
    };
  }

  async discardRecovery(recoveryPath: string): Promise<boolean> {
    const target = this.assertAutosavePath(recoveryPath);
    const index = await readRecoveryIndex({ adapter: this.adapter, hash: this.hash, indexPath: this.recoveryIndexPath });
    const record = index.find((entry) => entry.autosavePath === target);
    if (record) {
      await clearRecoveryRecord(record.documentId, {
        adapter: this.adapter,
        hash: this.hash,
        indexPath: this.recoveryIndexPath,
      });
    }
    await fs.rm(target, { force: true });
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI providers, credentials and jobs
  // ═══════════════════════════════════════════════════════════════════════════

  listProviders(): object[] {
    return Object.values(PROVIDERS).map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      requiresKey: provider.requiresKey,
      freeTier: provider.freeTier,
      keyDescription: provider.keyDescription,
      wired: provider.wired,
    }));
  }

  async providerStatus(): Promise<object> {
    const statuses: Record<string, unknown> = {};
    for (const provider of Object.values(PROVIDERS)) {
      const status = await this.credentials.status(provider.id);
      statuses[provider.id] = {
        ...status,
        storageMode: this.credentialStorageMode,
        keyDescription: provider.keyDescription,
        gatewayConfigured: this.gatewayConfigured,
      };
    }
    return statuses;
  }

  listModels(task?: string): object[] {
    const models = task ? modelsForTask(task as ImageTask) : IMAGE_MODELS;
    return models.map((model) => ({
      id: model.id,
      provider: model.provider,
      name: model.name,
      costBucket: model.costBucket,
      classification: model.costBucket === 'free' ? 'free' : model.costBucket === 'paid' ? 'paid' : 'unknown',
      estimatedCostUsd: model.estimatedCostUsd,
      endpoint: model.endpoint,
      capabilities: model.capabilities,
    }));
  }

  async refreshModels(): Promise<object[]> {
    await this.refresh();
    return this.listModels();
  }

  async validateCredential(provider: string, apiKey: string): Promise<KeyValidationResult> {
    const id = this.requireProvider(provider);
    if (typeof apiKey !== 'string') throw new TypeError('API key is invalid.');
    return validateApiKey(id, apiKey);
  }

  async setCredential(provider: string, apiKey: string, scopes?: string[]): Promise<ProviderCredentialStatus & { storageMode: CredentialStorageMode }> {
    const id = this.requireProvider(provider);
    if (typeof apiKey !== 'string') throw new TypeError('API key is invalid.');
    const status = await this.credentials.configure({
      provider: id,
      apiKey,
      scopes: scopes as ConsentScope[] | undefined,
      termsVersion: '1.0',
    });
    return { ...status, storageMode: this.credentialStorageMode };
  }

  async removeCredential(provider: string): Promise<boolean> {
    const id = this.requireProvider(provider);
    await this.credentials.clear(id);
    return true;
  }

  async createJob(
    input: Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> & { jobId?: string }
  ): Promise<string> {
    const job = this.validateJobInput(input);
    const { jobId } = await this.queue.enqueue(job, { force: true });
    this.jobHistory.set(jobId, {
      job: { ...job, jobId, enqueuedAt: new Date().toISOString(), attempt: 0, reason: 'retryable-error' },
      status: 'queued',
      error: null,
      startedAt: null,
      finishedAt: null,
      outputDataUrl: null,
      provenanceId: null,
    });
    this.jobsStore.saveHistory([...this.jobHistory.values()]);
    const queued = this.queue.queuedJobs().find((entry) => entry.jobId === jobId) ?? null;
    if (queued) await this.executeJob(queued);
    return jobId;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    this.assertJobId(jobId);
    const record = this.jobHistory.get(jobId);
    const queued = this.queue.queuedJobs().find((entry) => entry.jobId === jobId);
    if (queued) await this.queue.complete(jobId);
    if (record) {
      record.status = 'canceled';
      record.finishedAt = new Date().toISOString();
      this.jobsStore.saveHistory([...this.jobHistory.values()]);
    }
    this.runningJobs.delete(jobId);
    return Boolean(record || queued);
  }

  async retryJob(jobId: string): Promise<string> {
    this.assertJobId(jobId);
    const record = this.jobHistory.get(jobId);
    if (!record || (record.status !== 'failed' && record.status !== 'canceled')) {
      throw new Error('Only failed or canceled jobs can be retried.');
    }
    const { jobId: nextId } = await this.queue.enqueue(record.job, { force: true });
    const refreshed = { ...record.job, jobId: nextId, attempt: record.job.attempt + 1, reason: 'retryable-error' as const };
    this.jobHistory.set(nextId, {
      job: refreshed,
      status: 'queued',
      error: null,
      startedAt: null,
      finishedAt: null,
      outputDataUrl: null,
      provenanceId: null,
    });
    this.jobsStore.saveHistory([...this.jobHistory.values()]);
    const queued = this.queue.queuedJobs().find((entry) => entry.jobId === nextId);
    if (queued) await this.executeJob(queued);
    return nextId;
  }

  async getJob(jobId: string): Promise<object | null> {
    this.assertJobId(jobId);
    const queued = this.queue.queuedJobs().find((entry) => entry.jobId === jobId);
    const record = this.jobHistory.get(jobId);
    if (!record && !queued) return null;
    return this.jobSnapshot(record ?? null, queued ?? null);
  }

  async listJobs(): Promise<object[]> {
    const queued = this.queue.queuedJobs();
    const seen = new Set<string>();
    const records: object[] = [];
    for (const job of queued) {
      records.push(this.jobSnapshot(this.jobHistory.get(job.jobId) ?? null, job));
      seen.add(job.jobId);
    }
    for (const record of this.jobHistory.values()) {
      if (seen.has(record.job.jobId)) continue;
      records.push(this.jobSnapshot(record, null));
    }
    return records;
  }

  async removeJob(jobId: string): Promise<boolean> {
    this.assertJobId(jobId);
    const had = this.jobHistory.delete(jobId);
    if (had) this.jobsStore.saveHistory([...this.jobHistory.values()]);
    const queued = this.queue.queuedJobs().find((entry) => entry.jobId === jobId);
    if (queued) await this.queue.complete(jobId);
    return had;
  }

  async importResult(jobId: string, accept: boolean): Promise<ImageStudioDocument> {
    this.assertJobId(jobId);
    const record = this.jobHistory.get(jobId);
    if (!record || record.status !== 'completed' || !record.outputDataUrl) {
      throw new Error('AI job has no completed output to import.');
    }
    const document = this.requireCurrent();
    const { job } = record;
    const asset = createEmbeddedAsset({
      dataUrl: record.outputDataUrl,
      mime: 'image/png',
      width: job.width,
      height: job.height,
    });
    const withAsset = addEmbeddedAsset(document, asset);
    const model = findImageModel(job.modelId);
    const costClassification = model ? (model.costBucket === 'free' ? 'free' : 'paid') : 'unknown';
    const provenanceResult = registerProvenance(withAsset.document, {
      id: record.provenanceId ?? undefined,
      jobId,
      provider: job.provider,
      modelId: job.modelId,
      endpoint: model?.endpoint ?? null,
      task: job.task,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      seed: job.seed,
      sourceLayerIds: job.sourceAssetId ? [job.sourceAssetId] : [],
      costClassification,
      estimatedCost: model?.estimatedCostUsd ?? null,
    });
    let next = provenanceResult.document;
    const layer = createGeneratedAILayer({
      provenanceId: provenanceResult.provenance.provenanceId,
      previewAssetId: asset.id,
      jobId,
      name: `${job.task} result`,
    });
    next = addGeneratedLayer(next, layer);
    next.activeLayerId = layer.id;
    if (accept) next = setProvenanceAccepted(next, provenanceResult.provenance.provenanceId, true);
    next.updatedAt = new Date().toISOString();
    validateLayerTree(next.layers);
    this.current = next;
    this.dirty = true;
    return this.current;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════════════════════

  close(filePath?: string): void {
    if (filePath !== undefined) {
      const target = assertAbsolutePath(filePath, 'Image Studio close path');
      if (this.currentPath === target) this.currentPath = null;
      this.current = null;
      this.dirty = false;
      this.resetHistory();
      return;
    }
    if (this.closed) return;
    this.closed = true;
    this.autosaveController.stop();
    this.queue.stopAutoRecheck();
    this.runningJobs.clear();
    this.jobHistory.clear();
    this.current = null;
    this.currentPath = null;
    this.undoStack.length = 0;
    this.redoStack = [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════════════════════════════════════════

  private defaultRecents(): StringListStore {
    const store = new Map<string, string[]>();
    return {
      load: () => store.get('items') ?? [],
      save: (items) => store.set('items', items),
    };
  }

  private defaultJobsStore(): ImageStudioJobStore {
    const store = new Map<string, unknown>();
    return {
      async loadDeferredJobs() {
        return (store.get('deferred') as DeferredAiJob[]) ?? [];
      },
      async saveDeferredJobs(jobs) {
        store.set('deferred', jobs);
      },
      loadHistory() {
        return (store.get('history') as JobRecord[]) ?? [];
      },
      saveHistory(records) {
        store.set('history', records);
      },
    };
  }

  private requireCurrent(): ImageStudioDocument {
    if (!this.current) throw new Error('No Image Studio document is open.');
    return this.current;
  }

  private requireLayer(layerId: string): ImageLayer {
    if (typeof layerId !== 'string' || layerId.length === 0 || layerId.length > 512) {
      throw new TypeError('Layer ID is invalid.');
    }
    const document = this.requireCurrent();
    const layer = document.layers.find((entry) => entry.id === layerId);
    if (!layer) throw new Error('Layer does not exist.');
    return layer;
  }

  private mutate(fn: (document: ImageStudioDocument) => ImageStudioDocument): ImageStudioDocument {
    const document = this.requireCurrent();
    this.undoStack.push({ kind: 'edit', document: structuredClone(document) });
    if (this.undoStack.length > MAX_UNDO_SNAPSHOTS) this.undoStack.shift();
    this.redoStack = [];
    const next = fn(structuredClone(document));
    validateLayerTree(next.layers);
    next.updatedAt = new Date().toISOString();
    this.current = next;
    this.dirty = true;
    return this.current;
  }

  private mutateBoolean(fn: (document: ImageStudioDocument) => ImageStudioDocument): boolean {
    this.mutate(fn);
    return true;
  }

  private resetHistory(): void {
    this.undoStack.length = 0;
    this.redoStack = [];
  }

  private pushRecent(filePath: string): void {
    const next = [filePath, ...this.recents.load().filter((entry) => entry !== filePath)].slice(0, MAX_RECENT_PROJECTS);
    this.recents.save(next);
  }

  private async flatten(document: ImageStudioDocument): Promise<RgbaBuffer> {
    const assets = new Map<string, RgbaBuffer>();
    for (const asset of document.embeddedAssets) {
      try {
        assets.set(asset.id, await decodeDataUrl(asset.dataUrl));
      } catch {
        // A layer referencing an undecodable asset simply contributes nothing.
      }
    }
    const layersWithRetouch: typeof document.layers = [];
    for (const layer of document.layers) {
      if (layer.kind !== 'raster') {
        layersWithRetouch.push(layer);
        continue;
      }
      const layerRetouch = (layer as unknown as Record<string, unknown>).retouche as
        | { operations: RetouchOperationRecord[]; masks: RetouchMaskRecord[] }
        | undefined;
      if (!layerRetouch || layerRetouch.operations.length === 0) {
        layersWithRetouch.push(layer);
        continue;
      }
      const assetId = (layer as unknown as { assetId: string }).assetId;
      const assetBuf = assets.get(assetId);
      if (!assetBuf) {
        layersWithRetouch.push(layer);
        continue;
      }
      const enabledOps = layerRetouch.operations.filter((op) => op.enabled);
      if (enabledOps.length === 0) {
        layersWithRetouch.push(layer);
        continue;
      }
      const engineOps = enabledOps.map(documentRetouchOpToEngineOp) as RetouchOperation[];
      const engineMasks = documentMasksToEngineMasks(layerRetouch.masks);
      let mutated = assetBuf;
      for (const op of engineOps) {
        mutated = await renderRetouchPipeline({
          source: mutated,
          operations: [op],
          masks: engineMasks,
          quality: 'export',
        });
      }
      assets.set(assetId, mutated);
      layersWithRetouch.push(layer);
    }
    const docWithRetouch = { ...document, layers: layersWithRetouch } as ImageStudioDocument;
    let flattened = await flattenDocument(docWithRetouch, {
      canvas: { width: document.canvas.width, height: document.canvas.height },
      resolveAsset: (assetId) => assets.get(assetId) ?? null,
      renderers: [],
    });
    // Apply legacy post-composite retouch for migrated documents
    if (document.legacyCompositeRetouch && document.legacyCompositeRetouch.operations.length > 0) {
      flattened = await applyRetouchToBuffer(flattened, document.legacyCompositeRetouch, 'export');
    }
    return flattened;
  }

  private async performAutosave(document: ImageStudioDocument, autosavePath: string): Promise<void> {
    const at = await saveDocument(document, autosavePath, {
      adapter: this.adapter,
      hash: this.hash,
      applicationVersion: this.applicationVersion,
    });
    document.recovery.autosaveAt = at;
    document.recovery.autosavePath = autosavePath;
    await writeRecoveryRecord(
      {
        documentId: document.documentId,
        autosavePath,
        savedAt: at,
        reason: 'manual',
      },
      { adapter: this.adapter, hash: this.hash, indexPath: this.recoveryIndexPath }
    );
    this.dirty = false;
    this.events.autosave(autosavePath);
  }

  private autosavePathFor(projectPath: string): string {
    const digest = createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
    return path.join(this.autosaveDir, `project-${digest}.knouximage.autosave.json`);
  }

  private assertAutosavePath(recoveryPath: string): string {
    const target = assertAbsolutePath(recoveryPath, 'Recovery path');
    const relative = path.relative(path.resolve(this.autosaveDir), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new TypeError('Recovery path is outside the autosave directory.');
    }
    return target;
  }

  private requireProvider(provider: string): ImageProviderId {
    if (typeof provider !== 'string' || !Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
      throw new TypeError('Unknown AI provider.');
    }
    return provider as ImageProviderId;
  }

  private validateJobInput(
    input: Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'>
  ): Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> {
    if (!isRecord(input)) throw new TypeError('AI job is invalid.');
    const task = input.task;
    if (typeof task !== 'string' || !modelsForTask(task as ImageTask).some(() => true)) {
      throw new TypeError('Unknown AI task.');
    }
    const model = findImageModel(input.modelId as string);
    if (!model) throw new TypeError('Unknown image model.');
    if (typeof input.prompt !== 'string' || input.prompt.length === 0 || input.prompt.length > MAX_JOB_PROMPT_LENGTH) {
      throw new TypeError('AI prompt is invalid.');
    }
    if (input.width !== undefined && (typeof input.width !== 'number' || input.width < 1)) {
      throw new TypeError('AI job width is invalid.');
    }
    if (input.height !== undefined && (typeof input.height !== 'number' || input.height < 1)) {
      throw new TypeError('AI job height is invalid.');
    }
    if (input.seed !== null && input.seed !== undefined && (typeof input.seed !== 'number' || !Number.isInteger(input.seed))) {
      throw new TypeError('AI job seed is invalid.');
    }
    if (input.maskAssetId !== null && input.maskAssetId !== undefined && typeof input.maskAssetId !== 'string') {
      throw new TypeError('AI job mask asset ID is invalid.');
    }
    if (input.sourceAssetId !== null && input.sourceAssetId !== undefined && typeof input.sourceAssetId !== 'string') {
      throw new TypeError('AI job source asset ID is invalid.');
    }
    return input as typeof input;
  }

  private assertJobId(jobId: string): void {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128 || jobId.includes('\u0000')) {
      throw new TypeError('AI job ID is invalid.');
    }
  }

  private async executeJob(job: DeferredAiJob): Promise<void> {
    if (this.runningJobs.has(job.jobId)) return;
    this.runningJobs.add(job.jobId);
    const startedAt = new Date().toISOString();
    const record = this.jobHistory.get(job.jobId) ?? {
      job,
      status: 'queued' as JobStatus,
      error: null,
      startedAt: null,
      finishedAt: null,
      outputDataUrl: null,
      provenanceId: null,
    };
    record.status = 'running';
    record.startedAt = startedAt;
    this.jobsStore.saveHistory([...this.jobHistory.values()]);
    this.events.jobProgress(job);
    try {
      if (job.provider === 'mock') {
        const outputDataUrl = this.mockOutputDataUrl(job);
        const provenance = this.provenanceFor(job, record.provenanceId);
        record.status = 'completed';
        record.outputDataUrl = outputDataUrl;
        record.provenanceId = provenance.provenanceId;
        record.finishedAt = new Date().toISOString();
        this.jobsStore.saveHistory([...this.jobHistory.values()]);
        await this.queue.complete(job.jobId);
        this.events.jobComplete(job.jobId, provenance);
        return;
      }
      if (job.provider === 'local') {
        throw new Error('Local provider is not yet available in this build.');
      }
      const online = this.queue.connectivityState === 'online';
      if (!online) {
        record.status = 'queued';
        record.error = null;
        this.jobsStore.saveHistory([...this.jobHistory.values()]);
        this.runningJobs.delete(job.jobId);
        return;
      }
      if (job.provider === 'openrouter') {
        throw new Error('OpenRouter generation is not wired in this build.');
      }
      const request = buildGatewayRequest({
        provider: job.provider,
        modelId: job.modelId,
        task: job.task,
        prompt: job.prompt,
        negativePrompt: job.negativePrompt ?? null,
        seed: job.seed,
        width: clampInteger(job.width ?? 256, 1, 4096),
        height: clampInteger(job.height ?? 256, 1, 4096),
        references: [],
      });
      const result = await this.gateway.submit(request);
      const outputHash = await this.hash(
        Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64')
      );
      const provenance = this.provenanceFor(job, record.provenanceId, {
        width: result.width,
        height: result.height,
        outputHash,
      });
      record.status = 'completed';
      record.outputDataUrl = result.dataUrl;
      record.provenanceId = provenance.provenanceId;
      record.finishedAt = new Date().toISOString();
      this.jobsStore.saveHistory([...this.jobHistory.values()]);
      await this.queue.complete(job.jobId);
      this.events.jobComplete(job.jobId, provenance);
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'AI job failed.';
      record.finishedAt = new Date().toISOString();
      this.jobsStore.saveHistory([...this.jobHistory.values()]);
      await this.queue.complete(job.jobId);
      this.events.jobFailed(job.jobId, record.error);
    } finally {
      this.runningJobs.delete(job.jobId);
    }
  }

  private provenanceFor(
    job: DeferredAiJob,
    provenanceId: string | null,
    result?: { width: number; height: number; outputHash: string }
  ): AIImageProvenance {
    const model = findImageModel(job.modelId);
    const costClassification = model ? (model.costBucket === 'free' ? 'free' : 'paid') : 'unknown';
    return {
      provenanceId: provenanceId ?? `prov-${randomUUID()}`,
      jobId: job.jobId,
      provider: job.provider,
      modelId: job.modelId,
      endpoint: model?.endpoint ?? null,
      task: job.task,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      seed: job.seed,
      parameters: result ? { width: result.width, height: result.height } : {},
      sourceLayerIds: job.sourceAssetId ? [job.sourceAssetId] : [],
      sourceImageHash: null,
      maskHash: null,
      generatedAt: new Date().toISOString(),
      outputHash: result?.outputHash ?? null,
      costClassification,
      estimatedCost: model?.estimatedCostUsd ?? null,
      accepted: null,
    };
  }

  private mockOutputDataUrl(job: DeferredAiJob): string {
    const width = clampInteger(job.width ?? 256, 1, MOCK_OUTPUT_MAX_DIMENSION);
    const height = clampInteger(job.height ?? 256, 1, MOCK_OUTPUT_MAX_DIMENSION);
    const random = deterministicPrng(job.seed ?? 0);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const gradient = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
        const noise = random();
        data[index] = Math.round(255 * gradient + noise * 32);
        data[index + 1] = Math.round(128 + 96 * Math.sin(gradient * Math.PI + (job.seed ?? 0) / 1000));
        data[index + 2] = Math.round(255 * (1 - gradient) + noise * 16);
        data[index + 3] = 255;
      }
    }
    return dataUrlOf(encodePng({ width, height, data }), 'image/png');
  }

  private jobSnapshot(record: JobRecord | null, queued: DeferredAiJob | null): object {
    const source = record?.job ?? queued;
    if (!source) return {};
    return {
      jobId: source.jobId,
      task: source.task,
      provider: source.provider,
      modelId: source.modelId,
      prompt: source.prompt,
      negativePrompt: source.negativePrompt,
      seed: source.seed,
      width: source.width,
      height: source.height,
      maskAssetId: source.maskAssetId,
      sourceAssetId: source.sourceAssetId,
      enqueuedAt: source.enqueuedAt,
      attempt: source.attempt,
      reason: source.reason,
      status: record?.status ?? 'queued',
      error: record?.error ?? null,
      startedAt: record?.startedAt ?? null,
      finishedAt: record?.finishedAt ?? null,
      outputDataUrl: record?.outputDataUrl ?? null,
      provenanceId: record?.provenanceId ?? null,
    };
  }
}

function removeLayerSafe(layers: ImageLayer[], layerId: string): ImageLayer[] {
  const removeSet = new Set<string>();
  const collect = (id: string): void => {
    if (removeSet.has(id)) return;
    removeSet.add(id);
    for (const layer of layers) {
      if (layer.parentId === id) collect(layer.id);
    }
  };
  collect(layerId);
  return layers.filter((layer) => !removeSet.has(layer.id));
}

function normalizeMask(mask: LayerMask): LayerMask {
  if (typeof mask.assetId !== 'string' || mask.assetId.length === 0) throw new TypeError('Layer mask asset ID is invalid.');
  const opacity = mask.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('Layer mask opacity must be between 0 and 1.');
  const feather = mask.feather ?? 0;
  if (!Number.isFinite(feather) || feather < 0 || feather > 100_000) throw new RangeError('Layer mask feather is invalid.');
  return {
    assetId: mask.assetId,
    enabled: Boolean(mask.enabled),
    inverted: Boolean(mask.inverted),
    linked: Boolean(mask.linked),
    opacity,
    feather,
  };
}

function exportOptionsOf(plan: ExportPlan): ExportOptions {
  return {
    format: plan.format,
    width: plan.width,
    height: plan.height,
    quality: plan.quality ?? undefined,
    preserveAlpha: plan.preserveAlpha,
    includeMetadata: true,
  };
}

function legacyPayloadOf(value: unknown): {
  name?: string;
  width?: number;
  height?: number;
  canvasDataUrl?: string;
  savedAt?: string;
  applicationVersion?: string;
} {
  if (!isRecord(value)) throw new TypeError('Legacy image data must be an object.');
  return value as {
    name?: string;
    width?: number;
    height?: number;
    canvasDataUrl?: string;
    savedAt?: string;
    applicationVersion?: string;
  };
}
