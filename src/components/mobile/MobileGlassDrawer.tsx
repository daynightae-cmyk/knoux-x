import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  Folder,
  Home,
  Image as ImageIcon,
  Images,
  Mic2,
  Play,
  Settings,
  Share2,
  Sparkles,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore, type ViewType } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import { readRecentMedia } from '../../features/player/mobilePlayerSession';

const items: Array<{ view: ViewType; label: string; icon: LucideIcon }> = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'player', label: 'Player', icon: Play },
  { view: 'library', label: 'Library', icon: Folder },
  { view: 'editor', label: 'Video Studio', icon: Video },
  { view: 'slideshow', label: 'Photos to Video', icon: Images },
  { view: 'image-editor', label: 'Image Editor', icon: ImageIcon },
  { view: 'image-studio', label: 'Beauty Retouch', icon: Sparkles },
  { view: 'audio-tools', label: 'Audio Tools', icon: AudioLines },
  { view: 'export', label: 'Export', icon: Share2 },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export const MobileGlassDrawer: React.FC = () => {
  const open = useAppStore((state) => state.isMobileMenuOpen);
  const currentView = useAppStore((state) => state.currentView);
  const setOpen = useAppStore((state) => state.setMobileMenuOpen);
  const setView = useAppStore((state) => state.setView);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const recents = readRecentMedia(window.localStorage).slice(0, 3);

  const selectView = (view: ViewType): void => {
    setView(view);
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="kmd-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => setOpen(false)}
        >
          <motion.aside
            className="kmd-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="KNOUX X navigation"
            initial={{ x: '-102%' }}
            animate={{ x: 0 }}
            exit={{ x: '-102%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kmd-brand-row">
              <div className="kmd-brand"><BrandMark size={74} /><div><strong>KNOUX <span>X</span></strong><small>CREATE · PLAY · ENHANCE</small></div></div>
              <button type="button" className="kmd-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={22} /></button>
            </div>

            <div className="kmd-profile">
              <div className="kmd-profile-avatar"><Sparkles size={22} /></div>
              <div><strong>Sadek Elgazar</strong><small>Creative Explorer</small></div>
            </div>

            <nav className="kmd-nav">
              {items.map(({ view, label, icon: Icon }) => (
                <button type="button" key={view} className={currentView === view ? 'active' : ''} onClick={() => selectView(view)}>
                  <Icon size={22} /><span>{label}</span><b>›</b>
                </button>
              ))}
            </nav>

            <section className="kmd-recents">
              <div className="kmd-section-title"><span>RECENT MEDIA</span><button type="button" onClick={() => selectView('library')}>See all</button></div>
              {recents.length ? (
                <div className="kmd-recent-grid">
                  {recents.map((entry) => (
                    <button type="button" key={entry.mediaPath} onClick={() => { setCurrentMedia(entry.mediaPath); selectView('player'); }}>
                      <span><Play size={18} fill="currentColor" /></span>
                      <strong>{entry.title}</strong>
                      <small>{Math.round(entry.progress * 100)}%</small>
                    </button>
                  ))}
                </div>
              ) : <p>No recent media yet.</p>}
            </section>

            <button type="button" className="kmd-create" onClick={() => selectView('editor')}><Mic2 size={20} /> Create something amazing <span>+</span></button>
            <footer>MORE THAN MEDIA · KNOUX X</footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
