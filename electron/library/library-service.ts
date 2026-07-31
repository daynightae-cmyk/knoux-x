import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

import { app } from 'electron';
import BetterSqlite3 from 'better-sqlite3';

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v',
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus',
]);
const BATCH_SIZE = 200;

export interface LibraryFolder {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  lastScannedAt: string | null;
}

export interface LibraryMediaItem {
  id: string;
  path: string;
  name: string;
  extension: string;
  mediaType: 'video' | 'audio';
  size: number;
  modifiedAt: string;
  favorite: boolean;
  missing: boolean;
  lastPlayedAt: string | null;
  playCount: number;
  lastPosition: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryQuery {
  search?: string;
  type?: 'all' | 'video' | 'audio';
  favoritesOnly?: boolean;
  missingOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ScanProgress {
  jobId: string;
  folderPath: string;
  discovered: number;
  processed: number;
  currentPath: string | null;
  done: boolean;
  canceled: boolean;
}

function stableId(filePath: string): string {
  return createHash('sha256').update(process.platform === 'win32' ? filePath.toLowerCase() : filePath).digest('hex');
}

function mediaType(extension: string): 'video' | 'audio' {
  return ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'].includes(extension) ? 'audio' : 'video';
}

function mapFolder(row: Record<string, unknown>): LibraryFolder {
  return {
    id: String(row.id),
    path: String(row.path),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastScannedAt: row.last_scanned_at ? String(row.last_scanned_at) : null,
  };
}

function mapMedia(row: Record<string, unknown>): LibraryMediaItem {
  return {
    id: String(row.id),
    path: String(row.path),
    name: String(row.name),
    extension: String(row.extension),
    mediaType: row.media_type === 'audio' ? 'audio' : 'video',
    size: Number(row.size),
    modifiedAt: String(row.modified_at),
    favorite: Boolean(row.favorite),
    missing: Boolean(row.missing),
    lastPlayedAt: row.last_played_at ? String(row.last_played_at) : null,
    playCount: Number(row.play_count),
    lastPosition: Number(row.last_position),
    completed: Boolean(row.completed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class LibraryService {
  private readonly database: BetterSqlite3.Database;
  private readonly canceledJobs = new Set<string>();

  constructor(databasePath = path.join(app.getPath('userData'), 'knoux-library.sqlite3')) {
    this.database = new BetterSqlite3(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.migrate();
  }

  addFolder(folderPath: string): LibraryFolder {
    const resolved = path.resolve(folderPath);
    const now = new Date().toISOString();
    const id = stableId(resolved);
    this.database.prepare(`
      INSERT INTO folders (id, path, name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET name = excluded.name
    `).run(id, resolved, path.basename(resolved) || resolved, now);
    return this.getFolderByPath(resolved);
  }

  listFolders(): LibraryFolder[] {
    return (this.database.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[])
      .map(mapFolder);
  }

  removeFolder(folderPath: string, removeIndexedMedia = false): void {
    const resolved = path.resolve(folderPath);
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM folders WHERE path = ?').run(resolved);
      if (removeIndexedMedia) {
        const prefix = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
        this.database.prepare('DELETE FROM media_items WHERE path = ? OR path LIKE ?').run(resolved, `${prefix}%`);
      }
    });
    transaction();
  }

  query(request: LibraryQuery = {}): { items: LibraryMediaItem[]; total: number } {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    const search = request.search?.normalize('NFC').trim();
    if (search) {
      clauses.push('(name LIKE ? ESCAPE \'\\\' OR path LIKE ? ESCAPE \'\\\')');
      const escaped = search.replace(/[\\%_]/g, (value) => `\\${value}`);
      parameters.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (request.type && request.type !== 'all') {
      clauses.push('media_type = ?');
      parameters.push(request.type);
    }
    if (request.favoritesOnly) clauses.push('favorite = 1');
    if (request.missingOnly) clauses.push('missing = 1');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, Math.round(request.limit ?? 100)));
    const offset = Math.max(0, Math.round(request.offset ?? 0));
    const rows = this.database.prepare(`
      SELECT * FROM media_items
      ${where}
      ORDER BY missing ASC, COALESCE(last_played_at, created_at) DESC, name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as Record<string, unknown>[];
    const totalRow = this.database.prepare(`SELECT COUNT(*) AS count FROM media_items ${where}`)
      .get(...parameters) as { count: number };
    return { items: rows.map(mapMedia), total: Number(totalRow.count) };
  }

  getMedia(filePath: string): LibraryMediaItem | null {
    const row = this.database.prepare('SELECT * FROM media_items WHERE path = ?').get(path.resolve(filePath)) as Record<string, unknown> | undefined;
    return row ? mapMedia(row) : null;
  }

  setFavorite(filePath: string, favorite: boolean): LibraryMediaItem {
    const resolved = path.resolve(filePath);
    this.database.prepare('UPDATE media_items SET favorite = ?, updated_at = ? WHERE path = ?')
      .run(favorite ? 1 : 0, new Date().toISOString(), resolved);
    const item = this.getMedia(resolved);
    if (!item) throw new Error('Library item does not exist.');
    return item;
  }

  updatePlayback(filePath: string, position: number, duration: number, completed = false): void {
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0) {
      throw new RangeError('Playback position and duration must be finite non-negative numbers.');
    }
    const resolved = path.resolve(filePath);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const previous = this.database.prepare('SELECT last_played_at FROM media_items WHERE path = ?')
      .get(resolved) as { last_played_at?: string | null } | undefined;
    const previousTime = previous?.last_played_at ? Date.parse(previous.last_played_at) : Number.NaN;
    const newSession = !Number.isFinite(previousTime) || nowDate.getTime() - previousTime >= 30 * 60 * 1000;
    this.database.prepare(
      'UPDATE media_items SET last_played_at = ?, play_count = play_count + ?, last_position = ?, completed = ?, updated_at = ? WHERE path = ?',
    ).run(
      now,
      newSession ? 1 : 0,
      position,
      completed || (duration > 0 && position / duration >= 0.92) ? 1 : 0,
      now,
      resolved,
    );
  }

  cancelScan(jobId: string): boolean {
    this.canceledJobs.add(jobId);
    return true;
  }

  async scanFolder(
    folderPath: string,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<ScanProgress> {
    const resolvedRoot = path.resolve(folderPath);
    const rootStats = await fs.stat(resolvedRoot);
    if (!rootStats.isDirectory()) throw new Error('Library scan root is not a directory.');
    this.addFolder(resolvedRoot);

    const jobId = randomUUID();
    const progress: ScanProgress = {
      jobId,
      folderPath: resolvedRoot,
      discovered: 0,
      processed: 0,
      currentPath: null,
      done: false,
      canceled: false,
    };
    const seen = new Set<string>();
    const pendingDirectories = [resolvedRoot];
    const batch: Array<{ filePath: string; stats: Awaited<ReturnType<typeof fs.stat>> }> = [];

    while (pendingDirectories.length > 0) {
      if (this.canceledJobs.has(jobId)) break;
      const directory = pendingDirectories.pop();
      if (!directory) break;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (this.canceledJobs.has(jobId)) break;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(extension)) continue;
        try {
          const stats = await fs.stat(entryPath);
          seen.add(path.resolve(entryPath));
          batch.push({ filePath: path.resolve(entryPath), stats });
          progress.discovered += 1;
          progress.currentPath = entryPath;
          if (batch.length >= BATCH_SIZE) {
            this.upsertBatch(batch.splice(0, batch.length));
            progress.processed += BATCH_SIZE;
            onProgress?.({ ...progress });
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        } catch {
          // File disappeared or became inaccessible during the scan.
        }
      }
    }

    if (batch.length > 0) {
      const size = batch.length;
      this.upsertBatch(batch);
      progress.processed += size;
    }

    if (!this.canceledJobs.has(jobId)) {
      const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
      const rows = this.database.prepare('SELECT path FROM media_items WHERE path = ? OR path LIKE ?')
        .all(resolvedRoot, `${prefix}%`) as Array<{ path: string }>;
      const markMissing = this.database.prepare('UPDATE media_items SET missing = 1, updated_at = ? WHERE path = ?');
      const now = new Date().toISOString();
      const transaction = this.database.transaction(() => {
        rows.forEach((row) => {
          if (!seen.has(path.resolve(row.path))) markMissing.run(now, row.path);
        });
        this.database.prepare('UPDATE folders SET last_scanned_at = ? WHERE path = ?').run(now, resolvedRoot);
      });
      transaction();
    }

    progress.currentPath = null;
    progress.done = true;
    progress.canceled = this.canceledJobs.delete(jobId);
    onProgress?.({ ...progress });
    return progress;
  }

  close(): void {
    this.database.close();
  }

  private getFolderByPath(folderPath: string): LibraryFolder {
    const row = this.database.prepare('SELECT * FROM folders WHERE path = ?').get(folderPath) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Library folder could not be persisted.');
    return mapFolder(row);
  }

  private upsertBatch(entries: Array<{ filePath: string; stats: Awaited<ReturnType<typeof fs.stat>> }>): void {
    const statement = this.database.prepare(`
      INSERT INTO media_items (
        id, path, name, extension, media_type, size, modified_at, missing, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        extension = excluded.extension,
        media_type = excluded.media_type,
        size = excluded.size,
        modified_at = excluded.modified_at,
        missing = 0,
        updated_at = excluded.updated_at
    `);
    const transaction = this.database.transaction(() => {
      for (const entry of entries) {
        const extension = path.extname(entry.filePath).toLowerCase();
        const now = new Date().toISOString();
        statement.run(
          stableId(entry.filePath),
          entry.filePath,
          path.basename(entry.filePath),
          extension,
          mediaType(extension),
          entry.stats.size,
          entry.stats.mtime.toISOString(),
          now,
          now,
        );
      }
    });
    transaction();
  }

  private migrate(): void {
    const version = Number(this.database.pragma('user_version', { simple: true }));
    if (version >= 1) return;
    const migrate = this.database.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_scanned_at TEXT
        );
        CREATE TABLE IF NOT EXISTS media_items (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          extension TEXT NOT NULL,
          media_type TEXT NOT NULL CHECK(media_type IN ('video', 'audio')),
          size INTEGER NOT NULL,
          modified_at TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0,
          missing INTEGER NOT NULL DEFAULT 0,
          last_played_at TEXT,
          play_count INTEGER NOT NULL DEFAULT 0,
          last_position REAL NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_name ON media_items(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(media_type);
        CREATE INDEX IF NOT EXISTS idx_media_recent ON media_items(last_played_at DESC);
        CREATE INDEX IF NOT EXISTS idx_media_favorite ON media_items(favorite, missing);
      `);
      this.database.pragma('user_version = 1');
    });
    migrate();
  }
}
