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
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import path from 'path';

import { app } from 'electron';

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
  private storageDirectory: string | null;

  constructor(storageDirectory?: string) {
    super();
    this.storageDirectory = storageDirectory ?? null;
  }

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
    return readFile(filePath);
  }

  public async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  public async deleteFile(filePath: string): Promise<boolean> {
    try {
      await rm(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  public async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async getStats(filePath: string): Promise<FileInfo> {
    const details = await stat(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: details.size,
      created: details.birthtime,
      modified: details.mtime,
      isDirectory: details.isDirectory(),
      extension: path.extname(filePath).toLowerCase(),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // استعراض المجلدات
  // ═════════════════════════════════════════════════════════════════════════

  public async scanDirectory(dirPath: string, recursive = false): Promise<string[]> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile()) files.push(fullPath);
      else if (recursive && entry.isDirectory()) files.push(...await this.scanDirectory(fullPath, true));
    }
    return files;
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
    const saved = await this.readJson<RecentFile[]>('recent-files.json', []);
    this.recentFiles = saved.map((entry) => ({ ...entry, lastOpened: new Date(entry.lastOpened) }));
  }

  private async saveRecentFiles(): Promise<void> {
    await this.writeJson('recent-files.json', this.recentFiles);
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

  private resolveStoragePath(fileName: string): string {
    this.storageDirectory ??= join(app.getPath('userData'), 'files');
    return join(this.storageDirectory, fileName);
  }

  private async readJson<T>(fileName: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(this.resolveStoragePath(fileName), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Failed to read ${fileName}:`, error);
      return fallback;
    }
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    const storagePath = this.resolveStoragePath(fileName);
    const temporaryPath = `${storagePath}.tmp`;
    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, storagePath);
  }

  private async loadFavorites(): Promise<void> {
    this.favorites = new Set(await this.readJson<string[]>('favorites.json', []));
  }

  private async saveFavorites(): Promise<void> {
    await this.writeJson('favorites.json', Array.from(this.favorites));
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
