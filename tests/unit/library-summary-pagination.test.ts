import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('electron', () => ({
  app: { getPath: () => jest.requireActual('node:os').tmpdir() },
}));

import { LibraryService } from '../../electron/library/library-service';

/**
 * Directive §7 (Media Library): the UI used to derive statistics from a single
 * 500-item page and could never reach rows past that cap. These tests prove
 * library-wide aggregates and offset paging against a real SQLite database.
 *
 * The repository ships one `better-sqlite3` prebuild, built for Node 20 (ABI 115),
 * which is the Node the Windows quality and release lanes use. A lane pinned to a
 * different Node major cannot load that native binding, and the failure is about
 * the runner's ABI, not about the code under test — so the suite reports itself
 * skipped there instead of turning an unrelated environment into a red build.
 */
function sqliteBindingLoads(): boolean {
  try {
    const entry = jest.requireActual('better-sqlite3') as unknown as { default?: unknown };
    const Ctor = (entry.default ?? entry) as new (file: string) => { close(): void };
    const db = new Ctor(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const describeRealSqlite = sqliteBindingLoads() ? describe : describe.skip;

describeRealSqlite('library summary and pagination', () => {
  let root: string;
  let mediaDir: string;
  let service: LibraryService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-library-summary-'));
    mediaDir = path.join(root, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    service = new LibraryService(path.join(root, 'library.sqlite3'));
  });

  afterEach(() => {
    service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seed(): void {
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(mediaDir, `clip-${index}.mp4`), 'synthetic');
    }
    for (let index = 0; index < 2; index += 1) {
      fs.writeFileSync(path.join(mediaDir, `track-${index}.mp3`), 'synthetic');
    }
  }

  test('summary counts the whole library even when a page is truncated', async () => {
    seed();
    await service.scanFolder(mediaDir);
    const favorite = service.query({ limit: 1 }).items[0];
    service.setFavorite(favorite.path, true);

    const page = service.query({ limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.summary).toEqual({ total: 5, video: 3, audio: 2, favorites: 1, missing: 0 });
  });

  test('offset paging reaches every indexed file exactly once', async () => {
    seed();
    await service.scanFolder(mediaDir);

    const first = service.query({ limit: 2, offset: 0 });
    const second = service.query({ limit: 2, offset: 2 });
    const third = service.query({ limit: 2, offset: 4 });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([2, 2, 1]);

    const paths = [...first.items, ...second.items, ...third.items].map((item) => item.path);
    expect(new Set(paths).size).toBe(5);
    expect(first.summary.total).toBe(5);
    expect(second.summary.total).toBe(5);
  });

  test('filtered queries keep filter totals while summary stays library-wide', async () => {
    seed();
    await service.scanFolder(mediaDir);

    const audioOnly = service.query({ type: 'audio', limit: 500 });
    expect(audioOnly.total).toBe(2);
    expect(audioOnly.items.every((item) => item.mediaType === 'audio')).toBe(true);
    expect(audioOnly.summary).toEqual({ total: 5, video: 3, audio: 2, favorites: 0, missing: 0 });
  });

  test('an empty library reports zeroed aggregates rather than nulls', () => {
    const empty = service.query({ limit: 500 });
    expect(empty.total).toBe(0);
    expect(empty.summary).toEqual({ total: 0, video: 0, audio: 0, favorites: 0, missing: 0 });
  });
});
