/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - File Manager
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مدير الملفات - يدير العمليات على الملفات
 * 
 * @module Services/File
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  extension: string;
}

export interface DirectoryContents {
  path: string;
  files: FileInfo[];
  directories: FileInfo[];
}

export interface RecentFile {
  path: string;
  lastOpened: Date;
  playCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة مدير الملفات
// ═══════════════════════════════════════════════════════════════════════════

export class FileManager extends EventEmitter {
  private recentFiles: RecentFile[] = [];
  private favorites: Set<string> = new Set();
  private isInitialized = false;

  private readonly mediaExtensions = new Set([
    // Video
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp',
    // Audio
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff',
    // Subtitles
    '.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx',
    // Playlists
    '.m3u', '.m3u8', '.pls',
  ]);

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing File Manager...');
      await this.loadRecentFiles();
      await this.loadFavorites();
      this.isInitialized = true;
      console.log('File Manager initialized');
    } catch (error) {
      console.error('Failed to initialize File Manager:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    await this.saveRecentFiles();
    await this.saveFavorites();
    this.isInitialized = false;
    console.log('File Manager shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // العمليات على الملفات
  // ═════════════════════════════════════════════════════════════════════════

  public async readFile(filePath: string): Promise<Buffer> {
    return window.knouxAPI.file.readFile(filePath);
  }

  public async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    return window.knouxAPI.file.writeFile(filePath, data);
  }

  public async deleteFile(filePath: string): Promise<boolean> {
    return window.knouxAPI.file.deleteFile(filePath);
  }

  public async exists(filePath: string): Promise<boolean> {
    return window.knouxAPI.file.exists(filePath);
  }

  public async getStats(filePath: string): Promise<FileInfo> {
    const stats = await window.knouxAPI.file.getStats(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      created: new Date(stats.created),
      modified: new Date(stats.modified),
      isDirectory: stats.isDirectory,
      extension: path.extname(filePath).toLowerCase(),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // استعراض المجلدات
  // ═════════════════════════════════════════════════════════════════════════

  public async scanDirectory(dirPath: string, recursive = false): Promise<string[]> {
    return window.knouxAPI.file.scanDirectory(dirPath, recursive);
  }

  public async getMediaFiles(dirPath: string, recursive = false): Promise<FileInfo[]> {
    const files = await this.scanDirectory(dirPath, recursive);
    const mediaFiles: FileInfo[] = [];

    for (const file of files) {
      try {
        const info = await this.getStats(file);
        if (this.isMediaFile(file)) {
          mediaFiles.push(info);
        }
      } catch (error) {
        console.warn('Failed to get file stats:', file, error);
      }
    }

    return mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الملفات الحديثة
  // ═════════════════════════════════════════════════════════════════════════

  public async addToRecent(filePath: string): Promise<void> {
    const existingIndex = this.recentFiles.findIndex((f) => f.path === filePath);
    
    if (existingIndex >= 0) {
      const file = this.recentFiles[existingIndex];
      file.lastOpened = new Date();
      file.playCount++;
      // Move to top
      this.recentFiles.splice(existingIndex, 1);
      this.recentFiles.unshift(file);
    } else {
      this.recentFiles.unshift({
        path: filePath,
        lastOpened: new Date(),
        playCount: 1,
      });
    }

    // Keep only last 50
    if (this.recentFiles.length > 50) {
      this.recentFiles = this.recentFiles.slice(0, 50);
    }

    this.emit('recent-change', this.recentFiles);
    await this.saveRecentFiles();
  }

  public getRecentFiles(limit = 20): RecentFile[] {
    return this.recentFiles.slice(0, limit);
  }

  public async clearRecentFiles(): Promise<void> {
    this.recentFiles = [];
    this.emit('recent-change', this.recentFiles);
    await this.saveRecentFiles();
  }

  private async loadRecentFiles(): Promise<void> {
    try {
      const data = await window.knouxAPI.settings.get<string>('recentFiles', '[]');
      this.recentFiles = JSON.parse(data);
    } catch {
      this.recentFiles = [];
    }
  }

  private async saveRecentFiles(): Promise<void> {
    await window.knouxAPI.settings.set('recentFiles', JSON.stringify(this.recentFiles));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // المفضلة
  // ═════════════════════════════════════════════════════════════════════════

  public async addToFavorites(filePath: string): Promise<void> {
    this.favorites.add(filePath);
    this.emit('favorites-change', Array.from(this.favorites));
    await this.saveFavorites();
  }

  public async removeFromFavorites(filePath: string): Promise<void> {
    this.favorites.delete(filePath);
    this.emit('favorites-change', Array.from(this.favorites));
    await this.saveFavorites();
  }

  public isFavorite(filePath: string): boolean {
    return this.favorites.has(filePath);
  }

  public toggleFavorite(filePath: string): boolean {
    if (this.isFavorite(filePath)) {
      this.removeFromFavorites(filePath);
      return false;
    } else {
      this.addToFavorites(filePath);
      return true;
    }
  }

  public getFavorites(): string[] {
    return Array.from(this.favorites);
  }

  private async loadFavorites(): Promise<void> {
    try {
      const data = await window.knouxAPI.settings.get<string>('favorites', '[]');
      this.favorites = new Set(JSON.parse(data));
    } catch {
      this.favorites = new Set();
    }
  }

  private async saveFavorites(): Promise<void> {
    await window.knouxAPI.settings.set('favorites', JSON.stringify(Array.from(this.favorites)));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // المساعدة
  // ═════════════════════════════════════════════════════════════════════════

  public isMediaFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.mediaExtensions.has(ext);
  }

  public getMediaType(filePath: string): 'video' | 'audio' | 'subtitle' | 'playlist' | 'unknown' {
    const ext = path.extname(filePath).toLowerCase();
    
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'];
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff'];
    const subtitleExts = ['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx'];
    const playlistExts = ['.m3u', '.m3u8', '.pls'];

    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (subtitleExts.includes(ext)) return 'subtitle';
    if (playlistExts.includes(ext)) return 'playlist';
    return 'unknown';
  }

  public formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  public async getFileIcon(filePath: string): Promise<string> {
    const type = this.getMediaType(filePath);
    
    const icons: Record<string, string> = {
      video: '🎬',
      audio: '🎵',
      subtitle: '📝',
      playlist: '📋',
      unknown: '📄',
    };

    return icons[type] || icons.unknown;
  }
}
