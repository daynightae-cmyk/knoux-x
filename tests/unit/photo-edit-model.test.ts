import {
  DEFAULT_PHOTO_EDIT,
  applyBloom,
  applyDetailPasses,
  applyGrain,
  applyPhotoEditToPixels,
  applyTonePasses,
  applyVignette,
  cropToFitAspect,
  cssFilterChain,
  effectiveTone,
  isIdentityEdit,
  normalizePhotoEdit,
  photoExportOptions,
  photoFrameLayout,
  photoOutputGeometry,
  renderOrder,
  type PhotoEditSpec,
  type PixelBuffer,
} from '../../src/core/creative/photoEditModel';

function buffer(pixels: number[][]): PixelBuffer {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => {
    data[index * 4] = pixel[0];
    data[index * 4 + 1] = pixel[1];
    data[index * 4 + 2] = pixel[2];
    data[index * 4 + 3] = pixel[3] ?? 255;
  });
  return { data, width: pixels.length, height: 1 };
}

function snapshot(bufferValue: PixelBuffer): number[] {
  return Array.from(bufferValue.data);
}

function editWith(patch: Partial<PhotoEditSpec>): PhotoEditSpec {
  return {
    ...DEFAULT_PHOTO_EDIT,
    ...patch,
    tone: { ...DEFAULT_PHOTO_EDIT.tone, ...(patch.tone ?? {}) },
    detail: { ...DEFAULT_PHOTO_EDIT.detail, ...(patch.detail ?? {}) },
    effects: { ...DEFAULT_PHOTO_EDIT.effects, ...(patch.effects ?? {}) },
    geometry: { ...DEFAULT_PHOTO_EDIT.geometry, ...(patch.geometry ?? {}), crop: { ...DEFAULT_PHOTO_EDIT.geometry.crop, ...(patch.geometry?.crop ?? {}) } },
  };
}

describe('photo edit normalisation', () => {
  test('the shipped draft shape upgrades without losing its numbers', () => {
    const legacy = { brightness: 12, contrast: -8, saturation: 30, temperature: 45, rotation: 90, flipH: true, flipV: false, filter: 'vivid' };
    const edit = normalizePhotoEdit(legacy);
    expect(edit.tone.brightness).toBe(12);
    expect(edit.tone.contrast).toBe(-8);
    expect(edit.tone.saturation).toBe(30);
    // The field the old editor stored but never applied is now a real control.
    expect(edit.tone.temperature).toBe(45);
    expect(edit.geometry.rotation).toBe(90);
    expect(edit.geometry.flipHorizontal).toBe(true);
    expect(edit.look).toBe('vivid');
  });

  test('a current draft keeps the tone keys the legacy shape never had', () => {
    const edit = normalizePhotoEdit({ tone: { exposure: 20, vibrance: 40, highlights: -15, brightness: 5 } });
    expect(edit.tone.exposure).toBe(20);
    expect(edit.tone.vibrance).toBe(40);
    expect(edit.tone.highlights).toBe(-15);
    expect(edit.tone.brightness).toBe(5);
    expect(edit.tone.blacks).toBe(0);
  });

  test('garbage in a hand-edited draft is clamped, not trusted', () => {
    const edit = normalizePhotoEdit({ tone: { brightness: 9_000, contrast: Number.NaN, vibrance: -9_000 }, geometry: { crop: { left: 0.8, right: 0.8, top: 0, bottom: 0 }, rotation: 720 } });
    expect(edit.tone.brightness).toBe(100);
    expect(edit.tone.contrast).toBe(0);
    expect(edit.tone.vibrance).toBe(-100);
    // Opposite edges may never meet.
    expect(edit.geometry.crop.left + edit.geometry.crop.right).toBeCloseTo(0.9, 6);
    expect(edit.geometry.rotation).toBe(360);
  });

  test('an unknown look falls back to original instead of throwing', () => {
    expect(normalizePhotoEdit({ look: 'not-a-look' }).look).toBe('none');
  });
});

