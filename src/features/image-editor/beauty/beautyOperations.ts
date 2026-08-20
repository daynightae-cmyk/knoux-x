/**
 * KNOUX-X — BEAUTY / RETOUCH IMAGE OPERATIONS
 *
 * Pure, deterministic, local image processing functions.
 * All operations work on ImageData (Uint8ClampedArray RGBA).
 * No network, no AI, no DOM access — fully testable in Node.
 */

/** Deep-clone an ImageData without sharing the underlying buffer. */
export function cloneImageData(imageData: ImageData): ImageData {
  const copy = new Uint8ClampedArray(imageData.data);
  return new ImageData(copy, imageData.width, imageData.height);
}

/** Create a blank ImageData filled with transparent black. */
function createBlank(width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
}

/** Clamp a value to [0, 255]. */
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ═══════════════════════════════════════════════════════════════════════════
// Skin Smoothing (bilateral-filter approximation)
// ═══════════════════════════════════════════════════════════════════════════

export function skinSmoothing(
  imageData: ImageData,
  strength: number,
  mask?: ImageData,
): ImageData {
  const { width, height, data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;
  const radius = Math.max(1, Math.round(strength * 8));
  const threshold = 40 - strength * 25; // edge preservation

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (mask && mask.data[idx + 3] === 0) continue;

      let sumR = 0, sumG = 0, sumB = 0, totalWeight = 0;
      const centerR = data[idx], centerG = data[idx + 1], centerB = data[idx + 2];

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = (ny * width + nx) * 4;
          const dr = data[nIdx] - centerR, dg = data[nIdx + 1] - centerG, db = data[nIdx + 2] - centerB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          const spatialWeight = 1 / (1 + (dx * dx + dy * dy) / (radius * radius));
          const rangeWeight = dist < threshold ? 1 : 0.1;
          const weight = spatialWeight * rangeWeight;
          sumR += data[nIdx] * weight;
          sumG += data[nIdx + 1] * weight;
          sumB += data[nIdx + 2] * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight > 0) {
        out[idx] = clamp(sumR / totalWeight);
        out[idx + 1] = clamp(sumG / totalWeight);
        out[idx + 2] = clamp(sumB / totalWeight);
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Guided Skin Smooth and manual Patch Heal
// ═══════════════════════════════════════════════════════════════════════════

function boxMean(values: Float32Array, width: number, height: number, radius: number, shouldAbort?: () => boolean): Float32Array {
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    if (shouldAbort?.()) return output;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.max(0, Math.min(width - 1, x))];
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      sum += values[y * width + Math.min(width - 1, x + radius + 1)] - values[y * width + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    if (shouldAbort?.()) return output;
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / (radius * 2 + 1);
      sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x] - horizontal[Math.max(0, y - radius) * width + x];
    }
  }
  return output;
}

/** Fast guided smoothing for a bounded preview or ROI, retaining source texture. */
export function guidedSkinSmooth(
  imageData: ImageData,
  strength: number,
  texturePreserve = 0.76,
  mask?: ImageData,
  shouldAbort?: () => boolean,
): ImageData {
  const { width, height, data } = imageData;
  const pixels = width * height;
  const radius = Math.max(1, Math.min(12, Math.round(2 + strength * 8)));
  const guide = new Float32Array(pixels);
  const guideSquared = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const index = pixel * 4;
    const value = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;
    guide[pixel] = value;
    guideSquared[pixel] = value * value;
  }
  if (shouldAbort?.()) return cloneImageData(imageData);
  const meanGuide = boxMean(guide, width, height, radius, shouldAbort);
  if (shouldAbort?.()) return cloneImageData(imageData);
  const meanGuideSquared = boxMean(guideSquared, width, height, radius, shouldAbort);
  if (shouldAbort?.()) return cloneImageData(imageData);
  const variance = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel++) variance[pixel] = meanGuideSquared[pixel] - meanGuide[pixel] * meanGuide[pixel];

  const result = cloneImageData(imageData);
  const blend = Math.max(0, Math.min(1, strength)) * (1 - Math.max(0, Math.min(0.95, texturePreserve)));
  for (let channel = 0; channel < 3; channel++) {
    if (shouldAbort?.()) return result;
    const source = new Float32Array(pixels);
    const guideProduct = new Float32Array(pixels);
    for (let pixel = 0; pixel < pixels; pixel++) {
      const value = data[pixel * 4 + channel] / 255;
      source[pixel] = value;
      guideProduct[pixel] = guide[pixel] * value;
    }
    const meanSource = boxMean(source, width, height, radius, shouldAbort);
    if (shouldAbort?.()) return result;
    const meanProduct = boxMean(guideProduct, width, height, radius, shouldAbort);
    if (shouldAbort?.()) return result;
    const coefficientA = new Float32Array(pixels);
    const coefficientB = new Float32Array(pixels);
    for (let pixel = 0; pixel < pixels; pixel++) {
      coefficientA[pixel] = (meanProduct[pixel] - meanGuide[pixel] * meanSource[pixel]) / (variance[pixel] + 0.004);
      coefficientB[pixel] = meanSource[pixel] - coefficientA[pixel] * meanGuide[pixel];
    }
    const meanA = boxMean(coefficientA, width, height, radius, shouldAbort);
    if (shouldAbort?.()) return result;
    const meanB = boxMean(coefficientB, width, height, radius, shouldAbort);
    if (shouldAbort?.()) return result;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if ((pixel & 0x3FFF) === 0 && shouldAbort?.()) return result;
      const index = pixel * 4;
      if (mask && mask.data[index + 3] === 0) continue;
      const alpha = blend * (mask ? mask.data[index + 3] / 255 : 1);
      const filtered = (meanA[pixel] * guide[pixel] + meanB[pixel]) * 255;
      result.data[index + channel] = clamp(lerp(data[index + channel], filtered, alpha));
    }
  }
  return result;
}

