import type { AdjustmentLayer } from '../document/schema';
import { createBuffer, type RgbaBuffer } from '../raster/compositor';

/**
 * Non-destructive adjustment engine. Each adjustment is a pure per-pixel
 * mapping applied to a flattened RGBA buffer. Implementations are
 * arithmetic-only so they run identically in Node and the renderer.
 */

export interface AdjustmentOperation {
  kind: AdjustmentLayer['adjustment'];
  apply: (buffer: RgbaBuffer, parameters: Record<string, unknown>) => RgbaBuffer;
}

const OPERATIONS: Record<string, AdjustmentOperation['apply']> = {};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function num(parameters: Record<string, unknown>, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mapPixels(buffer: RgbaBuffer, mapper: (channel: number) => number): RgbaBuffer {
  const out = createBuffer(buffer.width, buffer.height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    out.data[i] = clampByte(mapper(buffer.data[i]));
    out.data[i + 1] = clampByte(mapper(buffer.data[i + 1]));
    out.data[i + 2] = clampByte(mapper(buffer.data[i + 2]));
    out.data[i + 3] = buffer.data[i + 3];
  }
  return out;
}

function mapPerChannel(
  buffer: RgbaBuffer,
  mapper: (r: number, g: number, b: number) => { r: number; g: number; b: number }
): RgbaBuffer {
  const out = createBuffer(buffer.width, buffer.height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    const result = mapper(buffer.data[i], buffer.data[i + 1], buffer.data[i + 2]);
    out.data[i] = clampByte(result.r);
    out.data[i + 1] = clampByte(result.g);
    out.data[i + 2] = clampByte(result.b);
    out.data[i + 3] = buffer.data[i + 3];
  }
  return out;
}

function register(kind: AdjustmentLayer['adjustment'], apply: AdjustmentOperation['apply']): void {
  OPERATIONS[kind] = apply;
}

register('brightness-contrast', (buffer, params) => {
  const brightness = clamp01(num(params, 'brightness', 0.5)) - 0.5;
  const contrast = clamp01(num(params, 'contrast', 0.5)) - 0.5;
  const contrastFactor = contrast === 0 ? 1 : 1 + Math.tan((Math.PI * (contrast * 2)) / 4);
  const pivot = 128;
  return mapPixels(buffer, (value) => pivot + (value - pivot) * contrastFactor + brightness * 255);
});

register('exposure', (buffer, params) => {
  const exposure = num(params, 'exposure', 0) / 2;
  const offset = num(params, 'offset', 0);
  const gamma = clamp01(num(params, 'gamma', 1));
  return mapPerChannel(buffer, (r, g, b) => {
    const adjust = (value: number): number => {
      const scaled = value / 255;
      const exposed = scaled * Math.pow(2, exposure) + offset;
      const corrected = Math.pow(clamp01(exposed), gamma);
      return corrected * 255;
    };
    return { r: adjust(r), g: adjust(g), b: adjust(b) };
  });
});

register('levels', (buffer, params) => {
  const inputBlack = clamp01(num(params, 'inputBlack', 0));
  const inputWhite = clamp01(num(params, 'inputWhite', 1));
  const gamma = clamp01(num(params, 'gamma', 1));
  const outputBlack = clamp01(num(params, 'outputBlack', 0));
  const outputWhite = clamp01(num(params, 'outputWhite', 1));
  const inputRange = Math.max(0.0001, inputWhite - inputBlack);
  const outputRange = outputWhite - outputBlack;
  return mapPixels(buffer, (value) => {
    const normalized = clamp01((value / 255 - inputBlack) / inputRange);
    const corrected = Math.pow(normalized, gamma);
    return (outputBlack + corrected * outputRange) * 255;
  });
});

register('curves', (buffer, params) => {
  const master = Array.isArray(params.points)
    ? (params.points as Array<{ x: number; y: number }>)
    : [];
  if (master.length < 2) {
    if (params.points !== undefined)
      throw new RangeError('Curves requires at least two control points.');
    return buffer;
  }
  const sorted = [...master].sort((a, b) => a.x - b.x);
  const curve = (value: number): number => {
    const v = clamp01(value / 255);
    let low = sorted[0];
    let high = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (v >= sorted[i].x && v <= sorted[i + 1].x) {
        low = sorted[i];
        high = sorted[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, high.x - low.x);
    const t = clamp01((v - low.x) / span);
    const eased = t * t * (3 - 2 * t);
    return (low.y + (high.y - low.y) * eased) * 255;
  };
  return mapPixels(buffer, curve);
});

register('hue-saturation', (buffer, params) => {
  const hue = num(params, 'hue', 0) % 360;
  const saturation = clamp01(num(params, 'saturation', 0.5)) * 2 - 1;
  const lightness = clamp01(num(params, 'lightness', 0.5)) * 2 - 1;
  const matrix = hueSaturationMatrix(hue, saturation);
  return mapPerChannel(buffer, (r, g, b) => {
    const ur = r / 255;
    const ug = g / 255;
    const ub = b / 255;
    const hr = matrix[0] * ur + matrix[1] * ug + matrix[2] * ub;
    const hg = matrix[3] * ur + matrix[4] * ug + matrix[5] * ub;
    const hb = matrix[6] * ur + matrix[7] * ug + matrix[8] * ub;
    return {
      r: clamp01(hr + lightness) * 255,
      g: clamp01(hg + lightness) * 255,
      b: clamp01(hb + lightness) * 255,
    };
  });
});

/** Standard RGB hue rotation + saturation scale matrix (row-major 3x3). */
function hueSaturationMatrix(hue: number, saturation: number): number[] {
  const radians = (hue * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const lumR = 0.213;
  const lumG = 0.715;
  const lumB = 0.072;
  const sat = Math.max(0, 1 + saturation);
  const inv = 1 - cos;
  const apply = (v: number): number => Math.max(0, Math.min(1, v));
  const matrix = [
    apply(lumR + inv * (1 - lumR) + -sin * lumR),
    apply(lumG + inv * -lumG + sin * lumG),
    apply(lumB + inv * -lumB + -sin * (1 - lumB)),
    apply(lumR + inv * -lumR + sin * lumR),
    apply(lumG + inv * (1 - lumG) + sin * lumG),
    apply(lumB + inv * -lumB + sin * (1 - lumB)),
    apply(lumR + inv * -lumR + -sin * (1 - lumR)),
    apply(lumG + inv * -lumG + -sin * lumG),
    apply(lumB + inv * (1 - lumB) + sin * lumB),
  ];
  if (sat !== 1) {
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const gray = row === 0 ? lumR : row === 1 ? lumG : lumB;
      matrix[i] = apply(gray + (matrix[i] - gray) * sat);
    }
  }
  return matrix;
}

register('vibrance', (buffer, params) => {
  const amount = num(params, 'vibrance', 0) / 2;
  return mapPerChannel(buffer, (r, g, b) => {
    const ur = r / 255;
    const ug = g / 255;
    const ub = b / 255;
    const max = Math.max(ur, ug, ub);
    const min = Math.min(ur, ug, ub);
    const saturation = max === min ? 0 : (max - min) / Math.max(0.0001, max);
    const boost = 1 + amount * (1 - saturation);
    const nr = clamp01((ur - 0.5) * boost + 0.5);
    const ng = clamp01((ug - 0.5) * boost + 0.5);
    const nb = clamp01((ub - 0.5) * boost + 0.5);
    return { r: nr * 255, g: ng * 255, b: nb * 255 };
  });
});

register('color-balance', (buffer, params) => {
  const red = clamp01(num(params, 'red', 0.5)) - 0.5;
  const green = clamp01(num(params, 'green', 0.5)) - 0.5;
  const blue = clamp01(num(params, 'blue', 0.5)) - 0.5;
  const strength = num(params, 'strength', 1);
  return mapPerChannel(buffer, (r, g, b) => ({
    r: r + red * 255 * strength,
    g: g + green * 255 * strength,
    b: b + blue * 255 * strength,
  }));
});

register('temperature-tint', (buffer, params) => {
  const temperature = num(params, 'temperature', 0);
  const tint = num(params, 'tint', 0);
  return mapPerChannel(buffer, (r, g, b) => {
    const warm = Math.max(-1, Math.min(1, temperature));
    const green = Math.max(-1, Math.min(1, tint));
    return {
      r: r + warm * 40,
      g: g + green * 40 - warm * 12,
      b: b - warm * 40 - green * 12,
    };
  });
});

register('shadows-highlights', (buffer, params) => {
  const shadows = num(params, 'shadows', 0);
  const highlights = num(params, 'highlights', 0);
  return mapPixels(buffer, (value) => {
    const v = value / 255;
    const shadowAmount = shadows * (1 - v) * 80;
    const highlightAmount = highlights * v * 80;
    return (v + shadowAmount - highlightAmount) * 255;
  });
});

register('black-white', (buffer, params) => {
  const red = clamp01(num(params, 'red', 0.4));
  const green = clamp01(num(params, 'green', 0.4));
  const blue = clamp01(num(params, 'blue', 0.2));
  const redFactor = clamp01(red) / 0.4;
  const greenFactor = clamp01(green) / 0.4;
  const blueFactor = clamp01(blue) / 0.2;
  return mapPerChannel(buffer, (r, g, b) => {
    const ur = r / 255;
    const ug = g / 255;
    const ub = b / 255;
    const gray = (0.2126 * ur * redFactor + 0.7152 * ug * greenFactor + 0.0722 * ub * blueFactor) /
      (redFactor + greenFactor + blueFactor);
    const t = num(params, 'tint', 0);
    return {
      r: (t === 0 ? gray : gray * (1 + t * 0.2)) * 255,
      g: (t === 0 ? gray : gray * (1 - t * 0.1)) * 255,
      b: (t === 0 ? gray : gray * (1 - t * 0.1)) * 255,
    };
  });
});

register('gamma', (buffer, params) => {
  const gamma = clamp01(num(params, 'gamma', 1));
  return mapPixels(buffer, (value) => Math.pow(value / 255, gamma) * 255);
});

register('invert', (buffer) => mapPixels(buffer, (value) => 255 - value));

register('posterize', (buffer, params) => {
  const levels = Math.max(2, Math.min(255, Math.round(num(params, 'levels', 8))));
  const step = 255 / (levels - 1);
  return mapPixels(buffer, (value) => Math.round(Math.round(value / step) * step));
});

register('threshold', (buffer, params) => {
  const level = Math.max(0, Math.min(255, Math.round(num(params, 'level', 128))));
  return mapPerChannel(buffer, (r, g, b) => {
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const value = gray >= level ? 255 : 0;
    return { r: value, g: value, b: value };
  });
});

register('gradient-map', (buffer, params) => {
  const stops = Array.isArray(params.stops)
    ? (params.stops as Array<{ offset: number; color: string }>)
    : [];
  if (stops.length < 2)
    throw new RangeError('Gradient map requires at least two color stops.');
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  return mapPerChannel(buffer, (r, g, b) => {
    const gray = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    let low = sorted[0];
    let high = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (gray >= sorted[i].offset && gray <= sorted[i + 1].offset) {
        low = sorted[i];
        high = sorted[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, high.offset - low.offset);
    const t = clamp01((gray - low.offset) / span);
    const lowColor = parseHex(low.color);
    const highColor = parseHex(high.color);
    return {
      r: (lowColor.r + (highColor.r - lowColor.r) * t) * 255,
      g: (lowColor.g + (highColor.g - lowColor.g) * t) * 255,
      b: (lowColor.b + (highColor.b - lowColor.b) * t) * 255,
    };
  });
});

register('gaussian-blur', (buffer, params) => {
  const radius = Math.max(0, Math.min(64, num(params, 'radius', 0)));
  if (radius === 0) return buffer;
  return gaussianBlur(buffer, radius);
});

register('sharpen', (buffer, params) => {
  const amount = Math.max(0, Math.min(4, num(params, 'amount', 1)));
  if (amount === 0) return buffer;
  const blurred = gaussianBlur(buffer, 1);
  const out = createBuffer(buffer.width, buffer.height);
  for (let i = 0; i < buffer.data.length; i++) {
    out.data[i] = clampByte(buffer.data[i] + (buffer.data[i] - blurred.data[i]) * amount);
  }
  return out;
});

register('unsharp-mask', (buffer, params) => {
  const amount = Math.max(0, Math.min(4, num(params, 'amount', 1)));
  const radius = Math.max(0, Math.min(32, num(params, 'radius', 2)));
  if (amount === 0 || radius === 0) return buffer;
  const blurred = gaussianBlur(buffer, radius);
  const out = createBuffer(buffer.width, buffer.height);
  for (let i = 0; i < buffer.data.length; i++) {
    out.data[i] = clampByte(buffer.data[i] + (buffer.data[i] - blurred.data[i]) * amount);
  }
  return out;
});

register('vignette', (buffer, params) => {
  const amount = Math.max(0, Math.min(1, num(params, 'amount', 0.3)));
  const inner = Math.max(0.1, Math.min(1, num(params, 'inner', 0.7)));
  const centerX = buffer.width / 2;
  const centerY = buffer.height / 2;
  const maxDistance = Math.hypot(centerX, centerY);
  const out = createBuffer(buffer.width, buffer.height);
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
      const falloff = clamp01((distance - inner) / Math.max(0.05, 1 - inner));
      const darken = 1 - amount * falloff;
      const i = (y * buffer.width + x) * 4;
      out.data[i] = clampByte(buffer.data[i] * darken);
      out.data[i + 1] = clampByte(buffer.data[i + 1] * darken);
      out.data[i + 2] = clampByte(buffer.data[i + 2] * darken);
      out.data[i + 3] = buffer.data[i + 3];
    }
  }
  return out;
});

register('noise', (buffer, params) => {
  const amount = Math.max(0, Math.min(100, num(params, 'amount', 5)));
  const seed = num(params, 'seed', 0);
  if (amount === 0) return buffer;
  let state = (seed >>> 0) || 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const out = createBuffer(buffer.width, buffer.height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    const delta = (random() * 2 - 1) * amount;
    out.data[i] = clampByte(buffer.data[i] + delta);
    out.data[i + 1] = clampByte(buffer.data[i + 1] + delta);
    out.data[i + 2] = clampByte(buffer.data[i + 2] + delta);
    out.data[i + 3] = buffer.data[i + 3];
  }
  return out;
});

function gaussianBlur(buffer: RgbaBuffer, radius: number): RgbaBuffer {
  const kernel = gaussianKernel(radius);
  const horizontal = blurAxis(buffer, kernel, true);
  return blurAxis(horizontal, kernel, false);
}

function gaussianKernel(radius: number): number[] {
  const sigma = Math.max(0.5, radius / 3);
  const size = Math.max(1, Math.ceil(radius * 2) + 1);
  const center = (size - 1) / 2;
  const kernel: number[] = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const delta = i - center;
    const value = Math.exp(-(delta * delta) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  return kernel.map((value) => value / sum);
}

function blurAxis(buffer: RgbaBuffer, kernel: number[], horizontal: boolean): RgbaBuffer {
  const out = createBuffer(buffer.width, buffer.height);
  const radius = Math.floor(kernel.length / 2);
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const offset = k - radius;
          const sx = horizontal ? x + offset : x;
          const sy = horizontal ? y : y + offset;
          const clampedX = Math.max(0, Math.min(buffer.width - 1, sx));
          const clampedY = Math.max(0, Math.min(buffer.height - 1, sy));
          sum += buffer.data[(clampedY * buffer.width + clampedX) * 4 + c] * kernel[k];
        }
        out.data[(y * buffer.width + x) * 4 + c] = clampByte(sum);
      }
    }
  }
  return out;
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return { r: 0.5, g: 0.5, b: 0.5 };
  return {
    r: parseInt(hex[1].slice(0, 2), 16) / 255,
    g: parseInt(hex[1].slice(2, 4), 16) / 255,
    b: parseInt(hex[1].slice(4, 6), 16) / 255,
  };
}

export function applyAdjustment(
  kind: AdjustmentLayer['adjustment'],
  buffer: RgbaBuffer,
  parameters: Record<string, unknown> = {}
): RgbaBuffer {
  const operation = OPERATIONS[kind];
  if (!operation) throw new TypeError(`Unsupported adjustment: ${kind}`);
  return operation(buffer, parameters);
}

export function adjustmentKinds(): AdjustmentLayer['adjustment'][] {
  return Object.keys(OPERATIONS) as AdjustmentLayer['adjustment'][];
}
