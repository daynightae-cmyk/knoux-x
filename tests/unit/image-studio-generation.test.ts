import { createImageStudioDocument } from '../../src/core/image-studio/document/document';
import { createBuffer, type RgbaBuffer } from '../../src/core/image-studio/raster/compositor';
import {
  addGeneratedLayer,
  buildGenerationRequest,
  composeMaskedRegion,
  createGeneratedAILayer,
  registerProvenance,
  setProvenanceAccepted,
} from '../../src/core/image-studio/ai/generation';

describe('image studio AI generation layers', () => {
  describe('buildGenerationRequest', () => {
    it('builds a validated text-to-image request with defaults', () => {
      const request = buildGenerationRequest({
        task: 'text-to-image',
        modelId: 'black-forest-labs/flux-schnell',
        prompt: '  a neon city at night  ',
      });
      expect(request.prompt).toBe('a neon city at night');
      expect(request.modelId).toBe('black-forest-labs/flux-schnell');
      expect(request.width).toBe(1024);
      expect(request.height).toBe(1024);
      expect(request.maskAssetId).toBeNull();
      expect(request.sourceAssetId).toBeNull();
    });

    it('rejects an unknown model', () => {
      expect(() =>
        buildGenerationRequest({ task: 'text-to-image', modelId: 'nope/nope', prompt: 'x' })
      ).toThrow(/Unknown image model/);
    });

    it('rejects a model that does not support the task', () => {
      expect(() =>
        buildGenerationRequest({
          task: 'upscaling',
          modelId: 'black-forest-labs/flux-schnell',
          prompt: 'x',
        })
      ).toThrow(/does not support task/);
    });

    it('requires a source image for image-to-image style tasks', () => {
      expect(() =>
        buildGenerationRequest({ task: 'inpainting', modelId: 'knoux-mock-image', prompt: 'x', maskAssetId: 'm1' })
      ).toThrow(/requires a source image/);
    });

    it('requires a mask for inpainting and outpainting', () => {
      expect(() =>
        buildGenerationRequest({
          task: 'inpainting',
          modelId: 'knoux-mock-image',
          prompt: 'x',
          sourceAssetId: 'a1',
        })
      ).toThrow(/requires a mask/);
    });

    it('enforces the model resolution ceiling', () => {
      expect(() =>
        buildGenerationRequest({
          task: 'text-to-image',
          modelId: 'black-forest-labs/flux-schnell',
          prompt: 'x',
          width: 4096,
          height: 4096,
        })
      ).toThrow(/exceeds the model maximum/);
    });

    it('rejects an empty prompt', () => {
      expect(() =>
        buildGenerationRequest({ task: 'text-to-image', modelId: 'knoux-mock-image', prompt: '   ' })
      ).toThrow(/must not be empty/);
    });

    it('normalizes negative prompt and passes through seed', () => {
      const request = buildGenerationRequest({
        task: 'text-to-image',
        modelId: 'knoux-mock-image',
        prompt: 'sunset',
        negativePrompt: '  blur  ',
        seed: 42,
      });
      expect(request.negativePrompt).toBe('blur');
      expect(request.seed).toBe(42);
    });
  });

  describe('provenance registry', () => {
    it('registers a provenance entry and keeps the document immutable', () => {
      const original = createImageStudioDocument({ width: 64, height: 64 });
      const result = registerProvenance(original, {
        provider: 'mock',
        modelId: 'knoux-mock-image',
        task: 'text-to-image',
        prompt: 'forest',
        costClassification: 'free',
      });
      expect(original.aiProvenance).toHaveLength(0);
      expect(result.document.aiProvenance).toHaveLength(1);
      expect(result.provenance.accepted).toBeNull();
      expect(result.provenance.costClassification).toBe('free');
    });

    it('rejects duplicate provenance ids', () => {
      let doc = createImageStudioDocument({ width: 64, height: 64 });
      doc = registerProvenance(doc, {
        id: 'prov-1',
        provider: 'mock',
        modelId: 'knoux-mock-image',
        task: 'text-to-image',
        prompt: 'x',
      }).document;
      expect(() =>
        registerProvenance(doc, {
          id: 'prov-1',
          provider: 'mock',
          modelId: 'knoux-mock-image',
          task: 'text-to-image',
          prompt: 'y',
        })
      ).toThrow(/already exists/);
    });
  });

  describe('generated AI layers', () => {
    it('creates a generated-ai layer referencing provenance', () => {
      const layer = createGeneratedAILayer({ provenanceId: 'prov-9', name: 'Portrait' });
      expect(layer.kind).toBe('generated-ai');
      expect(layer.provenanceId).toBe('prov-9');
      expect(layer.opacity).toBe(1);
    });

    it('rejects an empty provenance reference', () => {
      expect(() => createGeneratedAILayer({ provenanceId: '  ' })).toThrow(/AI provenance ID/);
    });

    it('adds a generated layer only when provenance exists', () => {
      let doc = createImageStudioDocument({ width: 64, height: 64 });
      const { document } = registerProvenance(doc, {
        id: 'prov-a',
        provider: 'mock',
        modelId: 'knoux-mock-image',
        task: 'text-to-image',
        prompt: 'x',
      });
      doc = document;
      const layer = createGeneratedAILayer({ provenanceId: 'prov-a' });
      doc = addGeneratedLayer(doc, layer);
      expect(doc.layers).toHaveLength(1);
      expect(() => addGeneratedLayer(doc, createGeneratedAILayer({ provenanceId: 'prov-missing' }))).toThrow(
        /references missing provenance/
      );
    });

    it('marks provenance as accepted or rejected', () => {
      let doc = createImageStudioDocument({ width: 64, height: 64 });
      const { document } = registerProvenance(doc, {
        id: 'prov-b',
        provider: 'mock',
        modelId: 'knoux-mock-image',
        task: 'text-to-image',
        prompt: 'x',
      });
      doc = document;
      doc = setProvenanceAccepted(doc, 'prov-b', true);
      expect(doc.aiProvenance[0].accepted).toBe(true);
      expect(() => setProvenanceAccepted(doc, 'prov-nope', true)).toThrow(/Unknown AI provenance/);
    });
  });

  describe('composeMaskedRegion', () => {
    function solid(color: number, size: number): RgbaBuffer {
      const buffer = createBuffer(size, size);
      for (let i = 0; i < buffer.data.length; i += 4) {
        buffer.data[i] = color;
        buffer.data[i + 1] = color;
        buffer.data[i + 2] = color;
        buffer.data[i + 3] = 255;
      }
      return buffer;
    }

    function whiteMask(size: number, start: number, end: number): RgbaBuffer {
      const buffer = createBuffer(size, size);
      for (let i = 0; i < buffer.data.length; i += 4) {
        const x = (i / 4) % size;
        const coverage = x >= start && x < end ? 255 : 0;
        buffer.data[i] = coverage;
        buffer.data[i + 1] = coverage;
        buffer.data[i + 2] = coverage;
        buffer.data[i + 3] = 255;
      }
      return buffer;
    }

    it('keeps source pixels where the mask is black', () => {
      const source = solid(10, 8);
      const generated = solid(200, 8);
      const mask = createBuffer(8, 8);
      const out = composeMaskedRegion({ source, generated, mask });
      expect(out.data[0]).toBe(10);
    });

    it('replaces pixels fully covered by the mask', () => {
      const source = solid(10, 8);
      const generated = solid(200, 8);
      const mask = createBuffer(8, 8);
      for (let i = 0; i < mask.data.length; i += 4) {
        mask.data[i] = 255;
        mask.data[i + 1] = 255;
        mask.data[i + 2] = 255;
        mask.data[i + 3] = 255;
      }
      const out = composeMaskedRegion({ source, generated, mask });
      expect(out.data[0]).toBe(200);
    });

    it('mixes 50% coverage to the midpoint color', () => {
      const source = solid(0, 8);
      const generated = solid(100, 8);
      const mask = createBuffer(8, 8);
      for (let i = 0; i < mask.data.length; i += 4) {
        mask.data[i] = 128;
        mask.data[i + 1] = 128;
        mask.data[i + 2] = 128;
        mask.data[i + 3] = 255;
      }
      const out = composeMaskedRegion({ source, generated, mask });
      expect(out.data[0]).toBeGreaterThan(45);
      expect(out.data[0]).toBeLessThan(55);
    });

    it('inverts the mask when requested', () => {
      const source = solid(10, 8);
      const generated = solid(200, 8);
      const mask = whiteMask(8, 0, 4);
      const out = composeMaskedRegion({ source, generated, mask, invert: true });
      expect(out.data[0]).toBe(10);
      expect(out.data[(4 * 8 + 4) * 4]).toBe(200);
    });

    it('applies the mask regionally (left half replaced, right half kept)', () => {
      const source = solid(10, 8);
      const generated = solid(200, 8);
      const mask = whiteMask(8, 0, 4);
      const out = composeMaskedRegion({ source, generated, mask });
      expect(out.data[0]).toBe(200);
      expect(out.data[(4 * 8 + 4) * 4]).toBe(10);
    });

    it('rejects mismatched dimensions', () => {
      const source = solid(10, 8);
      const generated = solid(200, 16);
      const mask = createBuffer(8, 8);
      expect(() => composeMaskedRegion({ source, generated, mask })).toThrow(/must match in dimensions/);
    });
  });
});
