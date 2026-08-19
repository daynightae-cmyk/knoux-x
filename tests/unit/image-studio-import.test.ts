import { createHash } from 'node:crypto';

import { serializeDocument } from '../../src/core/image-studio/persistence/storage';
import { createImageStudioDocument } from '../../src/core/image-studio/document/document';
import { createBuffer, type RgbaBuffer } from '../../src/core/image-studio/raster/compositor';
import { encodePng } from '../../src/core/image-studio/export/export';
import {
  detectForeignFormat,
  importForeignImage,
  importNativeDocument,
  migrateForeignImage,
  validateImportedImage,
  type ImageDecoder,
  type ImportedImage,
} from '../../src/core/image-studio/import/import';

const hash = async (bytes: Uint8Array) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function bufferFixture(width: number, height: number): RgbaBuffer {
  const buffer = createBuffer(width, height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    buffer.data[i] = 30;
    buffer.data[i + 1] = 60;
    buffer.data[i + 2] = 90;
    buffer.data[i + 3] = 255;
  }
  return buffer;
}

const pngBytes = (): Uint8Array => encodePng(bufferFixture(16, 16));

describe('image studio import pipeline', () => {
  describe('detectForeignFormat', () => {
    it('detects PNG by signature', () => {
      expect(detectForeignFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('png');
    });

    it('detects JPEG by signature', () => {
      expect(detectForeignFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    });

    it('detects BMP by signature', () => {
      expect(detectForeignFormat(new Uint8Array([0x42, 0x4d, 0x36, 0x00]))).toBe('bmp');
    });

    it('detects WebP by RIFF signature', () => {
      expect(detectForeignFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(
        'webp'
      );
    });

    it('prefers a declared MIME over signature heuristics', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      expect(detectForeignFormat(bytes, 'image/png')).toBe('png');
      expect(detectForeignFormat(bytes, 'image/unknown')).toBe('unknown');
    });

    it('falls back to unknown for unrecognized bytes', () => {
      expect(detectForeignFormat(new Uint8Array([9, 9, 9, 9, 9]))).toBe('unknown');
    });
  });

  describe('validateImportedImage', () => {
    it('accepts a well-formed raster', () => {
      const image: ImportedImage = { width: 8, height: 8, mime: 'image/png', buffer: bufferFixture(8, 8) };
      expect(() => validateImportedImage(image)).not.toThrow();
    });

    it('rejects zero and oversized dimensions', () => {
      const image = {
        width: 0,
        height: 8,
        mime: 'image/png',
        buffer: createBuffer(1, 8),
      };
      expect(() => validateImportedImage(image)).toThrow(/must be positive/);
    });

    it('rejects a buffer whose byte count mismatches dimensions', () => {
      const image = { width: 8, height: 8, mime: 'image/png', buffer: bufferFixture(4, 4) };
      expect(() => validateImportedImage(image)).toThrow(/buffer size does not match/);
    });
  });

  describe('migrateForeignImage', () => {
    it('creates a layered document with a single background raster layer', () => {
      const image: ImportedImage = { width: 32, height: 24, mime: 'image/png', buffer: bufferFixture(32, 24) };
      const document = migrateForeignImage(image, { title: 'Photo' });
      expect(document.title).toBe('Photo');
      expect(document.canvas.width).toBe(32);
      expect(document.canvas.height).toBe(24);
      expect(document.layers).toHaveLength(1);
      expect(document.layers[0].kind).toBe('raster');
      expect(document.layers[0].name).toBe('Background');
      expect(document.embeddedAssets).toHaveLength(1);
      expect(document.activeLayerId).toBe(document.layers[0].id);
      expect(document.migrationHistory[0].from).toBe(0);
    });
  });

  describe('importForeignImage', () => {
    it('decodes and imports a supported image via the injected decoder', async () => {
      const decoder: ImageDecoder = {
        async decode(bytes, mime) {
          return { width: 16, height: 16, mime, buffer: bufferFixture(16, 16) };
        },
      };
      const result = await importForeignImage(pngBytes(), { decoder, mime: 'image/png', title: 'From File' });
      expect(result.kind).toBe('foreign');
      expect(result.format).toBe('png');
      expect(result.integrity).toBeNull();
      expect(result.warnings).toEqual([]);
      expect(result.document.title).toBe('From File');
      expect(result.document.layers).toHaveLength(1);
    });

    it('creates a blank document with a warning for unknown formats', async () => {
      const decoder: ImageDecoder = {
        async decode(bytes, mime) {
          return { width: 1, height: 1, mime, buffer: bufferFixture(1, 1) };
        },
      };
      const result = await importForeignImage(new Uint8Array([1, 2, 3]), { decoder, title: 'Blank' });
      expect(result.format).toBe('unknown');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.document.layers).toHaveLength(0);
    });

    it('surfaces decode failures as thrown errors', async () => {
      const decoder: ImageDecoder = {
        async decode() {
          throw new Error('codec exploded');
        },
      };
      await expect(importForeignImage(pngBytes(), { decoder, mime: 'image/png' })).rejects.toThrow(
        /Failed to decode/
      );
    });

    it('rejects an imported raster that violates limits', async () => {
      const decoder: ImageDecoder = {
        async decode() {
          return { width: 8, height: 8, mime: 'image/png', buffer: bufferFixture(4, 4) };
        },
      };
      await expect(importForeignImage(pngBytes(), { decoder, mime: 'image/png' })).rejects.toThrow();
    });
  });

  describe('importNativeDocument', () => {
    it('opens a native envelope and reports integrity warnings', async () => {
      const document = createImageStudioDocument({ width: 64, height: 64, title: 'Native' });
      const content = await serializeDocument(document, { hash });
      const result = await importNativeDocument(content, { hash });
      expect(result.kind).toBe('native');
      expect(result.integrity).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.document.documentId).toBe(document.documentId);
    });

    it('reports payload corruption as a warning', async () => {
      const document = createImageStudioDocument({ width: 64, height: 64 });
      const content = await serializeDocument(document, { hash });
      const tampered = content.replace(document.title, document.title + 'x');
      const result = await importNativeDocument(tampered, { hash });
      expect(result.integrity).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
