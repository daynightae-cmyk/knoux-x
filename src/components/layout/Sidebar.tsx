import React, { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AudioLines,
  Bot,
  Camera,
  Circle,
  Clapperboard,
  FolderOpen,
  Image as ImageIcon,
  Library,
  ListMusic,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Presentation,
  Settings,
  Share2,
} from 'lucide-react';

import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { ViewType } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import { BrandMark } from '../brand/BrandMark';
import { NeonButton } from '../neon/NeonButton';

interface NavItem {
  id: ViewType;
  labelKey: string;
  icon: React.ReactNode;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: 'nav.media',
    items: [
      { id: 'player', labelKey: 'nav.player', icon: <Play size={19} /> },
      { id: 'library', labelKey: 'nav.library', icon: <Library size={19} /> },
      { id: 'queue', labelKey: 'nav.queue', icon: <ListMusic size={19} /> },
    ],
  },
  {
    labelKey: 'nav.create',
    items: [
      { id: 'capture', labelKey: 'nav.captures', icon: <Camera size={19} /> },
      { id: 'recording', labelKey: 'nav.recorder', icon: <Circle size={19} /> },
      { id: 'editor', labelKey: 'nav.editor', icon: <Clapperboard size={19} /> },
      { id: 'image-editor', labelKey: 'nav.imageEditor', icon: <ImageIcon size={19} /> },
      { id: 'slideshow', labelKey: 'nav.slideshow', icon: <Presentation size={19} /> },
      { id: 'audio-tools', labelKey: 'nav.audioTools', icon: <AudioLines size={19} /> },
      { id: 'export', labelKey: 'nav.export', icon: <Share2 size={19} /> },
    ],
  },
  {
    labelKey: 'nav.system',
    items: [
      { id: 'settings', labelKey: 'nav.settings', icon: <Settings size={19} /> },
    ],
  },
];

export const Sidebar: React.FC = () => {
  const {
    currentView,
    setView,
    toggleAIAssistant,
    addNotification,
    sidebarMode,
    setSidebarMode,
    sidebarWidth,
    setSidebarWidth,
    motionEnabled,
  } = useAppStore();
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const { t } = useTranslation();
  const compact = sidebarMode === 'compact';

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

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (compact) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
    const handleMove = (moveEvent: PointerEvent): void => {
      setSidebarWidth(startWidth + ((moveEvent.clientX - startX) * direction));
    };
    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp, { once: true });
  }, [compact, setSidebarWidth, sidebarWidth]);

  const groups = useMemo(() => navGroups, []);

  return (
    <motion.aside
      className={`sidebar ${compact ? 'compact' : 'expanded'}`}
      style={{ width: compact ? 78 : sidebarWidth }}
      initial={motionEnabled ? { x: -24, opacity: 0 } : false}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: motionEnabled ? 0.2 : 0 }}
      aria-label={t('nav.workspace')}
    >
      <div className="sidebar-brand-row">
        <BrandMark size={compact ? 34 : 38} withWordmark={!compact} />
        <button
          type="button"
          className="sidebar-mode-button"
          onClick={() => setSidebarMode(compact ? 'expanded' : 'compact')}
          aria-label={compact ? t('nav.expandSidebar') : t('nav.compactSidebar')}
          title={compact ? t('nav.expandSidebar') : t('nav.compactSidebar')}
        >
          {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="sidebar-section sidebar-quick-section">
        {!compact && <h3 className="section-title">{t('nav.quickActions')}</h3>}
        <div className="quick-actions">
          <NeonButton
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen size={16} />}
            onClick={() => void handleOpenFile()}
            fullWidth
            title={t('nav.openFile')}
            aria-label={t('nav.openFile')}
          >
            {compact ? null : t('nav.openFile')}
          </NeonButton>
          <NeonButton
            variant="secondary"
            size="sm"
            leftIcon={<Library size={16} />}
            onClick={() => void handleOpenFolder()}
            fullWidth
            title={t('nav.addLibraryFolder')}
            aria-label={t('nav.addLibraryFolder')}
          >
            {compact ? null : t('nav.addLibraryFolder')}
          </NeonButton>
        </div>
      </div>

      <div className="sidebar-scroll-section">
        {groups.map((group) => (
          <div className="sidebar-section sidebar-nav-group" key={group.labelKey}>
            {!compact && <h3 className="section-title">{t(group.labelKey)}</h3>}
            <nav className="nav-menu" aria-label={t(group.labelKey)}>
              {group.items.map((item) => (
                <motion.button
                  key={item.id}
                  type="button"
                  className={`nav-item ${currentView === item.id ? 'active' : ''}`}
                  onClick={() => setView(item.id)}
                  whileTap={{ scale: 0.98 }}
                  aria-current={currentView === item.id ? 'page' : undefined}
                  aria-label={t(item.labelKey)}
                  title={compact ? t(item.labelKey) : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {!compact && <span className="nav-label">{t(item.labelKey)}</span>}
                  {currentView === item.id && <motion.span className="active-indicator" layoutId="activeIndicator" />}
                </motion.button>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="sidebar-section ai-section">
        <NeonButton
          variant="ghost"
          size="md"
          leftIcon={<Bot size={18} />}
          onClick={toggleAIAssistant}
          fullWidth
          title={t('nav.optionalAI')}
          aria-label={t('nav.optionalAI')}
        >
          {compact ? null : t('nav.optionalAI')}
        </NeonButton>
      </div>

      {!compact && (
        <div className="sidebar-footer">
          <strong>A Knoux Product</strong>
          <span className="version">KNOUX Player X · 2.0.0</span>
        </div>
      )}
      {!compact && <div className="sidebar-resizer" role="separator" aria-orientation="vertical" onPointerDown={beginResize} />}
    </motion.aside>
  );
};
