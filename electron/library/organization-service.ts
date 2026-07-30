import path from 'path';
import { randomUUID } from 'crypto';

import { app } from 'electron';
import Database from 'better-sqlite3';

export interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  mediaPath: string;
  position: number;
  createdAt: string;
}

export interface MediaBookmark {
  id: string;
  mediaPath: string;
  position: number;
  label: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

function validName(value: string, field: string, maxLength = 160): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new RangeError(`${field} must contain 1-${maxLength} characters.`);
  }
  return normalized;
}

function validPosition(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 604800) {
    throw new RangeError('Media position must be a finite non-negative value within seven days.');
  }
  return value;
}

export class OrganizationService {
  private readonly database: Database.Database;

  constructor(databasePath = path.join(app.getPath('userData'), 'knoux-library.sqlite3')) {
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.migrate();
  }

  listPlaylists(): Playlist[] {
    const rows = this.database.prepare(`
      SELECT p.id, p.name, p.created_at, p.updated_at, COUNT(pi.id) AS item_count
      FROM playlists p
      LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.name COLLATE NOCASE
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      itemCount: Number(row.item_count),
    }));
  }

  createPlaylist(name: string): Playlist {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, validName(name, 'Playlist name'), now, now);
    return this.listPlaylists().find((playlist) => playlist.id === id) as Playlist;
  }

  renamePlaylist(playlistId: string, name: string): Playlist {
    const result = this.database.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
      .run(validName(name, 'Playlist name'), new Date().toISOString(), playlistId);
    if (result.changes === 0) throw new Error('Playlist does not exist.');
    return this.listPlaylists().find((playlist) => playlist.id === playlistId) as Playlist;
  }

  deletePlaylist(playlistId: string): boolean {
    return this.database.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId).changes > 0;
  }

  listPlaylistItems(playlistId: string): PlaylistItem[] {
    const rows = this.database.prepare(`
      SELECT id, playlist_id, media_path, position, created_at
      FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC
    `).all(playlistId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      playlistId: String(row.playlist_id),
      mediaPath: String(row.media_path),
      position: Number(row.position),
      createdAt: String(row.created_at),
    }));
  }

  addPlaylistItem(playlistId: string, mediaPath: string, playNext = false): PlaylistItem {
    const playlist = this.database.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
    if (!playlist) throw new Error('Playlist does not exist.');
    const normalizedPath = path.resolve(mediaPath);
    const existing = this.database.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? AND media_path = ?')
      .get(playlistId, normalizedPath) as Record<string, unknown> | undefined;
    if (existing) {
      return {
        id: String(existing.id), playlistId: String(existing.playlist_id), mediaPath: String(existing.media_path),
        position: Number(existing.position), createdAt: String(existing.created_at),
      };
    }

    const countRow = this.database.prepare('SELECT COUNT(*) AS count FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId) as { count: number };
    const position = playNext ? 0 : Number(countRow.count);
    const now = new Date().toISOString();
    const id = randomUUID();
    const transaction = this.database.transaction(() => {
      if (playNext) this.database.prepare('UPDATE playlist_items SET position = position + 1 WHERE playlist_id = ?').run(playlistId);
      this.database.prepare(`
        INSERT INTO playlist_items (id, playlist_id, media_path, position, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, playlistId, normalizedPath, position, now);
      this.database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);
    });
    transaction();
    return this.listPlaylistItems(playlistId).find((item) => item.id === id) as PlaylistItem;
  }

  removePlaylistItem(playlistId: string, itemId: string): boolean {
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare('SELECT position FROM playlist_items WHERE id = ? AND playlist_id = ?')
        .get(itemId, playlistId) as { position: number } | undefined;
      if (!row) return false;
      this.database.prepare('DELETE FROM playlist_items WHERE id = ?').run(itemId);
      this.database.prepare('UPDATE playlist_items SET position = position - 1 WHERE playlist_id = ? AND position > ?')
        .run(playlistId, row.position);
      this.database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), playlistId);
      return true;
    });
    return transaction();
  }

  reorderPlaylistItem(playlistId: string, itemId: string, targetPosition: number): PlaylistItem[] {
    if (!Number.isInteger(targetPosition) || targetPosition < 0) throw new RangeError('Playlist position is invalid.');
    const items = this.listPlaylistItems(playlistId);
    const sourceIndex = items.findIndex((item) => item.id === itemId);
    if (sourceIndex < 0) throw new Error('Playlist item does not exist.');
    const bounded = Math.min(targetPosition, items.length - 1);
    const [moved] = items.splice(sourceIndex, 1);
    items.splice(bounded, 0, moved);
    const update = this.database.prepare('UPDATE playlist_items SET position = ? WHERE id = ?');
    const transaction = this.database.transaction(() => {
      items.forEach((item, index) => update.run(index, item.id));
      this.database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), playlistId);
    });
    transaction();
    return this.listPlaylistItems(playlistId);
  }

  listBookmarks(mediaPath?: string): MediaBookmark[] {
    const rows = mediaPath
      ? this.database.prepare('SELECT * FROM media_bookmarks WHERE media_path = ? ORDER BY position ASC').all(path.resolve(mediaPath))
      : this.database.prepare('SELECT * FROM media_bookmarks ORDER BY updated_at DESC').all();
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      mediaPath: String(row.media_path),
      position: Number(row.position),
      label: String(row.label),
      note: String(row.note),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  saveBookmark(request: { id?: string; mediaPath: string; position: number; label: string; note?: string }): MediaBookmark {
    const now = new Date().toISOString();
    const id = request.id ?? randomUUID();
    const mediaPath = path.resolve(request.mediaPath);
    const position = validPosition(request.position);
    const label = validName(request.label, 'Bookmark label');
    const note = (request.note ?? '').normalize('NFC').trim().slice(0, 4000);
    this.database.prepare(`
      INSERT INTO media_bookmarks (id, media_path, position, label, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET media_path = excluded.media_path, position = excluded.position,
        label = excluded.label, note = excluded.note, updated_at = excluded.updated_at
    `).run(id, mediaPath, position, label, note, now, now);
    return this.listBookmarks(mediaPath).find((bookmark) => bookmark.id === id) as MediaBookmark;
  }

  deleteBookmark(id: string): boolean {
    return this.database.prepare('DELETE FROM media_bookmarks WHERE id = ?').run(id).changes > 0;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_items (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        media_path TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(playlist_id, media_path),
        UNIQUE(playlist_id, position)
      );
      CREATE TABLE IF NOT EXISTS media_bookmarks (
        id TEXT PRIMARY KEY,
        media_path TEXT NOT NULL,
        position REAL NOT NULL,
        label TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, position);
      CREATE INDEX IF NOT EXISTS idx_media_bookmarks_path ON media_bookmarks(media_path, position);
    `);
  }
}
