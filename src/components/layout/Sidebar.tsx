/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Sidebar Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
* الشريط الجانبي - يحتوي على روابط التنقل
 * 
 * @module Components/Layout
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React from 'react';
import { motion } from 'framer-motion';
import { 
  Play, 
  Library, 
  Settings, 
  MessageSquare,
  Heart,
  Clock,
  FolderOpen
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { NeonButton } from '../neon/NeonButton';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

type ViewType = 'player' | 'library' | 'settings';

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون الشريط الجانبي
// ═══════════════════════════════════════════════════════════════════════════

export const Sidebar: React.FC = () => {
  const { currentView, setView, toggleAIAssistant } = useAppStore();

  // ═════════════════════════════════════════════════════════════════════════
  // عناصر التنقل
  // ═════════════════════════════════════════════════════════════════════════

  const navItems: NavItem[] = [
    { id: 'player', label: 'Player', icon: <Play size={18} /> },
    { id: 'library', label: 'Library', icon: <Library size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // معالجات الأحداث
  // ═════════════════════════════════════════════════════════════════════════

  const handleNavClick = (view: ViewType) => {
    setView(view);
  };

  const handleOpenFile = async () => {
    const filePath = await window.knouxAPI.file.openFile();
    if (filePath) {
      // Load and play the file
      await window.knouxAPI.player.load(filePath);
      await window.knouxAPI.player.play();
      setView('player');
    }
  };

  const handleOpenFolder = async () => {
    const folderPath = await window.knouxAPI.file.openDirectory();
    if (folderPath) {
      // Scan folder and add to library
      await window.knouxAPI.library.scan([folderPath]);
      setView('library');
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <motion.aside
      className="sidebar"
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      {/* Quick Actions */}
      <div className="sidebar-section">
        <h3 className="section-title">Quick Actions</h3>
        <div className="quick-actions">
          <NeonButton
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen size={14} />}
            onClick={handleOpenFile}
            fullWidth
          >
            Open File
          </NeonButton>
          
          <NeonButton
            variant="secondary"
            size="sm"
            leftIcon={<Library size={14} />}
            onClick={handleOpenFolder}
            fullWidth
          >
            Open Folder
          </NeonButton>
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-section">
        <h3 className="section-title">Navigation</h3>
        <nav className="nav-menu">
          {navItems.map((item) => (
            <motion.button
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => handleNavClick(item.id)}
              whileHover={{ x: 5 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
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

      {/* Library Shortcuts */}
      <div className="sidebar-section">
        <h3 className="section-title">Library</h3>
        <nav className="nav-menu">
          <motion.button
            className="nav-item"
            onClick={() => setView('library')}
            whileHover={{ x: 5 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="nav-icon"><Heart size={18} /></span>
            <span className="nav-label">Favorites</span>
          </motion.button>
          
          <motion.button
            className="nav-item"
            onClick={() => setView('library')}
            whileHover={{ x: 5 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="nav-icon"><Clock size={18} /></span>
            <span className="nav-label">History</span>
          </motion.button>
        </nav>
      </div>

      {/* AI Assistant */}
      <div className="sidebar-section ai-section">
        <NeonButton
          variant="ghost"
          size="md"
          leftIcon={<MessageSquare size={18} />}
          onClick={toggleAIAssistant}
          fullWidth
        >
          AI Assistant
        </NeonButton>
      </div>

      {/* App Info */}
      <div className="sidebar-footer">
        <span className="version">v1.0.0</span>
      </div>
    </motion.aside>
  );
};
