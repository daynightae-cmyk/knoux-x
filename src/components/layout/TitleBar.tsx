/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Title Bar Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * شريط العنوان - يحتوي على عناصر التحكم في النافذة
 * 
 * @module Components/Layout
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Minus, 
  Square, 
  X, 
  Maximize2
} from 'lucide-react';

import { BrandMark } from '../brand/BrandMark';
// ═══════════════════════════════════════════════════════════════════════════
// مكون شريط العنوان
// ═══════════════════════════════════════════════════════════════════════════

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentMedia] = useState<string | null>(null);

  // ═════════════════════════════════════════════════════════════════════════
  // معالجات الأحداث
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.knouxAPI.window.isMaximized();
      setIsMaximized(maximized);
    };

    checkMaximized();

    // Listen for window resize events
    const unsubscribe = window.knouxAPI.window.onResize(() => {
      checkMaximized();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleMinimize = async () => {
    await window.knouxAPI.window.minimize();
  };

  const handleMaximize = async () => {
    await window.knouxAPI.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = async () => {
    await window.knouxAPI.window.close();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="title-bar">
      {/* Logo and Title */}
      <div className="title-bar-left">
        <motion.div
          className="app-logo"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <BrandMark size={24} withWordmark />
        </motion.div>
        
        {currentMedia && (
          <div className="current-media">
            <span className="separator">|</span>
            <span className="media-title">{currentMedia}</span>
          </div>
        )}
      </div>

      {/* Window Controls */}
      <div className="title-bar-right">
        <motion.button
          className="window-control minimize"
          onClick={handleMinimize}
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
          whileTap={{ scale: 0.9 }}
        >
          <Minus size={14} />
        </motion.button>
        
        <motion.button
          className="window-control maximize"
          onClick={handleMaximize}
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
          whileTap={{ scale: 0.9 }}
        >
          {isMaximized ? <Square size={12} /> : <Maximize2 size={12} />}
        </motion.button>
        
        <motion.button
          className="window-control close"
          onClick={handleClose}
          whileHover={{ backgroundColor: '#ff4444' }}
          whileTap={{ scale: 0.9 }}
        >
          <X size={14} />
        </motion.button>
      </div>
    </div>
  );
};
