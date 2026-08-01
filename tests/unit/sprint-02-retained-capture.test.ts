import { CaptureConsentStore } from '../../electron/creative/capture-consent-store';
import { RetainedCaptureStore, RETAINED_CAPTURE_LIMITS } from '../../electron/creative/retained-capture-store';

function metadata(index: number) {
  return { sourceId: `screen:${index}`, sourceName: `Synthetic ${index}`, displayId: String(index), format: 'png' as const, width: 2, height: 2, outputPath: null };
}

describe('Sprint 02 retained capture policy', () => {
  test('crosses count, eviction, pin, and TTL limits without unbounded persistence', () => {
    let now = 1_700_000_000_000;
    const store = new RetainedCaptureStore(() => now);
    const inserted = Array.from({ length: RETAINED_CAPTURE_LIMITS.maximumCount }, (_, index) => {
      now += 1;
      return store.insert(Buffer.from(`synthetic-${index}`), metadata(index));
    });
    store.pin(inserted[0].id); store.pin(inserted[1].id); store.pin(inserted[2].id);
    expect(() => store.pin(inserted[3].id)).toThrow('Only 3');
    const ninth = store.insert(Buffer.from('synthetic-9'), metadata(9));
    expect(store.list()).toHaveLength(8);
    expect(store.list().some((entry) => entry.id === inserted[3].id)).toBe(false);
    expect(store.list().some((entry) => entry.id === ninth.id)).toBe(true);
    now += RETAINED_CAPTURE_LIMITS.unpinnedTtlMs + 1;
    expect(store.list().every((entry) => entry.pinned)).toBe(true);
    now += RETAINED_CAPTURE_LIMITS.pinnedTtlMs + 1;
    expect(store.list()).toHaveLength(0);
  });

  test('rejects per-item limit and clears all in-memory state on shutdown', () => {
    const store = new RetainedCaptureStore();
    expect(() => store.insert(Buffer.alloc(RETAINED_CAPTURE_LIMITS.maximumItemBytes + 1), metadata(1))).toThrow('Retained capture');
    store.insert(Buffer.from('synthetic'), metadata(1));
    store.clear();
    expect(store.list()).toHaveLength(0);
  });

  test('one-shot consent is provider, retained-id, hash, and invocation bound', () => {
    let now = 1_700_000_000_000;
    const store = new CaptureConsentStore(() => now);
    const consent = store.create('google-lens', 'retained-1', 'a'.repeat(64), 1024);
    expect(consent).toMatchObject({ provider: 'google-lens', retainedId: 'retained-1', sha256: 'a'.repeat(64), bytes: 1024 });
    expect(store.consume(consent.id, false)).toBeNull();
    expect(() => store.consume(consent.id, true)).toThrow('already used');
    const expiring = store.create('google-image-search', 'retained-2', 'b'.repeat(64), 1024);
    now += 60_001;
    expect(() => store.consume(expiring.id, true)).toThrow('expired');
    expect(store.size()).toBe(0);
  });
});
