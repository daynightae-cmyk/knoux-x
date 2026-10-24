import {
  MEDIA_METADATA_TIMEOUT_MS,
  probeDurationSeconds,
  readMediaMetadataDuration,
  type MediaElementLike,
} from '../../src/features/editor/importMetadata';

class FakeMedia implements MediaElementLike {
  preload = '';
  src = '';
  duration = 0;
  loadCount = 0;
  removedAttributes: string[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  removeAttribute(attribute: string): void {
    this.removedAttributes.push(attribute);
    if (attribute === 'src') this.src = '';
  }

  load(): void {
    this.loadCount += 1;
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fakeElement(duration = 0): { media: FakeMedia; create: (kind: 'video' | 'audio') => MediaElementLike } {
  const media = new FakeMedia();
  media.duration = duration;
  return { media, create: () => media };
}

/**
 * Directive §3 gap A: FFprobe owns duration; the browser element is a bounded
 * fallback that must never hang and must release itself on every outcome.
 */
describe('import metadata ownership', () => {
  describe('probeDurationSeconds', () => {
    test('prefers the packet-measured duration, then the container, then a stream', () => {
      expect(probeDurationSeconds({ contentDurationSeconds: 12.5, format: { duration: '13.5' }, streams: [{ duration: '14.5' }] })).toBe(12.5);
      expect(probeDurationSeconds({ format: { duration: '13.5' }, streams: [{ duration: '14.5' }] })).toBe(13.5);
      expect(probeDurationSeconds({ streams: [{ codec_type: 'video', duration: '14.5' }] })).toBe(14.5);
      expect(probeDurationSeconds({ streams: [{ codec_type: 'audio' }, { duration: '9.25' }] })).toBe(9.25);
    });

    test('rejects zero, negative, non-finite and malformed durations', () => {
      expect(probeDurationSeconds(null)).toBeNull();
      expect(probeDurationSeconds({})).toBeNull();
      expect(probeDurationSeconds({ format: { duration: '0' } })).toBeNull();
      expect(probeDurationSeconds({ format: { duration: '-4' } })).toBeNull();
      expect(probeDurationSeconds({ format: { duration: 'N/A' } })).toBeNull();
      expect(probeDurationSeconds({ contentDurationSeconds: Number.NaN })).toBeNull();
      expect(probeDurationSeconds({ streams: [{ duration: 'Infinity' }] })).toBeNull();
    });
  });

  describe('readMediaMetadataDuration', () => {
    test('resolves the element duration and releases the element', async () => {
      const { media, create } = fakeElement(7.75);
      const pending = readMediaMetadataDuration('file:///fixture.mp4', 'video', { createMedia: create });
      media.emit('loadedmetadata');
      await expect(pending).resolves.toBe(7.75);
      expect(media.removedAttributes).toContain('src');
      expect(media.loadCount).toBe(1);
      expect(media.listenerCount('loadedmetadata')).toBe(0);
      expect(media.listenerCount('error')).toBe(0);
    });

    test('rejects an element that reports no finite duration', async () => {
      const { media, create } = fakeElement(0);
      const pending = readMediaMetadataDuration('file:///fixture.mkv', 'video', { createMedia: create });
      media.emit('loadedmetadata');
      await expect(pending).rejects.toThrow('IMPORT_METADATA_UNDECODABLE');
      expect(media.removedAttributes).toContain('src');
    });

    test('rejects an element decode error and releases the element', async () => {
      const { media, create } = fakeElement(4);
      const pending = readMediaMetadataDuration('file:///fixture.hevc.mkv', 'video', { createMedia: create });
      media.emit('error');
      await expect(pending).rejects.toThrow('IMPORT_METADATA_UNDECODABLE');
      expect(media.loadCount).toBe(1);
      expect(media.listenerCount('error')).toBe(0);
    });

    test('times out instead of hanging forever and releases the element', async () => {
      jest.useFakeTimers();
      try {
        const { media, create } = fakeElement(4);
        const pending = readMediaMetadataDuration('file:///slow-drive.mp4', 'video', { createMedia: create });
        const assertion = expect(pending).rejects.toThrow('IMPORT_METADATA_TIMEOUT');
        jest.advanceTimersByTime(MEDIA_METADATA_TIMEOUT_MS);
        await assertion;
        expect(media.removedAttributes).toContain('src');
        expect(media.loadCount).toBe(1);
        expect(media.listenerCount('loadedmetadata')).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    test('a late metadata event after the timeout cannot settle twice', async () => {
      jest.useFakeTimers();
      try {
        const { media, create } = fakeElement(4);
        const pending = readMediaMetadataDuration('file:///slow-drive.mp4', 'video', { createMedia: create, timeoutMs: 1000 });
        const assertion = expect(pending).rejects.toThrow('IMPORT_METADATA_TIMEOUT');
        jest.advanceTimersByTime(1000);
        await assertion;
        expect(() => media.emit('loadedmetadata')).not.toThrow();
        expect(media.listenerCount('loadedmetadata')).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
