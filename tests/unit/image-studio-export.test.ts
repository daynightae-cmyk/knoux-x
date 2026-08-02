import { createImageStudioDocument } from '../../src/core/image-studio/document/document';
import { createBuffer, type RgbaBuffer } from '../../src/core/image-studio/raster/compositor';
import {
  buildExportMetadata,
  dataUrlOf,
  encodeBmp,
  encodePng,
  encodeSvg,
  exportBuffer,
  planExport,
  prepareBuffer,
  type RasterEncoder,
} from '../../src/core/image-studio/export/export';

function sampleBuffer(width: number, height: number): RgbaBuffer {
  const buffer = createBuffer(width, height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    buffer.data[i] = 255;
    buffer.data[i + 1] = 0;
    buffer.data[i + 2] = 128;
    buffer.data[i + 3] = 255;
  }
  return buffer;
}

describe('image studio export pipeline', () => {
  describe('planExport', () => {
    it('plans a default PNG export at canvas size', () => {
      const plan = planExport({ width: 1920, height: 1080 }, { format: 'png' });
      expect(plan.width).toBe(1920);
      expect(plan.height).toBe(1080);
      expect(plan.mime).toBe('image/png');
      expect(plan.extension).toBe('png');
      expect(plan.preserveAlpha).toBe(true);
      expect(plan.quality).toBeNull();
    });

    it('applies a scale factor', () => {
      const plan = planExport({ width: 100, height: 50 }, { format: 'png', scale: 2 });
      expect(plan.width).toBe(200);
      expect(plan.height).toBe(100);
      expect(plan.upscale).toBe(true);
    });

    it('derives the missing dimension to preserve aspect ratio', () => {
      const plan = planExport({ width: 100, height: 50 }, { format: 'jpeg', width: 400 });
      expect(plan.width).toBe(400);
      expect(plan.height).toBe(200);
      expect(plan.scaleX).toBe(4);
      expect(plan.scaleY).toBe(4);
    });

    it('rejects quality on lossless formats', () => {
      expect(() => planExport({ width: 10, height: 10 }, { format: 'png', quality: 0.8 })).toThrow(
        /not applicable/
      );
    });

    it('accepts quality on lossy formats only', () => {
      const plan = planExport({ width: 10, height: 10 }, { format: 'webp', quality: 0.7 });
      expect(plan.quality).toBe(0.7);
    });

    it('rejects unknown formats and invalid dimensions', () => {
      expect(() => planExport({ width: 10, height: 10 }, { format: 'gif' as never })).toThrow(
        /Unsupported export format/
      );
      expect(() => planExport({ width: 10, height: 10 }, { format: 'png', scale: -1 })).toThrow(
        /scale must be positive/
      );
      expect(() => planExport({ width: 10, height: 10 }, { format: 'png', width: 0 })).toThrow(
        /at least 1px/
      );
    });

    it('caps dimensions at the supported maximum', () => {
      expect(() =>
        planExport({ width: 10, height: 10 }, { format: 'png', scale: 999999 })
      ).toThrow(/exceed the supported maximum/);
    });
  });

  describe('prepareBuffer', () => {
    it('resizes the buffer to the plan dimensions', () => {
      const buffer = sampleBuffer(10, 10);
      const plan = planExport({ width: 10, height: 10 }, { format: 'png', scale: 2 });
      const sized = prepareBuffer(buffer, plan);
      expect(sized.width).toBe(20);
      expect(sized.height).toBe(20);
    });

    it('returns the same buffer when dimensions match', () => {
      const buffer = sampleBuffer(10, 10);
      const plan = planExport({ width: 10, height: 10 }, { format: 'png' });
      expect(prepareBuffer(buffer, plan)).toBe(buffer);
    });
  });

  describe('pure encoders', () => {
    it('encodes a valid BMP with header magic and declared size', () => {
      const buffer = sampleBuffer(4, 4);
      const bytes = encodeBmp(buffer);
      expect(bytes[0]).toBe(0x42);
      expect(bytes[1]).toBe(0x4d);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(2, true)).toBe(bytes.length);
      expect(view.getUint32(18, true)).toBe(4);
      expect(view.getUint32(22, true)).toBe(4);
      expect(bytes.length).toBe(14 + 40 + 4 * (4 * 4 + 0));
    });

    it('encodes a PNG with signature and IHDR/IDAT/IEND chunks', () => {
      const buffer = sampleBuffer(3, 2);
      const bytes = encodePng(buffer);
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < signature.length; i++) expect(bytes[i]).toBe(signature[i]);
      const text = String.fromCharCode(...bytes.subarray(12, 16));
      expect(text).toBe('IHDR');
      const width = new DataView(bytes.buffer).getUint32(16);
      const height = new DataView(bytes.buffer).getUint32(20);
      expect(width).toBe(3);
      expect(height).toBe(2);
      expect(bytes[24]).toBe(8); // bit depth
      expect(bytes[25]).toBe(6); // RGBA
    });

    it('round-trips the IDAT payload: decompressed raw bytes match the buffer', async () => {
      const { inflateSync } = await import('node:zlib');
      const buffer = sampleBuffer(3, 2);
      const bytes = encodePng(buffer);
      let offset = 8;
      let idat: Uint8Array | null = null;
      while (offset < bytes.length) {
        const length = new DataView(bytes.buffer).getUint32(offset);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === 'IDAT') idat = bytes.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
      }
      expect(idat).not.toBeNull();
      const raw = inflateSync(idat as Uint8Array);
      expect(raw.length).toBe(2 * (1 + 3 * 4));
      expect(raw[0]).toBe(0); // filter type none on first row
      for (let i = 0; i < 3 * 4; i++) expect(raw[1 + i]).toBe(buffer.data[i]);
    });

    it('produces deterministic PNG output for identical input', () => {      const a = encodePng(sampleBuffer(8, 8));
      const b = encodePng(sampleBuffer(8, 8));
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('produces different PNG output for different pixels', () => {
      const a = encodePng(sampleBuffer(8, 8));
      const different = createBuffer(8, 8);
      const b = encodePng(different);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });

    it('embeds the raster as an SVG data URL image', () => {
      const buffer = sampleBuffer(2, 2);
      const plan = planExport({ width: 2, height: 2 }, { format: 'svg' });
      const bytes = encodeSvg(buffer, plan);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('<svg');
      expect(text).toContain('data:image/png;base64,');
      expect(text).toContain('width="2" height="2"');
    });
  });

  describe('dataUrlOf and exportBuffer', () => {
    it('builds a base64 data URL from encoded bytes', () => {
      const url = dataUrlOf(new TextEncoder().encode('hello'), 'text/plain');
      expect(url.startsWith('data:text/plain;base64,')).toBe(true);
      expect(atob(url.split(',')[1])).toBe('hello');
    });

    it('exports through an injected encoder', async () => {
      const encoder: RasterEncoder = {
        async encode(buffer) {
          return encodePng(buffer);
        },
      };
      const result = await exportBuffer(sampleBuffer(8, 8), { format: 'png' }, encoder);
      expect(result.extension).toBe('png');
      expect(result.mime).toBe('image/png');
      expect(result.bytes.length).toBeGreaterThan(0);
    });

    it('reports metadata without leaking secrets', () => {
      const document = createImageStudioDocument({ width: 64, height: 64, title: 'Demo' });
      const plan = planExport(document.canvas, { format: 'png' });
      const metadata = buildExportMetadata(document, plan);
      expect(metadata.title).toBe('Demo');
      expect(metadata.width).toBe(64);
      expect(metadata.provenanceCount).toBe(0);
      expect(metadata.format).toBe('png');
    });
  });
});