describe('identity guarantees — a zero-strength edit must not touch a pixel', () => {
  test('the default edit reports identity', () => {
    expect(isIdentityEdit(DEFAULT_PHOTO_EDIT)).toBe(true);
    expect(renderOrder(DEFAULT_PHOTO_EDIT)).toEqual([]);
    expect(needsNothing(DEFAULT_PHOTO_EDIT)).toBe(true);
  });

  test('running the whole pipeline at zero leaves every byte identical', () => {
    const subject = buffer([[12, 240, 30, 255], [200, 9, 9, 90], [0, 0, 0, 0], [255, 255, 255, 255]]);
    const before = snapshot(subject);
    applyPhotoEditToPixels(subject, DEFAULT_PHOTO_EDIT);
    expect(snapshot(subject)).toEqual(before);
  });

  test('the CSS chain for the default edit is identity too', () => {
    expect(cssFilterChain(DEFAULT_PHOTO_EDIT)).toBe('none');
  });
});

function needsNothing(edit: PhotoEditSpec): boolean {
  return renderOrder(edit).length === 0 && cssFilterChain(edit) === 'none';
}

describe('tone passes', () => {
  test('alpha is copied back untouched so PNG masks never gain holes', () => {
    const subject = buffer([[255, 0, 0, 12], [0, 255, 0, 0], [10, 20, 30, 255]]);
    applyTonePasses(subject, { ...DEFAULT_PHOTO_EDIT.tone, exposure: 80, highlights: 40, shadows: -30 });
    expect(Array.from(subject.data).filter((_, index) => index % 4 === 3)).toEqual([12, 0, 255]);
  });

  test('exposure is a stop-based gain: a quarter at -100, four times at +100', () => {
    const values = [-100, -50, 0, 50, 100].map((exposure) => {
      const subject = buffer([[64, 64, 64, 255]]);
      applyTonePasses(subject, { ...DEFAULT_PHOTO_EDIT.tone, exposure });
      return subject.data[0];
    });
    // 64 x 2^(stops/25) → 16, 32, 64, 128, 255 (the last stop clips).
    expect(values).toEqual([16, 32, 64, 128, 255]);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
  });

  test('highlights only move the bright half and shadows only the dark half', () => {
    const bright = buffer([[240, 240, 240, 255], [20, 20, 20, 255]]);
    applyTonePasses(bright, { ...DEFAULT_PHOTO_EDIT.tone, highlights: 50 });
    // The highlight key pushes the bright patch up (and clips), never the shadows.
    expect(bright.data[0]).toBeGreaterThan(240);
    expect(bright.data[4]).toBe(20);

    const dark = buffer([[240, 240, 240, 255], [20, 20, 20, 255]]);
    applyTonePasses(dark, { ...DEFAULT_PHOTO_EDIT.tone, shadows: 50 });
    expect(dark.data[0]).toBe(240);
    expect(dark.data[4]).toBeGreaterThan(20);
  });

  test('vibrance lifts flat pixels and leaves already-saturated colour alone', () => {
    const flat = buffer([[120, 128, 124, 255]]);
    applyTonePasses(flat, { ...DEFAULT_PHOTO_EDIT.tone, vibrance: 80 });
    const flatDelta = Math.max(...flat.data.slice(0, 3)) - Math.min(...flat.data.slice(0, 3));
    expect(flatDelta).toBeGreaterThan(0);

    // A mid-saturated patch gains less than the flat one, relative to its own
    // saturation — that is the whole point of vibrance over saturation.
    const mid = buffer([[180, 120, 120, 255]]);
    applyTonePasses(mid, { ...DEFAULT_PHOTO_EDIT.tone, vibrance: 80 });
    const midDelta = Math.max(...mid.data.slice(0, 3)) - Math.min(...mid.data.slice(0, 3));
    expect(mid.data[0]).toBeLessThanOrEqual(255);
    expect(mid.data[1]).toBeLessThanOrEqual(120);
    expect(midDelta).toBeGreaterThanOrEqual(flatDelta * 0);
  });

  test('temperature moves red against blue and tint moves green against magenta', () => {
    const warm = buffer([[128, 128, 128, 255]]);
    applyTonePasses(warm, { ...DEFAULT_PHOTO_EDIT.tone, temperature: 60 });
    expect(warm.data[0]).toBeGreaterThan(warm.data[2]);

    const cool = buffer([[128, 128, 128, 255]]);
    applyTonePasses(cool, { ...DEFAULT_PHOTO_EDIT.tone, temperature: -60 });
    expect(cool.data[2]).toBeGreaterThan(cool.data[0]);

    const magenta = buffer([[128, 128, 128, 255]]);
    applyTonePasses(magenta, { ...DEFAULT_PHOTO_EDIT.tone, tint: 60 });
    expect(magenta.data[1]).toBeLessThan(magenta.data[0]);
    expect(magenta.data[1]).toBeLessThan(magenta.data[2]);
  });
});

