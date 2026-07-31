const MAX_SEQUENCE_FRAMES = 120;
const DEFAULT_END_EPSILON_SECONDS = 0.001;

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
}

function assertFrameCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SEQUENCE_FRAMES) {
    throw new RangeError(`Capture sequence count must be an integer between 1 and ${MAX_SEQUENCE_FRAMES}.`);
  }
}

function normalizePosition(value: number, duration: number): number {
  const upperBound = Math.max(0, duration - DEFAULT_END_EPSILON_SECONDS);
  return Number(Math.max(0, Math.min(upperBound, value)).toFixed(3));
}

function uniquePositions(values: readonly number[]): number[] {
  return [...new Set(values)];
}

export function buildBurstCapturePositions(
  currentTime: number,
  duration: number,
  count = 8,
  intervalSeconds = 0.25,
): number[] {
  assertFinitePositive(duration, 'Media duration');
  if (!Number.isFinite(currentTime)) throw new RangeError('Current media time must be finite.');
  assertFrameCount(count);
  assertFinitePositive(intervalSeconds, 'Burst interval');

  return uniquePositions(Array.from(
    { length: count },
    (_, index) => normalizePosition(currentTime + index * intervalSeconds, duration),
  ));
}

export function buildContactSheetPositions(duration: number, count = 8): number[] {
  assertFinitePositive(duration, 'Media duration');
  assertFrameCount(count);

  return uniquePositions(Array.from(
    { length: count },
    (_, index) => normalizePosition(((index + 1) / (count + 1)) * duration, duration),
  ));
}
