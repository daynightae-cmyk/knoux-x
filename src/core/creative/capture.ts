export type CaptureFormat = 'png' | 'jpeg' | 'webp';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeWindowsFileStem(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(INVALID_WINDOWS_CHARACTERS, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = normalized.length > 0 ? normalized : 'capture';
  return WINDOWS_RESERVED_NAMES.test(safe) ? `_${safe}` : safe;
}

export function formatCaptureTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError('Capture time must be a finite non-negative number.');
  }
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join('-')
    + `-${String(millis).padStart(3, '0')}`;
}

export function createCaptureFileName(
  mediaName: string,
  timestampSeconds: number,
  format: CaptureFormat,
  capturedAt = new Date(),
): string {
  if (Number.isNaN(capturedAt.getTime())) throw new RangeError('Capture date is invalid.');
  const stem = sanitizeWindowsFileStem(mediaName.replace(/\.[^.]+$/, ''));
  const date = capturedAt.toISOString().replace(/[:.]/g, '-');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${stem}_${formatCaptureTime(timestampSeconds)}_${date}.${extension}`;
}

export function dataUrlByteLength(dataUrl: string): number {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new TypeError('Capture must be a supported base64 image data URL.');
  const payload = match[2];
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}
