/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Library View
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * واجهة المكتبة - عرض وإدارة مكتبة الوسائط
 * 
 * @module Features/Library
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  FolderOpen,
  Play,
  Heart,
  MoreVertical,
  Grid,
  List,
  Filter,
  Music,
  Film,
  Clock,
  Calendar,
} from 'lucide-react';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonButton } from '../../components/neon/NeonButton';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

interface MediaItem {
  id: string;
  path: string;
  title: string;
  artist?: string;
  duration: number;
  type: 'video' | 'audio';
  thumbnail?: string;
  addedAt: Date;
  playCount: number;
}

interface Playlist {
  id: string;
  name: string;
  itemCount: number;
}

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'video' | 'audio' | 'favorites' | 'recent';

// ═══════════════════════════════════════════════════════════════════════════
// مكون واجهة المكتبة
// ═══════════════════════════════════════════════════════════════════════════

export const LibraryView: React.FC = () => {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [isScanning, setIsScanning] = useState(false);

  // ═════════════════════════════════════════════════════════════════════════
  // تحميل البيانات
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const mediaItems = await window.knouxAPI.library.getMedia();
      const playlistItems = await window.knouxAPI.library.getPlaylists();
      
      setMedia(mediaItems as MediaItem[]);
      setPlaylists(playlistItems as Playlist[]);
    } catch (error) {
      console.error('Failed to load library:', error);
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // معالجات الأحداث
  // ═════════════════════════════════════════════════════════════════════════

  const handleScan = async () => {
    const folderPath = await window.knouxAPI.file.openDirectory();
    if (folderPath) {
      setIsScanning(true);
      try {
        await window.knouxAPI.library.scan([folderPath]);
        await loadLibrary();
      } catch (error) {
        console.error('Scan failed:', error);
      } finally {
        setIsScanning(false);
      }
    }
  };

  const handlePlay = async (item: MediaItem) => {
    await window.knouxAPI.player.load(item.path);
    await window.knouxAPI.player.play();
  };

  const handleToggleFavorite = async (item: MediaItem) => {
    await window.knouxAPI.library.toggleFavorite(item.path);
    await loadLibrary();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // تصفية البيانات
  // ═════════════════════════════════════════════════════════════════════════

  const filteredMedia = media.filter((item) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        item.title.toLowerCase().includes(query) ||
        item.artist?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }

    // Type filter
    switch (filter) {
      case 'video':
        return item.type === 'video';
      case 'audio':
        return item.type === 'audio';
      case 'favorites':
        // Would need to check favorites
        return true;
      case 'recent':
        // Would need to check recent
        return true;
      default:
        return true;
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // تنسيق الوقت
  // ═════════════════════════════════════════════════════════════════════════

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="library-view">
      {/* Header */}
      <div className="library-header">
        <h1 className="view-title">Library</h1>
        
        <div className="header-actions">
          <NeonButton
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen size={16} />}
            onClick={handleScan}
            isLoading={isScanning}
          >
            Scan Folder
          </NeonButton>
        </div>
      </div>

      {/* Filters and Search */}
      <NeonPanel variant="dark" padding="md" className="filter-bar">
        <div className="filter-tabs">
          {(['all', 'video', 'audio', 'favorites', 'recent'] as FilterType[]).map((f) => (
            <motion.button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </motion.button>
          ))}
        </div>

        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="view-toggle">
          <motion.button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Grid size={18} />
          </motion.button>
          <motion.button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <List size={18} />
          </motion.button>
        </div>
      </NeonPanel>

      {/* Stats */}
      <div className="library-stats">
        <NeonPanel variant="dark" padding="sm" className="stat-item">
          <Film size={20} />
          <span>{media.filter((m) => m.type === 'video').length} Videos</span>
        </NeonPanel>
        <NeonPanel variant="dark" padding="sm" className="stat-item">
          <Music size={20} />
          <span>{media.filter((m) => m.type === 'audio').length} Audio</span>
        </NeonPanel>
        <NeonPanel variant="dark" padding="sm" className="stat-item">
          <Heart size={20} />
          <span>{playlists.length} Playlists</span>
        </NeonPanel>
      </div>

      {/* Media Grid/List */}
      <div className={`media-container ${viewMode}`}>
        <AnimatePresence mode="popLayout">
          {filteredMedia.map((item, index) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2, delay: index * 0.02 }}
            >
              {viewMode === 'grid' ? (
                <MediaCard
                  item={item}
                  onPlay={() => handlePlay(item)}
                  onToggleFavorite={() => handleToggleFavorite(item)}
                />
              ) : (
                <MediaRow
                  item={item}
                  onPlay={() => handlePlay(item)}
                  onToggleFavorite={() => handleToggleFavorite(item)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredMedia.length === 0 && (
          <div className="empty-library">
            <Music size={48} />
            <p>No media found</p>
            <NeonButton variant="primary" onClick={handleScan}>
              Scan for Media
            </NeonButton>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// مكون بطاقة الوسائط
// ═══════════════════════════════════════════════════════════════════════════

interface MediaCardProps {
  item: MediaItem;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ item, onPlay, onToggleFavorite }) => {
  return (
    <NeonPanel
      variant="dark"
      padding="none"
      className="media-card"
      whileHover={{ scale: 1.02 }}
    >
      <div className="card-thumbnail" onClick={onPlay}>
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.title} />
        ) : (
          <div className="thumbnail-placeholder">
            {item.type === 'video' ? <Film size={32} /> : <Music size={32} />}
          </div>
        )}
        <motion.div
          className="play-overlay"
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
        >
          <Play size={32} />
        </motion.div>
        <span className="duration">{formatDuration(item.duration)}</span>
      </div>
      
      <div className="card-info">
        <h4 className="card-title" title={item.title}>
          {item.title}
        </h4>
        {item.artist && <p className="card-artist">{item.artist}</p>}
        
        <div className="card-actions">
          <motion.button
            className="action-btn"
            onClick={onToggleFavorite}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Heart size={16} />
          </motion.button>
          <motion.button
            className="action-btn"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <MoreVertical size={16} />
          </motion.button>
        </div>
      </div>
    </NeonPanel>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// مكون صف الوسائط
// ═══════════════════════════════════════════════════════════════════════════

const MediaRow: React.FC<MediaCardProps> = ({ item, onPlay, onToggleFavorite }) => {
  return (
    <NeonPanel variant="dark" padding="sm" className="media-row">
      <div className="row-icon" onClick={onPlay}>
        {item.type === 'video' ? <Film size={20} /> : <Music size={20} />}
      </div>
      
      <div className="row-info" onClick={onPlay}>
        <span className="row-title">{item.title}</span>
        {item.artist && <span className="row-artist">{item.artist}</span>}
      </div>
      
      <div className="row-meta">
        <span className="row-duration">
          <Clock size={14} />
          {formatDuration(item.duration)}
        </span>
        <span className="row-date">
          <Calendar size={14} />
          {new Date(item.addedAt).toLocaleDateString()}
        </span>
      </div>
      
      <div className="row-actions">
        <motion.button
          className="action-btn"
          onClick={onToggleFavorite}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <Heart size={16} />
        </motion.button>
        <motion.button
          className="action-btn"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <MoreVertical size={16} />
        </motion.button>
      </div>
    </NeonPanel>
  );
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
