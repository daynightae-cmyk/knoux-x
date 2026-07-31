import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Square,
  X,
} from 'lucide-react';

import { useTranslation } from '../../i18n';
import { usePlayerStore } from '../../store/playerStore';
import { BrandMark } from '../brand/BrandMark';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const { t } = useTranslation();

  const checkMaximized = useCallback(async (): Promise<void> => {
    try {
      setIsMaximized(await window.knouxAPI.window.isMaximized());
    } catch {
      setIsMaximized(false);
    }
  }, []);

  useEffect(() => {
    void checkMaximized();
    const unsubscribe = window.knouxAPI.window.onResize(() => { void checkMaximized(); });
    return unsubscribe;
  }, [checkMaximized]);

  const handleMinimize = useCallback(async (): Promise<void> => {
    await window.knouxAPI.window.minimize();
  }, []);

  const handleMaximize = useCallback(async (): Promise<void> => {
    await window.knouxAPI.window.maximize();
    await checkMaximized();
  }, [checkMaximized]);

  const handleAlwaysOnTop = useCallback(async (): Promise<void> => {
    const next = !isAlwaysOnTop;
    await window.knouxAPI.window.setAlwaysOnTop(next);
    setIsAlwaysOnTop(next);
  }, [isAlwaysOnTop]);

  const handleClose = useCallback(async (): Promise<void> => {
    await window.knouxAPI.window.close();
  }, []);

  const mediaLabel = currentMedia?.split(/[\\/]/).pop() ?? null;

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <motion.div
          className="app-logo"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <BrandMark size={24} withWordmark />
        </motion.div>

        {mediaLabel && (
          <div className="current-media" title={currentMedia ?? undefined}>
            <span className="separator">|</span>
            <span className="media-title" dir="auto">{mediaLabel}</span>
          </div>
        )}
      </div>

      <div className="title-bar-right">
        <motion.button
          type="button"
          className={`window-control always-on-top ${isAlwaysOnTop ? 'active' : ''}`}
          onClick={() => void handleAlwaysOnTop()}
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
          whileTap={{ scale: 0.9 }}
          aria-pressed={isAlwaysOnTop}
          aria-label={isAlwaysOnTop ? t('window.disableAlwaysOnTop') : t('window.enableAlwaysOnTop')}
          title={isAlwaysOnTop ? t('window.disableAlwaysOnTop') : t('window.enableAlwaysOnTop')}
        >
          {isAlwaysOnTop ? <PinOff size={13} /> : <Pin size={13} />}
        </motion.button>
        <motion.button
          type="button"
          className="window-control minimize"
          onClick={() => void handleMinimize()}
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
          whileTap={{ scale: 0.9 }}
          aria-label={t('window.minimize')}
          title={t('window.minimize')}
        >
          <Minus size={14} />
        </motion.button>
        <motion.button
          type="button"
          className="window-control maximize"
          onClick={() => void handleMaximize()}
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
          whileTap={{ scale: 0.9 }}
          aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
          title={isMaximized ? t('window.restore') : t('window.maximize')}
        >
          {isMaximized ? <Square size={12} /> : <Maximize2 size={12} />}
        </motion.button>
        <motion.button
          type="button"
          className="window-control close"
          onClick={() => void handleClose()}
          whileHover={{ backgroundColor: '#ff4444' }}
          whileTap={{ scale: 0.9 }}
          aria-label={t('window.close')}
          title={t('window.close')}
        >
          <X size={14} />
        </motion.button>
      </div>
    </div>
  );
};
