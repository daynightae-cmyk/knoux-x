/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Playlist Manager
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مدير قائمة التشغيل - يد manage قائمة التشغيل الحالية
 * 
 * @module Services/Playlist
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface PlaylistItem {
  id: string;
  path: string;
  title: string;
  artist?: string;
  duration: number;
  thumbnail?: string;
}

export interface CurrentPlaylist {
  id: string;
  name: string;
  items: PlaylistItem[];
  currentIndex: number;
  loop: boolean;
  shuffle: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة مدير قائمة التشغيل
// ═══════════════════════════════════════════════════════════════════════════

export class PlaylistManager extends EventEmitter {
  private playlist: CurrentPlaylist;
  private isInitialized = false;
  private shuffleOrder: number[] = [];

  constructor() {
    super();
    this.playlist = {
      id: 'current',
      name: 'Current Playlist',
      items: [],
      currentIndex: -1,
      loop: false,
      shuffle: false,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Playlist Manager...');
      await this.loadPlaylist();
      this.isInitialized = true;
      console.log('Playlist Manager initialized');
    } catch (error) {
      console.error('Failed to initialize Playlist Manager:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    await this.savePlaylist();
    this.isInitialized = false;
    console.log('Playlist Manager shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة العناصر
  // ═════════════════════════════════════════════════════════════════════════

  public setItems(items: PlaylistItem[]): void {
    this.playlist.items = [...items];
    this.playlist.currentIndex = items.length > 0 ? 0 : -1;
    this.generateShuffleOrder();
    this.emit('items-change', this.playlist.items);
  }

  public addItem(item: PlaylistItem, index?: number): void {
    if (index !== undefined && index >= 0 && index <= this.playlist.items.length) {
      this.playlist.items.splice(index, 0, item);
    } else {
      this.playlist.items.push(item);
    }

    if (this.playlist.currentIndex === -1) {
      this.playlist.currentIndex = 0;
    }

    this.generateShuffleOrder();
    this.emit('item-add', item);
    this.emit('items-change', this.playlist.items);
  }

  public removeItem(index: number): void {
    if (index >= 0 && index < this.playlist.items.length) {
      const item = this.playlist.items.splice(index, 1)[0];

      if (index < this.playlist.currentIndex) {
        this.playlist.currentIndex--;
      } else if (index === this.playlist.currentIndex) {
        if (this.playlist.currentIndex >= this.playlist.items.length) {
          this.playlist.currentIndex = this.playlist.items.length - 1;
        }
      }

      this.generateShuffleOrder();
      this.emit('item-remove', item);
      this.emit('items-change', this.playlist.items);
    }
  }

  public moveItem(fromIndex: number, toIndex: number): void {
    if (
      fromIndex >= 0 &&
      fromIndex < this.playlist.items.length &&
      toIndex >= 0 &&
      toIndex < this.playlist.items.length
    ) {
      const [item] = this.playlist.items.splice(fromIndex, 1);
      this.playlist.items.splice(toIndex, 0, item);

      if (fromIndex === this.playlist.currentIndex) {
        this.playlist.currentIndex = toIndex;
      } else if (fromIndex < this.playlist.currentIndex && toIndex >= this.playlist.currentIndex) {
        this.playlist.currentIndex--;
      } else if (fromIndex > this.playlist.currentIndex && toIndex <= this.playlist.currentIndex) {
        this.playlist.currentIndex++;
      }

      this.generateShuffleOrder();
      this.emit('items-change', this.playlist.items);
    }
  }

  public clear(): void {
    this.playlist.items = [];
    this.playlist.currentIndex = -1;
    this.shuffleOrder = [];
    this.emit('clear');
    this.emit('items-change', this.playlist.items);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التنقل
  // ═════════════════════════════════════════════════════════════════════════

  public getCurrentItem(): PlaylistItem | null {
    if (this.playlist.currentIndex >= 0 && this.playlist.currentIndex < this.playlist.items.length) {
      return this.playlist.items[this.playlist.currentIndex];
    }
    return null;
  }

  public getCurrentIndex(): number {
    return this.playlist.currentIndex;
  }

  public setCurrentIndex(index: number): void {
    if (index >= 0 && index < this.playlist.items.length) {
      this.playlist.currentIndex = index;
      this.emit('current-change', this.getCurrentItem(), index);
    }
  }

  public next(): PlaylistItem | null {
    if (this.playlist.items.length === 0) return null;

    if (this.playlist.shuffle) {
      const currentShuffleIndex = this.shuffleOrder.indexOf(this.playlist.currentIndex);
      const nextShuffleIndex = (currentShuffleIndex + 1) % this.shuffleOrder.length;
      this.playlist.currentIndex = this.shuffleOrder[nextShuffleIndex];
    } else {
      this.playlist.currentIndex++;
      if (this.playlist.currentIndex >= this.playlist.items.length) {
        if (this.playlist.loop) {
          this.playlist.currentIndex = 0;
        } else {
          this.playlist.currentIndex = this.playlist.items.length - 1;
          return null;
        }
      }
    }

    this.emit('current-change', this.getCurrentItem(), this.playlist.currentIndex);
    return this.getCurrentItem();
  }

  public previous(): PlaylistItem | null {
    if (this.playlist.items.length === 0) return null;

    if (this.playlist.shuffle) {
      const currentShuffleIndex = this.shuffleOrder.indexOf(this.playlist.currentIndex);
      const prevShuffleIndex = (currentShuffleIndex - 1 + this.shuffleOrder.length) % this.shuffleOrder.length;
      this.playlist.currentIndex = this.shuffleOrder[prevShuffleIndex];
    } else {
      this.playlist.currentIndex--;
      if (this.playlist.currentIndex < 0) {
        if (this.playlist.loop) {
          this.playlist.currentIndex = this.playlist.items.length - 1;
        } else {
          this.playlist.currentIndex = 0;
          return null;
        }
      }
    }

    this.emit('current-change', this.getCurrentItem(), this.playlist.currentIndex);
    return this.getCurrentItem();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الخيارات
  // ═════════════════════════════════════════════════════════════════════════

  public setLoop(loop: boolean): void {
    this.playlist.loop = loop;
    this.emit('loop-change', loop);
  }

  public getLoop(): boolean {
    return this.playlist.loop;
  }

  public setShuffle(shuffle: boolean): void {
    this.playlist.shuffle = shuffle;
    if (shuffle) {
      this.generateShuffleOrder();
    }
    this.emit('shuffle-change', shuffle);
  }

  public getShuffle(): boolean {
    return this.playlist.shuffle;
  }

  private generateShuffleOrder(): void {
    this.shuffleOrder = Array.from({ length: this.playlist.items.length }, (_, i) => i);
    
    // Fisher-Yates shuffle
    for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // معلومات
  // ═════════════════════════════════════════════════════════════════════════

  public getItems(): PlaylistItem[] {
    return [...this.playlist.items];
  }

  public getItem(index: number): PlaylistItem | null {
    return this.playlist.items[index] || null;
  }

  public getItemCount(): number {
    return this.playlist.items.length;
  }

  public getTotalDuration(): number {
    return this.playlist.items.reduce((sum, item) => sum + item.duration, 0);
  }

  public hasNext(): boolean {
    if (this.playlist.shuffle) return true;
    return this.playlist.currentIndex < this.playlist.items.length - 1 || this.playlist.loop;
  }

  public hasPrevious(): boolean {
    if (this.playlist.shuffle) return true;
    return this.playlist.currentIndex > 0 || this.playlist.loop;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // تحميل وحفظ
  // ═════════════════════════════════════════════════════════════════════════

  private async loadPlaylist(): Promise<void> {
    try {
      const data = await window.knouxAPI.settings.get<string>('currentPlaylist', '{}');
      const saved = JSON.parse(data);
      
      if (saved.items) {
        this.playlist.items = saved.items;
        this.playlist.currentIndex = saved.currentIndex || -1;
        this.playlist.loop = saved.loop || false;
        this.playlist.shuffle = saved.shuffle || false;
      }
    } catch (error) {
      console.warn('Failed to load playlist:', error);
    }
  }

  private async savePlaylist(): Promise<void> {
    await window.knouxAPI.settings.set('currentPlaylist', JSON.stringify({
      items: this.playlist.items,
      currentIndex: this.playlist.currentIndex,
      loop: this.playlist.loop,
      shuffle: this.playlist.shuffle,
    }));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // استيراد وتصدير
  // ═════════════════════════════════════════════════════════════════════════

  public exportToM3U(): string {
    let m3u = '#EXTM3U\n';
    
    for (const item of this.playlist.items) {
      m3u += `#EXTINF:${Math.round(item.duration)},${item.artist || ''} - ${item.title}\n`;
      m3u += `${item.path}\n`;
    }

    return m3u;
  }

  public async importFromM3U(m3uContent: string): Promise<void> {
    const lines = m3uContent.split('\n');
    const items: PlaylistItem[] = [];
    let currentInfo: Partial<PlaylistItem> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#EXTINF:')) {
        const match = trimmed.match(/#EXTINF:(-?\d+),(.+)/);
        if (match) {
          currentInfo.duration = parseInt(match[1], 10);
          const titleParts = match[2].split(' - ');
          if (titleParts.length > 1) {
            currentInfo.artist = titleParts[0];
            currentInfo.title = titleParts[1];
          } else {
            currentInfo.title = match[2];
          }
        }
      } else if (trimmed && !trimmed.startsWith('#')) {
        items.push({
          id: `${Date.now()}-${Math.random()}`,
          path: trimmed,
          title: currentInfo.title || trimmed.split('/').pop() || 'Unknown',
          artist: currentInfo.artist,
          duration: currentInfo.duration || 0,
        });
        currentInfo = {};
      }
    }

    this.setItems(items);
  }
}
