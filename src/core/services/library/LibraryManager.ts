/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Library Manager
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مدير المكتبة - يد manage مكتبة الوسائط
 * 
 * @module Services/Library
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface MediaItem {
  id: string;
  path: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  duration: number;
  size: number;
  format: string;
  type: 'video' | 'audio';
  thumbnail?: string;
  addedAt: Date;
  playCount: number;
  lastPlayed?: Date;
  rating: number;
  tags: string[];
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  items: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryStatistics {
  totalMedia: number;
  totalVideo: number;
  totalAudio: number;
  totalDuration: number;
  totalSize: number;
  mostPlayed: MediaItem[];
  recentlyAdded: MediaItem[];
  recentlyPlayed: MediaItem[];
}

export interface SearchFilters {
  type?: 'video' | 'audio';
  genre?: string;
  year?: number;
  rating?: number;
  tags?: string[];
  query?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة مدير المكتبة
// ═══════════════════════════════════════════════════════════════════════════

export class LibraryManager extends EventEmitter {
  private media: Map<string, MediaItem> = new Map();
  private playlists: Map<string, Playlist> = new Map();
  private isInitialized = false;
  private scanInProgress = false;

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Library Manager...');
      await this.loadLibrary();
      this.isInitialized = true;
      console.log('Library Manager initialized');
    } catch (error) {
      console.error('Failed to initialize Library Manager:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    await this.saveLibrary();
    this.isInitialized = false;
    console.log('Library Manager shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // فحص المكتبة
  // ═════════════════════════════════════════════════════════════════════════

  public async scan(paths: string[]): Promise<void> {
    if (this.scanInProgress) {
      console.warn('Scan already in progress');
      return;
    }

    this.scanInProgress = true;
    this.emit('scan-start');

    try {
      for (const scanPath of paths) {
        await this.scanPath(scanPath);
      }

      await this.saveLibrary();
      this.emit('scan-complete', this.media.size);
    } catch (error) {
      console.error('Scan failed:', error);
      this.emit('scan-error', error);
    } finally {
      this.scanInProgress = false;
    }
  }

  private async scanPath(scanPath: string): Promise<void> {
    try {
      const files = await window.knouxAPI.file.scanDirectory(scanPath, true);
      
      for (const file of files) {
        if (!this.media.has(file)) {
          await this.addMedia(file);
        }
      }
    } catch (error) {
      console.warn('Failed to scan path:', scanPath, error);
    }
  }

  private async addMedia(filePath: string): Promise<void> {
    try {
      const stats = await window.knouxAPI.file.getStats(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const type = this.getMediaType(filePath);

      if (!type) return;

      const media: MediaItem = {
        id: this.generateId(),
        path: filePath,
        title: path.basename(filePath, path.extname(filePath)),
        duration: 0, // Would be extracted from metadata
        size: stats.size,
        format: ext,
        type,
        addedAt: new Date(),
        playCount: 0,
        rating: 0,
        tags: [],
      };

      this.media.set(filePath, media);
      this.emit('media-add', media);
    } catch (error) {
      console.warn('Failed to add media:', filePath, error);
    }
  }

  private getMediaType(filePath: string): 'video' | 'audio' | null {
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp'];
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff'];
    
    const ext = path.extname(filePath).toLowerCase().slice(1);
    
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    return null;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة الوسائط
  // ═════════════════════════════════════════════════════════════════════════

  public getMedia(filters?: SearchFilters): MediaItem[] {
    let items = Array.from(this.media.values());

    if (filters) {
      if (filters.type) {
        items = items.filter((m) => m.type === filters.type);
      }
      if (filters.genre) {
        items = items.filter((m) => m.genre === filters.genre);
      }
      if (filters.year) {
        items = items.filter((m) => m.year === filters.year);
      }
      if (filters.rating) {
        items = items.filter((m) => m.rating >= filters.rating!);
      }
      if (filters.tags && filters.tags.length > 0) {
        items = items.filter((m) => filters.tags!.some((t) => m.tags.includes(t)));
      }
      if (filters.query) {
        const query = filters.query.toLowerCase();
        items = items.filter(
          (m) =>
            m.title.toLowerCase().includes(query) ||
            m.artist?.toLowerCase().includes(query) ||
            m.album?.toLowerCase().includes(query)
        );
      }
    }

    return items;
  }

  public getMediaByPath(filePath: string): MediaItem | undefined {
    return this.media.get(filePath);
  }

  public async updateMedia(filePath: string, updates: Partial<MediaItem>): Promise<void> {
    const media = this.media.get(filePath);
    if (media) {
      Object.assign(media, updates);
      await this.saveLibrary();
      this.emit('media-update', media);
    }
  }

  public async removeMedia(filePath: string): Promise<void> {
    this.media.delete(filePath);
    await this.saveLibrary();
    this.emit('media-remove', filePath);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // قائمة التشغيل
  // ═════════════════════════════════════════════════════════════════════════

  public getPlaylists(): Playlist[] {
    return Array.from(this.playlists.values());
  }

  public getPlaylist(id: string): Playlist | undefined {
    return this.playlists.get(id);
  }

  public async createPlaylist(name: string, items: string[] = []): Promise<string> {
    const id = this.generateId();
    const playlist: Playlist = {
      id,
      name,
      items,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.playlists.set(id, playlist);
    await this.saveLibrary();
    this.emit('playlist-create', playlist);
    return id;
  }

  public async updatePlaylist(id: string, updates: Partial<Playlist>): Promise<void> {
    const playlist = this.playlists.get(id);
    if (playlist) {
      Object.assign(playlist, updates, { updatedAt: new Date() });
      await this.saveLibrary();
      this.emit('playlist-update', playlist);
    }
  }

  public async deletePlaylist(id: string): Promise<void> {
    this.playlists.delete(id);
    await this.saveLibrary();
    this.emit('playlist-delete', id);
  }

  public async addToPlaylist(playlistId: string, mediaPath: string): Promise<void> {
    const playlist = this.playlists.get(playlistId);
    if (playlist && !playlist.items.includes(mediaPath)) {
      playlist.items.push(mediaPath);
      playlist.updatedAt = new Date();
      await this.saveLibrary();
      this.emit('playlist-update', playlist);
    }
  }

  public async removeFromPlaylist(playlistId: string, mediaPath: string): Promise<void> {
    const playlist = this.playlists.get(playlistId);
    if (playlist) {
      playlist.items = playlist.items.filter((p) => p !== mediaPath);
      playlist.updatedAt = new Date();
      await this.saveLibrary();
      this.emit('playlist-update', playlist);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // السجل
  // ═════════════════════════════════════════════════════════════════════════

  public async addToHistory(mediaPath: string, position: number): Promise<void> {
    const media = this.media.get(mediaPath);
    if (media) {
      media.playCount++;
      media.lastPlayed = new Date();
      await this.saveLibrary();
      this.emit('history-add', media, position);
    }
  }

  public getHistory(limit = 20): MediaItem[] {
    return Array.from(this.media.values())
      .filter((m) => m.lastPlayed)
      .sort((a, b) => (b.lastPlayed?.getTime() || 0) - (a.lastPlayed?.getTime() || 0))
      .slice(0, limit);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // المفضلة
  // ═════════════════════════════════════════════════════════════════════════

  public getFavorites(): MediaItem[] {
    return Array.from(this.media.values()).filter((m) => m.rating > 0);
  }

  public async toggleFavorite(mediaPath: string): Promise<boolean> {
    const media = this.media.get(mediaPath);
    if (media) {
      media.rating = media.rating > 0 ? 0 : 5;
      await this.saveLibrary();
      this.emit('favorite-toggle', media);
      return media.rating > 0;
    }
    return false;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // البحث
  // ═════════════════════════════════════════════════════════════════════════

  public search(query: string): MediaItem[] {
    return this.getMedia({ query });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الإحصائيات
  // ═════════════════════════════════════════════════════════════════════════

  public getStatistics(): LibraryStatistics {
    const allMedia = Array.from(this.media.values());
    const videos = allMedia.filter((m) => m.type === 'video');
    const audios = allMedia.filter((m) => m.type === 'audio');

    return {
      totalMedia: allMedia.length,
      totalVideo: videos.length,
      totalAudio: audios.length,
      totalDuration: allMedia.reduce((sum, m) => sum + m.duration, 0),
      totalSize: allMedia.reduce((sum, m) => sum + m.size, 0),
      mostPlayed: allMedia
        .filter((m) => m.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 10),
      recentlyAdded: allMedia
        .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
        .slice(0, 10),
      recentlyPlayed: allMedia
        .filter((m) => m.lastPlayed)
        .sort((a, b) => (b.lastPlayed?.getTime() || 0) - (a.lastPlayed?.getTime() || 0))
        .slice(0, 10),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // تحميل وحفظ المكتبة
  // ═════════════════════════════════════════════════════════════════════════

  private async loadLibrary(): Promise<void> {
    try {
      const data = await window.knouxAPI.settings.get<string>('library', '{}');
      const library = JSON.parse(data);

      if (library.media) {
        for (const [path, media] of Object.entries(library.media)) {
          this.media.set(path, {
            ...(media as MediaItem),
            addedAt: new Date((media as MediaItem).addedAt),
            lastPlayed: (media as MediaItem).lastPlayed ? new Date((media as MediaItem).lastPlayed!) : undefined,
          });
        }
      }

      if (library.playlists) {
        for (const [id, playlist] of Object.entries(library.playlists)) {
          this.playlists.set(id, {
            ...(playlist as Playlist),
            createdAt: new Date((playlist as Playlist).createdAt),
            updatedAt: new Date((playlist as Playlist).updatedAt),
          });
        }
      }
    } catch (error) {
      console.warn('Failed to load library:', error);
    }
  }

  private async saveLibrary(): Promise<void> {
    const library = {
      media: Object.fromEntries(this.media),
      playlists: Object.fromEntries(this.playlists),
    };

    await window.knouxAPI.settings.set('library', JSON.stringify(library));
  }
}
