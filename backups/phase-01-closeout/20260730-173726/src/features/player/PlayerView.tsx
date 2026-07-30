/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Player View
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * واجهة المشغل - عرض الفيديو والضوابط
 * 
 * @module Features/Player
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Settings,
  Subtitles,
  Repeat,
  Shuffle,
  ListMusic,
  Image as ImageIcon,
} from 'lucide-react';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSlider } from '../../components/neon/NeonSlider';
import { usePlayerStore } from '../../store/playerStore';

// ═══════════════════════════════════════════════════════════════════════════
// مكون واجهة المشغل
// ═══════════════════════════════════════════════════════════════════════════

export const PlayerView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    loop,
    shuffle,
    play,
    pause,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    toggleLoop,
    toggleShuffle,
    next,
    previous,
  } = usePlayerStore();

  // ═════════════════════════════════════════════════════════════════════════
  // إعداد عنصر الفيديو
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (videoRef.current) {
      // Attach to player service
      window.knouxAPI.player.onStateChange((state) => {
        // Update store with state
      });

      window.knouxAPI.player.onTimeUpdate((time) => {
        // Update current time
      });
    }
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // معالجات التحكم
  // ═════════════════════════════════════════════════════════════════════════

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      await window.knouxAPI.player.pause();
      pause();
    } else {
      await window.knouxAPI.player.play();
      play();
    }
  }, [isPlaying, play, pause]);

  const handleSeek = useCallback((value: number) => {
    const time = (value / 100) * duration;
    window.knouxAPI.player.seek(time);
    seek(time);
  }, [duration, seek]);

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value / 100);
    window.knouxAPI.player.setVolume(value / 100);
  }, [setVolume]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  }, [isPlaying]);

  // ═════════════════════════════════════════════════════════════════════════
  // تنسيق الوقت
  // ═════════════════════════════════════════════════════════════════════════

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div
      ref={containerRef}
      className="player-view"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video Container */}
      <div className="video-container">
        {currentMedia ? (
          <video
            ref={videoRef}
            className="video-element"
            src={currentMedia}
            onClick={handlePlayPause}
          />
        ) : (
          <div className="empty-state">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="empty-content"
            >
              <ImageIcon size={64} className="empty-icon" />
              <h2>No Media Loaded</h2>
              <p>Open a file to start playing</p>
              <NeonButton
                variant="primary"
                onClick={async () => {
                  const filePath = await window.knouxAPI.file.openFile();
                  if (filePath) {
                    await window.knouxAPI.player.load(filePath);
                    await window.knouxAPI.player.play();
                  }
                }}
              >
                Open File
              </NeonButton>
            </motion.div>
          </div>
        )}
      </div>

      {/* Controls Overlay */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            className="controls-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Top Bar */}
            <div className="controls-top">
              <NeonPanel variant="dark" padding="sm" borderGlow={false}>
                <span className="media-title">
                  {currentMedia ? currentMedia.split('/').pop() : 'No media'}
                </span>
              </NeonPanel>
            </div>

            {/* Bottom Controls */}
            <div className="controls-bottom">
              <NeonPanel variant="dark" padding="md">
                {/* Progress Bar */}
                <div className="progress-section">
                  <span className="time-display">{formatTime(currentTime)}</span>
                  <NeonSlider
                    value={progress}
                    min={0}
                    max={100}
                    step={0.1}
                    onChange={handleSeek}
                    glowColor="#00f0ff"
                    showTooltip
                    tooltipFormatter={(v) => formatTime((v / 100) * duration)}
                  />
                  <span className="time-display">{formatTime(duration)}</span>
                </div>

                {/* Control Buttons */}
                <div className="control-buttons">
                  {/* Left Group */}
                  <div className="control-group">
                    <motion.button
                      className={`control-btn ${shuffle ? 'active' : ''}`}
                      onClick={toggleShuffle}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Shuffle size={18} />
                    </motion.button>
                    
                    <motion.button
                      className="control-btn"
                      onClick={previous}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <SkipBack size={22} />
                    </motion.button>
                  </div>

                  {/* Center Group - Play/Pause */}
                  <div className="control-group center">
                    <NeonButton
                      variant="primary"
                      size="lg"
                      glowIntensity="high"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                    </NeonButton>
                  </div>

                  {/* Right Group */}
                  <div className="control-group">
                    <motion.button
                      className="control-btn"
                      onClick={next}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <SkipForward size={22} />
                    </motion.button>
                    
                    <motion.button
                      className={`control-btn ${loop ? 'active' : ''}`}
                      onClick={toggleLoop}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Repeat size={18} />
                    </motion.button>
                  </div>

                  {/* Volume */}
                  <div className="volume-control">
                    <motion.button
                      className="control-btn"
                      onClick={toggleMute}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </motion.button>
                    <div className="volume-slider">
                      <NeonSlider
                        value={muted ? 0 : volume * 100}
                        min={0}
                        max={100}
                        onChange={handleVolumeChange}
                        glowColor="#00f0ff"
                        height="sm"
                      />
                    </div>
                  </div>

                  {/* Extra Controls */}
                  <div className="control-group">
                    <motion.button
                      className="control-btn"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Subtitles size={18} />
                    </motion.button>
                    
                    <motion.button
                      className="control-btn"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <ListMusic size={18} />
                    </motion.button>
                    
                    <motion.button
                      className="control-btn"
                      onClick={() => window.knouxAPI.window.setFullscreen(true)}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Maximize size={18} />
                    </motion.button>
                  </div>
                </div>
              </NeonPanel>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
