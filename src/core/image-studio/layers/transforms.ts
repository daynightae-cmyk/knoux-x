import { IDENTITY_TRANSFORM, type ImageTransform } from '../document/schema';

export interface Point {
  x: number;
  y: number;
}

function validateTransform(transform: ImageTransform): void {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    if (!Number.isFinite(transform[key])) throw new TypeError('Transform is invalid.');
  }
}

export function identityTransform(): ImageTransform {
  return { ...IDENTITY_TRANSFORM };
}

export function multiplyTransforms(left: ImageTransform, right: ImageTransform): ImageTransform {
  validateTransform(left);
  validateTransform(right);
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function invertTransform(transform: ImageTransform): ImageTransform {
  validateTransform(transform);
  const determinant = transform.a * transform.d - transform.c * transform.b;
  if (determinant === 0) throw new RangeError('Transform is not invertible.');
  return {
    a: transform.d / determinant,
    b: -transform.b / determinant,
    c: -transform.c / determinant,
    d: transform.a / determinant,
    e: (transform.c * transform.f - transform.d * transform.e) / determinant,
    f: (transform.b * transform.e - transform.a * transform.f) / determinant,
  };
}

export function applyTransform(transform: ImageTransform, point: Point): Point {
  validateTransform(transform);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new TypeError('Point is invalid.');
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

export function translateTransform(x: number, y: number): ImageTransform {
  return { ...IDENTITY_TRANSFORM, e: x, f: y };
}

export function scaleTransform(sx: number, sy: number): ImageTransform {
  return { ...IDENTITY_TRANSFORM, a: sx, d: sy };
}

export function rotateTransform(radians: number): ImageTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function composeTransforms(...transforms: ImageTransform[]): ImageTransform {
  return transforms.reduce<ImageTransform>((accumulator, next) => multiplyTransforms(accumulator, next), identityTransform());
}

export function transformBounds(transform: ImageTransform, width: number, height: number): { x: number; y: number; width: number; height: number } {
  validateTransform(transform);
  const corners = [
    applyTransform(transform, { x: 0, y: 0 }),
    applyTransform(transform, { x: width, y: 0 }),
    applyTransform(transform, { x: 0, y: height }),
    applyTransform(transform, { x: width, y: height }),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function transformScale(transform: ImageTransform): { sx: number; sy: number } {
  validateTransform(transform);
  return {
    sx: Math.sqrt(transform.a * transform.a + transform.c * transform.c),
    sy: Math.sqrt(transform.b * transform.b + transform.d * transform.d),
  };
}

export function isIdentityTransform(transform: ImageTransform): boolean {
  return (
    transform.a === 1 &&
    transform.b === 0 &&
    transform.c === 0 &&
    transform.d === 1 &&
    transform.e === 0 &&
    transform.f === 0
  );
}