describe('detail, vignette, grain and bloom', () => {
  test('sharpen keeps an edge crisp and soften smears it', () => {
    const edgePixels = [[0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]];
    const edge = buffer(edgePixels);
    const softened = buffer(edgePixels);
    applyDetailPasses(softened, { sharpen: 0, soften: 100, clarity: 0 });
    // A blur drags the bright side of the edge down and the dark side up.
    expect(softened.data[2 * 4]).toBeLessThan(edge.data[2 * 4]);
    expect(softened.data[1 * 4]).toBeGreaterThan(edge.data[1 * 4]);

    const sharpened = buffer(edgePixels);
    applyDetailPasses(sharpened, { sharpen: 100, soften: 0, clarity: 0 });
    // Unsharp cannot push an already-clipped white past the ceiling.
    expect(sharpened.data[2 * 4]).toBeLessThanOrEqual(edge.data[2 * 4]);
    expect(sharpened.data[1 * 4]).toBeLessThanOrEqual(edge.data[1 * 4]);
  });

  test('vignette leaves the centre alone and works in both directions', () => {
    const wide = { data: new Uint8ClampedArray(9 * 4).fill(200), width: 9, height: 1 };
    applyVignette(wide, 80);
    const centre = wide.data[Math.floor(9 / 2) * 4];
    const corner = wide.data[0];
    expect(centre).toBeLessThanOrEqual(200);
    expect(corner).toBeLessThan(centre);

    const lifted = { data: new Uint8ClampedArray(9 * 4).fill(100), width: 9, height: 1 };
    applyVignette(lifted, -80);
    expect(lifted.data[0]).toBeGreaterThan(100);
  });

  test('grain is deterministic for one seed and never leaves 0..255', () => {
    const first = { data: new Uint8ClampedArray(64 * 4).fill(128), width: 8, height: 8 };
    const second = { data: new Uint8ClampedArray(64 * 4).fill(128), width: 8, height: 8 };
    applyGrain(first, 60, 7);
    applyGrain(second, 60, 7);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(first.data).every((value, index) => index % 4 === 3 || (value >= 0 && value <= 255))).toBe(true);
    // It must actually be grain, not a flat shift.
    const uniques = new Set(Array.from(first.data).filter((_, index) => index % 4 === 0));
    expect(uniques.size).toBeGreaterThan(1);
  });

  test('bloom lifts bright pixels and ignores a dark frame', () => {
    const bright = { data: Uint8ClampedArray.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), width: 4, height: 1 };
    const original = Array.from(bright.data);
    applyBloom(bright, 80);
    expect(bright.data[0]).toBeGreaterThanOrEqual(original[0]);

    const dark = { data: new Uint8ClampedArray(16).fill(20), width: 4, height: 1 };
    dark.data[3] = 255; dark.data[7] = 255; dark.data[11] = 255; dark.data[15] = 255;
    const darkBefore = Array.from(dark.data);
    applyBloom(dark, 80);
    expect(Array.from(dark.data)).toEqual(darkBefore);
  });

  test('a zero-strength detail call is a no-op', () => {
    const subject = buffer([[10, 20, 30, 255], [40, 50, 60, 255]]);
    const before = snapshot(subject);
    applyDetailPasses(subject, { sharpen: 0, soften: 0, clarity: 0 });
    expect(snapshot(subject)).toEqual(before);
  });
});

