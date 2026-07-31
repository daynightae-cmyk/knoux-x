import React from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  Camera,
  Circle,
  Clapperboard,
  FolderOpen,
  Library,
  ListMusic,
  Play,
  Settings,
  Share2,
} from 'lucide-react';

import { useTranslation } from '../../i18n';
import { useAppStore, ViewType } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import { NeonButton } from '../neon/NeonButton';

interface NavItem {
  id: ViewType;
  labelKey: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'player', labelKey: 'nav.player', icon: <Play size={18} /> },
  { id: 'queue', labelKey: 'nav.queue', icon: <ListMusic size={18} /> },
  { id: 'library', labelKey: 'nav.library', icon: <Library size={18} /> },
  { id: 'capture', labelKey: 'nav.captures', icon: <Camera size={18} /> },
  { id: 'recording', labelKey: 'nav.recorder', icon: <Circle size={18} /> },
  { id: 'editor', labelKey: 'nav.editor', icon: <Clapperboard size={18} /> },
  { id: 'export', labelKey: 'nav.export', icon: <Share2 size={18} /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings size={18} /> },
];

export const Sidebar: React.FC = () => {
  const { currentView, setView, toggleAIAssistant, addNotification } = useAppStore();
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const { t } = useTranslation();

  const handleOpenFile = async (): Promise<void> => {
    const selected = await window.knouxCreativeAPI.media.open();
    if (!selected) return;
    setCurrentMedia(selected.filePath);
    setView('player');
  };

  const handleOpenFolder = async (): Promise<void> => {
    try {
      const folder = await window.knouxCreativeAPI.library.chooseFolder();
      if (!folder) return;
      setView('library');
      await window.knouxCreativeAPI.library.scan(folder.path);
      addNotification({
        type: 'success',
        title: t('library.updated'),
        message: `${folder.name}: ${t('library.indexed')}`,
      });
    } catch (reason) {
      addNotification({
        type: 'error',
        title: t('library.scanFailed'),
        message: reason instanceof Error ? reason.message : t('library.scanFailed'),
      });
    }
  };

  return (
    <motion.aside
      className="sidebar"
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="sidebar-section">
        <h3 className="section-title">{t('nav.quickActions')}</h3>
        <div className="quick-actions">
          <NeonButton
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen size={14} />}
            onClick={() => void handleOpenFile()}
            fullWidth
          >
            {t('nav.openFile')}
          </NeonButton>
          <NeonButton
            variant="secondary"
            size="sm"
            leftIcon={<Library size={14} />}
            onClick={() => void handleOpenFolder()}
            fullWidth
          >
            {t('nav.addLibraryFolder')}
          </NeonButton>
        </div>
      </div>

      <div className="sidebar-section sidebar-scroll-section">
        <h3 className="section-title">{t('nav.workspace')}</h3>
        <nav className="nav-menu" aria-label="KNOUX workspace">
          {navItems.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
              aria-current={currentView === item.id ? 'page' : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{t(item.labelKey)}</span>
              {currentView === item.id && (
                <motion.div
                  className="active-indicator"
                  layoutId="activeIndicator"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </motion.button>
          ))}
        </nav>
      </div>

      <div className="sidebar-section ai-section">
        <NeonButton
          variant="ghost"
          size="md"
          leftIcon={<Bot size={18} />}
          onClick={toggleAIAssistant}
          fullWidth
        >
          {t('nav.optionalAI')}
        </NeonButton>
      </div>

      <div className="sidebar-footer">
        <span className="version">KNOUX Player X v2.0.0</span>
      </div>
    </motion.aside>
  );
};