export interface PatchHealRequest {
  targetX: number;
  targetY: number;
  sourceX: number;
  sourceY: number;
  radius: number;
  feather?: number;
}

/** Copies a user-selected nearby patch through a feathered circular mask. */
export function patchHeal(imageData: ImageData, request: PatchHealRequest, mask?: ImageData, shouldAbort?: () => boolean): ImageData {
  const result = cloneImageData(imageData);
  const radius = Math.max(1, Math.round(request.radius));
  const feather = Math.max(0.05, Math.min(1, request.feather ?? 0.75));
  for (let y = -radius; y <= radius; y++) {
    if (shouldAbort?.()) return result;
    for (let x = -radius; x <= radius; x++) {
      const distance = Math.hypot(x, y) / radius;
      if (distance > 1) continue;
      const targetX = Math.round(request.targetX + x);
      const targetY = Math.round(request.targetY + y);
      const sourceX = Math.round(request.sourceX + x);
      const sourceY = Math.round(request.sourceY + y);
      if (targetX < 0 || targetY < 0 || targetX >= imageData.width || targetY >= imageData.height || sourceX < 0 || sourceY < 0 || sourceX >= imageData.width || sourceY >= imageData.height) continue;
      const targetIndex = (targetY * imageData.width + targetX) * 4;
      if (mask && mask.data[targetIndex + 3] === 0) continue;
      const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
      const alpha = Math.pow(1 - distance, feather) * (mask ? mask.data[targetIndex + 3] / 255 : 1);
      for (let channel = 0; channel < 3; channel++) result.data[targetIndex + channel] = clamp(lerp(imageData.data[targetIndex + channel], imageData.data[sourceIndex + channel], alpha));
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blemish Removal
// ═══════════════════════════════════════════════════════════════════════════

export function blemishRemoval(
  imageData: ImageData,
  radius: number,
  threshold: number,
  mask?: ImageData,
): ImageData {
  const { width, height, data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (mask && mask.data[idx + 3] === 0) continue;

      const centerR = data[idx], centerG = data[idx + 1], centerB = data[idx + 2];
      const neighbors: number[] = [];
      let totalDiff = 0, count = 0;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = (ny * width + nx) * 4;
          const dr = data[nIdx] - centerR, dg = data[nIdx + 1] - centerG, db = data[nIdx + 2] - centerB;
          totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
          neighbors.push(data[nIdx], data[nIdx + 1], data[nIdx + 2]);
          count++;
        }
      }

      const avgDiff = count > 0 ? totalDiff / count : 0;
      if (avgDiff > threshold * 2) {
        // This pixel is a blemish — replace with median of neighbors
        if (neighbors.length >= 3) {
          const rs = neighbors.filter((_, i) => i % 3 === 0).sort((a, b) => a - b);
          const gs = neighbors.filter((_, i) => i % 3 === 1).sort((a, b) => a - b);
          const bs = neighbors.filter((_, i) => i % 3 === 2).sort((a, b) => a - b);
          const mid = Math.floor(rs.length / 2);
          out[idx] = rs[mid];
          out[idx + 1] = gs[mid];
          out[idx + 2] = bs[mid];
        }
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Teeth Whitening
// ═══════════════════════════════════════════════════════════════════════════

export function teethWhitening(
  imageData: ImageData,
  strength: number,
  mask?: ImageData,
): ImageData {
  const { data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;

  for (let i = 0; i < data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Increase brightness and reduce yellow
    const brightness = lerp(1, 1.3, strength);
    const desaturate = lerp(1, 0.3, strength);
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    out[i] = clamp(lerp(r, gray, desaturate) * brightness);
    out[i + 1] = clamp(lerp(g, gray, desaturate) * brightness);
    out[i + 2] = clamp(lerp(b, gray * 1.05, desaturate) * brightness);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Red-Eye Removal
// ═══════════════════════════════════════════════════════════════════════════

export function redEyeRemoval(
  imageData: ImageData,
  mask?: ImageData,
): ImageData {
  const { data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;

  for (let i = 0; i < data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Detect red-dominant pixels
    if (r > 100 && r > g * 1.5 && r > b * 1.5) {
      const gray = (g + b) / 2;
      out[i] = clamp(gray * 0.4);
      out[i + 1] = clamp(gray * 0.6);
      out[i + 2] = clamp(gray * 0.8);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Skin Tone Adjustment
// ═══════════════════════════════════════════════════════════════════════════

export function skinToneAdjustment(
  imageData: ImageData,
  warmth: number,
  brightness: number,
  mask?: ImageData,
): ImageData {
  const { data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;

  for (let i = 0; i < data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Warmth: shift red up, blue down
    const wr = clamp(r + warmth * 15);
    const wg = clamp(g + warmth * 5);
    const wb = clamp(b - warmth * 15);
    // Brightness
    const factor = 1 + brightness * 0.3;
    out[i] = clamp(wr * factor);
    out[i + 1] = clamp(wg * factor);
    out[i + 2] = clamp(wb * factor);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sharpen (unsharp mask)
// ═══════════════════════════════════════════════════════════════════════════

export function sharpen(
  imageData: ImageData,
  strength: number,
  mask?: ImageData,
): ImageData {
  const { width, height, data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;
  const amount = strength * 2;

  // 3x3 Laplacian kernel
  const kernel = [0, -1, 0, -1, 4, -1, 0, -1, 0];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (mask && mask.data[idx + 3] === 0) continue;

      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nIdx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += data[nIdx] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        out[idx + c] = clamp(data[idx + c] + sum * amount);
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Color Adjust (saturation, contrast, brightness)
// ═══════════════════════════════════════════════════════════════════════════

export function colorAdjust(
  imageData: ImageData,
  saturation: number,
  contrast: number,
  brightness: number,
  mask?: ImageData,
): ImageData {
  const { data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;
  const satFactor = 1 + saturation;
  const contrastFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  const brightOffset = brightness * 50;

  for (let i = 0; i < data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // Saturation
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    r = clamp(lerp(gray, r, satFactor));
    g = clamp(lerp(gray, g, satFactor));
    b = clamp(lerp(gray, b, satFactor));

    // Contrast
    r = clamp((r - 128) * contrastFactor + 128);
    g = clamp((g - 128) * contrastFactor + 128);
    b = clamp((b - 128) * contrastFactor + 128);

    // Brightness
    out[i] = clamp(r + brightOffset);
    out[i + 1] = clamp(g + brightOffset);
    out[i + 2] = clamp(b + brightOffset);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Eye Enhancement
// ═══════════════════════════════════════════════════════════════════════════

export function eyeEnhancement(
  imageData: ImageData,
  strength: number,
  mask?: ImageData,
): ImageData {
  const { data } = imageData;
  const result = cloneImageData(imageData);
  const out = result.data;

  for (let i = 0; i < data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Increase local contrast and brightness
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const contrastBoost = 1 + strength * 0.3;
    const brightBoost = 1 + strength * 0.15;
    const satBoost = 1 + strength * 0.4;

    out[i] = clamp(lerp(gray, r, satBoost) * contrastBoost * brightBoost);
    out[i + 1] = clamp(lerp(gray, g, satBoost) * contrastBoost * brightBoost);
    out[i + 2] = clamp(lerp(gray, b, satBoost) * contrastBoost * brightBoost);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Liquify Warp (localized mesh deformation)
// ═══════════════════════════════════════════════════════════════════════════

export function liquifyWarp(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
  strength: number,
  mode: 'push' | 'pinch' | 'expand',
): ImageData {
  const { width, height, data } = imageData;
  const result = createBlank(width, height);
  const out = result.data;
  const r2 = radius * radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX, dy = y - centerY;
      const dist2 = dx * dx + dy * dy;
      const idx = (y * width + x) * 4;

      if (dist2 >= r2) {
        // Outside the brush — copy pixel directly
        out[idx] = data[idx];
        out[idx + 1] = data[idx + 1];
        out[idx + 2] = data[idx + 2];
        out[idx + 3] = data[idx + 3];
        continue;
      }

      // Inside the brush — compute displacement
      const dist = Math.sqrt(dist2);
      const factor = (1 - dist / radius) * strength;
      let sx: number, sy: number;

      if (mode === 'pinch') {
        // Pull toward center
        sx = x + dx * factor;
        sy = y + dy * factor;
      } else if (mode === 'expand') {
        // Push away from center
        sx = x - dx * factor;
        sy = y - dy * factor;
      } else {
        // Push: displace in a fixed direction (upward)
        sx = x;
        sy = y - factor * radius * 0.5;
      }

      // Bilinear interpolation
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const fx = sx - ix, fy = sy - iy;

      if (ix < 0 || ix >= width - 1 || iy < 0 || iy >= height - 1) {
        out[idx + 3] = 0; // transparent
        continue;
      }

      const tl = (iy * width + ix) * 4;
      const tr = (iy * width + ix + 1) * 4;
      const bl = ((iy + 1) * width + ix) * 4;
      const br = ((iy + 1) * width + ix + 1) * 4;

      for (let c = 0; c < 4; c++) {
        const top = lerp(data[tl + c], data[tr + c], fx);
        const bottom = lerp(data[bl + c], data[br + c], fx);
        out[idx + c] = clamp(lerp(top, bottom, fy));
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mask operations
// ═══════════════════════════════════════════════════════════════════════════

export function applyMask(
  _imageData: ImageData,
  mask: ImageData,
  feather: number,
): ImageData {
  const { width, height, data } = mask;
  const result = cloneImageData(mask);
  const out = result.data;
  const f = Math.max(0, Math.round(feather));

  if (f === 0) return result;

  // Box-blur the mask alpha channel for feathering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -f; dy <= f; dy++) {
        for (let dx = -f; dx <= f; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          sum += data[(ny * width + nx) * 4 + 3];
          count++;
        }
      }
      out[(y * width + x) * 4 + 3] = count > 0 ? Math.round(sum / count) : 0;
    }
  }
  return result;
}

export function blendResults(
  original: ImageData,
  modified: ImageData,
  mask: ImageData,
  opacity: number,
): ImageData {
  const { data: origData } = original;
  const { data: modData } = modified;
  const { data: maskData } = mask;
  const result = cloneImageData(original);
  const out = result.data;

  for (let i = 0; i < origData.length; i += 4) {
    const maskAlpha = (maskData[i + 3] / 255) * opacity;
    out[i] = clamp(lerp(origData[i], modData[i], maskAlpha));
    out[i + 1] = clamp(lerp(origData[i + 1], modData[i + 1], maskAlpha));
    out[i + 2] = clamp(lerp(origData[i + 2], modData[i + 2], maskAlpha));
  }
  return result;
}

export function createGradientMask(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  feather: number,
): ImageData {
  const mask = createBlank(width, height);
  const data = mask.data;
  const r2 = radius * radius;
  const f2 = (radius + feather) * (radius + feather);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX, dy = y - centerY;
      const dist2 = dx * dx + dy * dy;
      const idx = (y * width + x) * 4;

      if (dist2 <= r2) {
        data[idx + 3] = 255;
      } else if (dist2 < f2) {
        const t = (Math.sqrt(dist2) - radius) / feather;
        data[idx + 3] = clamp((1 - t) * 255);
      } else {
        data[idx + 3] = 0;
      }
    }
  }
  return mask;
}


// ═══════════════════════════════════════════════════════════════════════════
// Creative cosmetics and portrait finishing
// ═══════════════════════════════════════════════════════════════════════════

function hexColor(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const full = normalized.length === 3
    ? normalized.split('').map((value) => value + value).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Apply a tint through an optional mask for lips, blush, shadow, or liner. */
export function cosmeticTint(
  imageData: ImageData,
  color: string,
  strength: number,
  mask?: ImageData,
): ImageData {
  const result = cloneImageData(imageData);
  const [targetR, targetG, targetB] = hexColor(color);
  const amount = Math.max(0, Math.min(1, strength)) * 0.72;

  for (let i = 0; i < imageData.data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const alpha = amount * (mask ? mask.data[i + 3] / 255 : 1);
    result.data[i] = clamp(lerp(imageData.data[i], targetR, alpha));
    result.data[i + 1] = clamp(lerp(imageData.data[i + 1], targetG, alpha));
    result.data[i + 2] = clamp(lerp(imageData.data[i + 2], targetB, alpha));
  }
  return result;
}

/** Give a portrait a restrained highlight, clarity, and saturation lift. */
export function portraitGlow(
  imageData: ImageData,
  strength: number,
  mask?: ImageData,
): ImageData {
  const result = cloneImageData(imageData);
  const amount = Math.max(0, Math.min(1, strength));

  for (let i = 0; i < imageData.data.length; i += 4) {
    if (mask && mask.data[i + 3] === 0) continue;
    const alpha = mask ? mask.data[i + 3] / 255 : 1;
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const lift = 1 + amount * 0.18 * alpha;
    const saturation = 1 + amount * 0.12 * alpha;
    result.data[i] = clamp(lerp(luma, r, saturation) * lift);
    result.data[i + 1] = clamp(lerp(luma, g, saturation) * lift);
    result.data[i + 2] = clamp(lerp(luma, b, saturation) * lift);
  }
  return result;
}
