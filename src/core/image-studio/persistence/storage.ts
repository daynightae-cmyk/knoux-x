import {
  IMAGE_STUDIO_SCHEMA,
  IMAGE_STUDIO_SCHEMA_VERSION,
  type EmbeddedAsset,
  type ImageStudioDocument,
} from '../document/schema';
import { parseImageStudioDocument } from '../document/document';

/**
 * Persistence layer for KNOUX Image Studio documents.
 *
 * The document is stored as a single JSON envelope with an integrity
 * section (payload checksum + per-asset hashes) so corruption and
 * tampering are detected on open. All file I/O goes through an injected
 * adapter so the logic is unit-testable in Node and lifted to the
 * renderer via the Electron bridge.
 */

export type HashFunction = (bytes: Uint8Array) => Promise<string>;

export interface StorageAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ modifiedAt: string }>;
  mkdirp(path: string): Promise<void>;
}

export interface ImageStudioSaveEnvelope {
  schema: typeof IMAGE_STUDIO_SCHEMA;
  schemaVersion: number;
  savedAt: string;
  applicationVersion: string;
  integrity: {
    payloadHash: string;
    assetHashes: Record<string, string>;
  };
  document: ImageStudioDocument;
}

export interface SerializeOptions {
  applicationVersion?: string;
  hash: HashFunction;
}

export interface DeserializeOptions {
  hash: HashFunction;
  applicationVersion?: string;
  onIntegrityWarning?: (message: string) => void;
}