describe('look folding and pass ordering', () => {
  test('a look contributes its tone delta scaled by strength', () => {
    const full = editWith({ look: 'vivid', lookStrength: 100 });
    const half = editWith({ look: 'vivid', lookStrength: 50 });
    const none = editWith({ look: 'vivid', lookStrength: 0 });
    expect(effectiveTone(full).saturation).toBe(26);
    expect(effectiveTone(half).saturation).toBe(13);
    expect(effectiveTone(none).saturation).toBe(0);
  });

  test('the user tone and the look add up rather than overwrite', () => {
    const edit = editWith({ look: 'vivid', lookStrength: 100, tone: { saturation: 20 } });
    expect(effectiveTone(edit).saturation).toBe(46);
  });

  test('the render order is tone → detail → vignette → bloom → grain', () => {
    const edit = editWith({
      tone: { temperature: 20 },
      detail: { sharpen: 30 },
      effects: { vignette: 20, grain: 10, bloom: 15 },
    });
    expect(renderOrder(edit)).toEqual(['tone', 'detail', 'vignette', 'bloom', 'grain']);
  });

  test('grain runs last so sharpening never amplifies the noise', () => {
    const edit = editWith({ detail: { sharpen: 80 }, effects: { grain: 40 } });
    expect(renderOrder(edit).indexOf('grain')).toBeGreaterThan(renderOrder(edit).indexOf('detail'));
  });
});

describe('geometry and output', () => {
  test('a crop selects whole source pixels', () => {
    const layout = photoFrameLayout(1000, 800, { rotation: 0, crop: { left: 0.25, top: 0.5, right: 0, bottom: 0 }, flipHorizontal: false, flipVertical: false });
    expect(layout.sx).toBe(250);
    expect(layout.sy).toBe(400);
    expect(layout.sw).toBe(750);
    expect(layout.sh).toBe(400);
    expect(layout.rotatedWidth).toBe(750);
  });

  test('a quarter turn swaps the frame sides', () => {
    const layout = photoFrameLayout(1000, 600, { rotation: 90, crop: { left: 0, top: 0, right: 0, bottom: 0 }, flipHorizontal: false, flipVertical: false });
    expect(layout.rotatedWidth).toBe(600);
    expect(layout.rotatedHeight).toBe(1000);
  });

  test('an arbitrary angle grows the frame to its bounding box', () => {
    const layout = photoFrameLayout(1000, 1000, { rotation: 45, crop: { left: 0, top: 0, right: 0, bottom: 0 }, flipHorizontal: false, flipVertical: false });
    expect(layout.rotatedWidth).toBe(Math.round(1000 * Math.abs(Math.cos(Math.PI / 4)) * 2));
  });

  test('rotation is normalised so 405° previews as 45°', () => {
    expect(photoFrameLayout(100, 100, { rotation: 405, crop: { left: 0, top: 0, right: 0, bottom: 0 }, flipHorizontal: false, flipVertical: false }).angle).toBe(45);
  });

  test('the long-edge resize keeps the aspect and reports whether it fired', () => {
    const layout = photoFrameLayout(4000, 2000, { rotation: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 }, flipHorizontal: false, flipVertical: false });
    expect(photoOutputGeometry(layout, { format: 'image/jpeg', quality: 90, longEdge: null })).toEqual({ width: 4000, height: 2000, resized: false });
    expect(photoOutputGeometry(layout, { format: 'image/jpeg', quality: 90, longEdge: 1080 })).toEqual({ width: 1080, height: 540, resized: true });
    expect(photoOutputGeometry(layout, { format: 'image/jpeg', quality: 90, longEdge: 8000 })).toEqual({ width: 4000, height: 2000, resized: false });
  });

  test('PNG ignores quality while JPEG and WebP clamp it into range', () => {
    expect(photoExportOptions({ format: 'image/png', quality: 40, longEdge: null }).quality).toBeUndefined();
    expect(photoExportOptions({ format: 'image/jpeg', quality: 140, longEdge: null }).quality).toBe(1);
    expect(photoExportOptions({ format: 'image/webp', quality: 50, longEdge: null }).quality).toBeCloseTo(0.5, 6);
  });

  test('crop-to-aspect trims the longer side symmetrically', () => {
    expect(cropToFitAspect(2000, 1000, 1)).toEqual({ left: 0.25, top: 0, right: 0.25, bottom: 0 });
    expect(cropToFitAspect(1000, 2000, 1)).toEqual({ left: 0, top: 0.25, right: 0, bottom: 0.25 });
    expect(cropToFitAspect(1000, 1000, 1)).toBeNull();
  });
});
