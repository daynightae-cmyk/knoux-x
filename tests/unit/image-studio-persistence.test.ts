import { createHash } from 'node:crypto';

import {
  addEmbeddedAsset,
  addLayer,
  createImageStudioDocument,
  createRasterLayer,
} from '../../src/core/image-studio/document/document';
import {
  autosaveDocument,
  canonicalJson,
  clearRecoveryRecord,
  deserializeDocument,
  findRecoverableDocuments,
  openDocument,
  readRecoveryIndex,
  roundTripProof,
  saveDocument,
  serializeDocument,
  writeRecoveryRecord,
  type HashFunction,
  type StorageAdapter,
} from '../../src/core/image-studio/persistence/storage';

const hash: HashFunction = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

class MemoryAdapter implements StorageAdapter {
  private readonly files = new Map<string, string>();

  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error('File not found.');
    return content;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(_path: string): Promise<{ modifiedAt: string }> {
    return { modifiedAt: new Date().toISOString() };
  }

  async mkdirp(_path: string): Promise<void> {
    return undefined;
  }

  content(path: string): string | undefined {
    return this.files.get(path);
  }
}function layeredDocument() {
  let document = createImageStudioDocument({ width: 320, height: 240, title: 'Persistence' });
  const raster = createRasterLayer(document, {
    name: 'Layer',
    dataUrl: `data:image/png;base64,${'A'.repeat(256)}`,
    width: 320,
    height: 240,
  });
  document = addEmbeddedAsset(document, {
    id: raster.asset.id,
    dataUrl: raster.asset.dataUrl,
    width: 320,
    height: 240,
  }).document;
  document = addLayer(document, raster.layer);
  return document;
}