export interface AutosaveOptions {
  adapter: StorageAdapter;
  hash: HashFunction;
  intervalMs?: number;
  onError?: (error: Error) => void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Deterministic canonical JSON used for checksums. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = sortKeys(record[key]);
    return result;
  }
  return value;
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export async function serializeDocument(
  document: ImageStudioDocument,
  options: SerializeOptions
): Promise<string> {
  const payload = canonicalJson(document);
  const payloadHash = await options.hash(bytesOf(payload));
  const assetHashes: Record<string, string> = {};
  for (const asset of document.embeddedAssets) {
    assetHashes[asset.id] = await options.hash(bytesOf(asset.dataUrl));
  }
  const envelope: ImageStudioSaveEnvelope = {
    schema: IMAGE_STUDIO_SCHEMA,
    schemaVersion: IMAGE_STUDIO_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    applicationVersion: options.applicationVersion ?? document.applicationVersion,
    integrity: { payloadHash, assetHashes },
    document: clone(document),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function deserializeDocument(
  content: string,
  options: DeserializeOptions
): Promise<{ document: ImageStudioDocument; integrity: boolean; assetIntegrity: Record<string, boolean> }> {
  let envelope: ImageStudioSaveEnvelope;
  try {
    envelope = JSON.parse(content) as ImageStudioSaveEnvelope;
  } catch {
    throw new TypeError('Image Studio file is not valid JSON.');
  }
  if (
    envelope.schema !== IMAGE_STUDIO_SCHEMA ||
    envelope.schemaVersion !== IMAGE_STUDIO_SCHEMA_VERSION
  ) {
    throw new TypeError('Unsupported Image Studio document schema in saved file.');
  }
  if (!envelope.document || typeof envelope.document !== 'object')
    throw new TypeError('Image Studio file is missing its document payload.');
  const payloadHash = await options.hash(bytesOf(canonicalJson(envelope.document)));
  const integrity = payloadHash === envelope.integrity?.payloadHash;
  if (!integrity && options.onIntegrityWarning)
    options.onIntegrityWarning('Document payload checksum does not match.');
  const assetIntegrity: Record<string, boolean> = {};
  for (const asset of envelope.document.embeddedAssets) {
    const expected = envelope.integrity?.assetHashes?.[asset.id];
    if (!expected) {
      assetIntegrity[asset.id] = false;
      continue;
    }
    const actual = await options.hash(bytesOf(asset.dataUrl));
    assetIntegrity[asset.id] = actual === expected;
    if (!assetIntegrity[asset.id] && options.onIntegrityWarning)
      options.onIntegrityWarning(`Embedded asset "${asset.id}" checksum does not match.`);
  }
  const document = parseImageStudioDocument(envelope.document);
  document.recovery.lastSavedAt = envelope.savedAt ?? document.recovery.lastSavedAt;
  document.recovery.lastOpenedByVersion = envelope.applicationVersion ?? document.recovery.lastOpenedByVersion;
  return { document, integrity, assetIntegrity };
}

/** Round-trip proof: serialize then deserialize a document and verify the
 *  payload is bit-identical (canonical form). */
export async function roundTripProof(
  document: ImageStudioDocument,
  options: SerializeOptions
): Promise<{ ok: boolean; canonicalPayload: string; message: string }> {
  const serialized = await serializeDocument(document, options);
  const parsed = await deserializeDocument(serialized, options);
  const normalized = { ...parsed.document, recovery: clone(document.recovery) };
  const canonical = canonicalJson(normalized);
  const expected = canonicalJson(document);
  return {
    ok: canonical === expected,
    canonicalPayload: canonical,
    message: canonical === expected ? 'round-trip identical' : 'round-trip diverged',
  };
}

export async function saveDocument(
  document: ImageStudioDocument,
  path: string,
  options: { adapter: StorageAdapter } & SerializeOptions
): Promise<string> {
  const content = await serializeDocument(document, options);
  await options.adapter.writeText(path, content);
  const now = new Date().toISOString();
  return now;
}

export async function openDocument(
  path: string,
  options: { adapter: StorageAdapter } & DeserializeOptions
): Promise<{ document: ImageStudioDocument; integrity: boolean; assetIntegrity: Record<string, boolean> }> {
  if (!(await options.adapter.exists(path)))
    throw new Error('Image Studio file does not exist.');
  const content = await options.adapter.readText(path);
  const result = await deserializeDocument(content, options);
  result.document.recovery.lastOpenedByVersion =
    options.applicationVersion ?? result.document.recovery.lastOpenedByVersion;
  return result;
}

/** Compute a fresh checksum for a single embedded asset. */
export async function hashEmbeddedAsset(asset: EmbeddedAsset, hash: HashFunction): Promise<string> {
  return hash(bytesOf(asset.dataUrl));
}

export class ImageStudioAutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly adapter: StorageAdapter;
  private readonly hash: HashFunction;
  private readonly intervalMs: number;
  private readonly onError?: (error: Error) => void;
  private lastSaved: string | null = null;

  constructor(options: AutosaveOptions) {
    this.adapter = options.adapter;
    this.hash = options.hash;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.onError = options.onError;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Schedule an immediate autosave if a change was made. */
  async flush(document: ImageStudioDocument | null = null, path: string | null = null): Promise<void> {
    if (!document) return;
    try {
      await saveDocument(document, path ?? document.recovery.autosavePath ?? this.autosavePathFor(document), {
        adapter: this.adapter,
        hash: this.hash,
        applicationVersion: document.applicationVersion,
      });
      this.lastSaved = new Date().toISOString();
    } catch (error) {
      if (this.onError && error instanceof Error) this.onError(error);
    }
  }

  get lastSavedAt(): string | null {
    return this.lastSaved;
  }

  private autosavePathFor(document: ImageStudioDocument): string {
    return document.recovery.autosavePath ??
      `knoux-image-studio.autosave-${document.documentId}.json`;
  }
}

export interface RecoveryRecord {
  documentId: string;
  autosavePath: string;
  savedAt: string;
  reason: 'crash' | 'manual' | 'shutdown';
}

export async function writeRecoveryRecord(
  record: RecoveryRecord,
  options: { adapter: StorageAdapter; hash: HashFunction; indexPath: string }
): Promise<void> {
  const index = await readRecoveryIndex(options);
  const next = index.filter((entry) => entry.documentId !== record.documentId);
  next.unshift(record);
  await options.adapter.writeText(options.indexPath, canonicalJson(next));
}

export async function readRecoveryIndex(
  options: { adapter: StorageAdapter; hash: HashFunction; indexPath: string }
): Promise<RecoveryRecord[]> {
  try {
    if (!(await options.adapter.exists(options.indexPath))) return [];
    const content = await options.adapter.readText(options.indexPath);
    const parsed = JSON.parse(content) as RecoveryRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry.documentId === 'string');
  } catch {
    return [];
  }
}

export async function clearRecoveryRecord(
  documentId: string,
  options: { adapter: StorageAdapter; hash: HashFunction; indexPath: string }
): Promise<void> {
  const index = await readRecoveryIndex(options);
  const next = index.filter((entry) => entry.documentId !== documentId);
  await options.adapter.writeText(options.indexPath, canonicalJson(next));
}

export async function findRecoverableDocuments(
  options: { adapter: StorageAdapter; hash: HashFunction; indexPath: string }
): Promise<RecoveryRecord[]> {
  const index = await readRecoveryIndex(options);
  const survivors: RecoveryRecord[] = [];
  for (const record of index) {
    try {
      if (await options.adapter.exists(record.autosavePath)) survivors.push(record);
    } catch {
      // skip unreachable autosave paths
    }
  }
  return survivors;
}

export async function autosaveDocument(
  document: ImageStudioDocument,
  options: { adapter: StorageAdapter; hash: HashFunction; autosavePath: string; indexPath: string }
): Promise<{ path: string; at: string }> {
  await options.adapter.mkdirp(options.autosavePath.replace(/[\\/][^\\/]+$/, ''));
  const at = await saveDocument(document, options.autosavePath, options);
  document.recovery.autosaveAt = at;
  document.recovery.autosavePath = options.autosavePath;
  await writeRecoveryRecord(
    { documentId: document.documentId, autosavePath: options.autosavePath, savedAt: at, reason: 'manual' },
    options
  );
  return { path: options.autosavePath, at };
}