describe('image studio persistence', () => {
  it('canonicalJson is deterministic regardless of key order', () => {
    const a = canonicalJson({ b: 1, a: { z: 2, y: 1 } });
    const b = canonicalJson({ a: { y: 1, z: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('serializes and deserializes a document with an integrity envelope', async () => {
    const document = layeredDocument();
    const content = await serializeDocument(document, { hash });
    const parsed = JSON.parse(content);
    expect(parsed.schema).toBe('knoux-image-studio');
    expect(parsed.integrity.payloadHash).toBeTruthy();
    expect(Object.keys(parsed.integrity.assetHashes)).toHaveLength(1);
    const result = await deserializeDocument(content, { hash });
    expect(result.integrity).toBe(true);
    expect(result.document.documentId).toBe(document.documentId);
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.embeddedAssets).toHaveLength(1);
  });

  it('round-trip proof returns identical canonical payloads', async () => {
    const document = layeredDocument();
    const proof = await roundTripProof(document, { hash });
    expect(proof.ok).toBe(true);
    expect(proof.message).toBe('round-trip identical');
  });

  it('detects payload tampering via checksum', async () => {
    const document = layeredDocument();
    const content = await serializeDocument(document, { hash });
    const envelope = JSON.parse(content);
    envelope.document.title = 'Tampered';
    const warnings: string[] = [];
    const result = await deserializeDocument(JSON.stringify(envelope), {
      hash,
      onIntegrityWarning: (message) => warnings.push(message),
    });
    expect(result.integrity).toBe(false);
    expect(warnings.some((message) => /payload checksum/.test(message))).toBe(true);
  });

  it('detects tampered embedded assets via per-asset hashes', async () => {
    const document = layeredDocument();
    const content = await serializeDocument(document, { hash });
    const envelope = JSON.parse(content);
    const assetId = envelope.document.embeddedAssets[0].id;
    envelope.document.embeddedAssets[0].dataUrl = `data:image/png;base64,${'F'.repeat(64)}`;
    const warnings: string[] = [];
    const result = await deserializeDocument(JSON.stringify(envelope), {
      hash,
      onIntegrityWarning: (message) => warnings.push(message),
    });
    expect(result.integrity).toBe(false);
    expect(result.assetIntegrity[assetId]).toBe(false);
    expect(warnings.some((message) => /asset/.test(message))).toBe(true);
  });

  it('rejects malformed and unsupported files', async () => {
    await expect(deserializeDocument('not json', { hash })).rejects.toThrow(TypeError);
    await expect(
      deserializeDocument(JSON.stringify({ schema: 'knoux-slideshow', document: {} }), { hash })
    ).rejects.toThrow(/Unsupported Image Studio document schema/);
  });

  it('saveDocument and openDocument round-trip through an adapter', async () => {
    const adapter = new MemoryAdapter();
    const document = layeredDocument();
    await saveDocument(document, '/tmp/test.json', { adapter, hash });
    expect(adapter.content('/tmp/test.json')).toBeTruthy();
    const opened = await openDocument('/tmp/test.json', { adapter, hash });
    expect(opened.integrity).toBe(true);
    expect(opened.document.documentId).toBe(document.documentId);
    await expect(openDocument('/tmp/missing.json', { adapter, hash })).rejects.toThrow(/does not exist/);
  });

  it('autosaveDocument writes an autosave and recovery record', async () => {
    const adapter = new MemoryAdapter();
    const document = layeredDocument();
    const result = await autosaveDocument(document, {
      adapter,
      hash,
      autosavePath: '/tmp/autosave/test.knouximage',
      indexPath: '/tmp/recovery.json',
    });
    expect(result.path).toBe('/tmp/autosave/test.knouximage');
    expect(adapter.content(result.path)).toBeTruthy();
    const index = await readRecoveryIndex({ adapter, hash, indexPath: '/tmp/recovery.json' });
    expect(index).toHaveLength(1);
    expect(index[0].documentId).toBe(document.documentId);
    expect(document.recovery.autosavePath).toBe('/tmp/autosave/test.knouximage');
  });

  it('recovery index deduplicates by document id and supports clearing', async () => {
    const adapter = new MemoryAdapter();
    const document = layeredDocument();
    const options = { adapter, hash, indexPath: '/tmp/recovery.json' };
    await writeRecoveryRecord(
      { documentId: document.documentId, autosavePath: '/a.json', savedAt: '2026-01-01T00:00:00Z', reason: 'crash' },
      options
    );
    await writeRecoveryRecord(
      { documentId: document.documentId, autosavePath: '/b.json', savedAt: '2026-01-02T00:00:00Z', reason: 'manual' },
      options
    );
    const index = await readRecoveryIndex(options);
    expect(index).toHaveLength(1);
    expect(index[0].autosavePath).toBe('/b.json');
    await clearRecoveryRecord(document.documentId, options);
    expect(await readRecoveryIndex(options)).toEqual([]);
  });

  it('findRecoverableDocuments only reports autosaves that still exist', async () => {
    const adapter = new MemoryAdapter();
    const options = { adapter, hash, indexPath: '/tmp/recovery.json' };
    const document = layeredDocument();
    await autosaveDocument(document, {
      adapter,
      hash,
      autosavePath: '/tmp/autosave/a.knouximage',
      indexPath: '/tmp/recovery.json',
    });
    const recoverable = await findRecoverableDocuments(options);
    expect(recoverable).toHaveLength(1);
  });

  it('autosave controller debounces and tracks lastSavedAt', async () => {
    const adapter = new MemoryAdapter();
    const document = layeredDocument();
    const { ImageStudioAutosaveController } = await import(
      '../../src/core/image-studio/persistence/storage'
    );
    const controller = new ImageStudioAutosaveController({ adapter, hash, intervalMs: 60_000 });
    await controller.flush(document, '/tmp/autosave/controller.json');
    expect(controller.lastSavedAt).toBeTruthy();
    expect(adapter.content('/tmp/autosave/controller.json')).toBeTruthy();
    controller.start();
    controller.stop();
  });
});
