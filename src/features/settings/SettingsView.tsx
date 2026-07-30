/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Settings View
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * واجهة الإعدادات - إدارة إعدادات التطبيق
 * 
 * @module Features/Settings
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  Palette,
  Volume2,
  Monitor,
  Type,
  FolderOpen,
  Key,
  Info,
  ChevronRight,
  Check,
} from 'lucide-react';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonSlider } from '../../components/neon/NeonSlider';
import { useAppStore } from '../../store/appStore';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'audio'
  | 'video'
  | 'subtitles'
  | 'library'
  | 'ai'
  | 'about';

interface SettingsSection {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون واجهة الإعدادات
// ═══════════════════════════════════════════════════════════════════════════

export const SettingsView: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const { theme, setTheme, accentColor, setAccentColor } = useAppStore();

  // ═════════════════════════════════════════════════════════════════════════
  // تحميل الإعدادات
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const allSettings = await window.knouxAPI.settings.getAll();
      setSettings(allSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const updateSetting = async (key: string, value: unknown) => {
    try {
      await window.knouxAPI.settings.set(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (error) {
      console.error('Failed to update setting:', error);
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // أقسام الإعدادات
  // ═════════════════════════════════════════════════════════════════════════

  const sections: SettingsSection[] = [
    { id: 'general', label: 'General', icon: <Settings size={18} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
    { id: 'audio', label: 'Audio', icon: <Volume2 size={18} /> },
    { id: 'video', label: 'Video', icon: <Monitor size={18} /> },
    { id: 'subtitles', label: 'Subtitles', icon: <Type size={18} /> },
    { id: 'library', label: 'Library', icon: <FolderOpen size={18} /> },
    { id: 'ai', label: 'AI Assistant', icon: <Key size={18} /> },
    { id: 'about', label: 'About', icon: <Info size={18} /> },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="settings-view">
      {/* Header */}
      <div className="settings-header">
        <h1 className="view-title">Settings</h1>
      </div>

      <div className="settings-layout">
        {/* Sidebar */}
        <NeonPanel variant="dark" padding="sm" className="settings-sidebar">
          {sections.map((section) => (
            <motion.button
              key={section.id}
              className={`settings-nav-item ${activeCategory === section.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(section.id)}
              whileHover={{ x: 5 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="nav-icon">{section.icon}</span>
              <span className="nav-label">{section.label}</span>
              <ChevronRight size={16} className="nav-arrow" />
            </motion.button>
          ))}
        </NeonPanel>

        {/* Content */}
        <div className="settings-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {activeCategory === 'general' && (
                <GeneralSettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'appearance' && (
                <AppearanceSettings
                  theme={theme}
                  setTheme={setTheme}
                  accentColor={accentColor}
                  setAccentColor={setAccentColor}
                />
              )}
              {activeCategory === 'audio' && (
                <AudioSettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'video' && (
                <VideoSettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'subtitles' && (
                <SubtitleSettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'library' && (
                <LibrarySettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'ai' && (
                <AISettings settings={settings} onUpdate={updateSetting} />
              )}
              {activeCategory === 'about' && <AboutSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// مكونات الأقسام الفرعية
// ═══════════════════════════════════════════════════════════════════════════

const GeneralSettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <h2>General Settings</h2>
      
      <SettingItem label="Language" description="Select your preferred language">
        <select
          className="setting-select"
          value={(settings.language as string) || 'en'}
          onChange={(e) => onUpdate('language', e.target.value)}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
        </select>
      </SettingItem>

      <SettingItem label="Auto-play" description="Automatically start playback when opening a file">
        <Toggle
          checked={(settings.autoPlay as boolean) ?? true}
          onChange={(v) => onUpdate('autoPlay', v)}
        />
      </SettingItem>

      <SettingItem label="Resume Playback" description="Remember playback position for each file">
        <Toggle
          checked={(settings.resumePlayback as boolean) ?? true}
          onChange={(v) => onUpdate('resumePlayback', v)}
        />
      </SettingItem>

      <SettingItem label="Minimize to Tray" description="Keep running in system tray when minimized">
        <Toggle
          checked={(settings.minimizeToTray as boolean) ?? true}
          onChange={(v) => onUpdate('minimizeToTray', v)}
        />
      </SettingItem>

      <SettingItem label="Show Notifications" description="Display notifications for playback events">
        <Toggle
          checked={(settings.showNotifications as boolean) ?? true}
          onChange={(v) => onUpdate('showNotifications', v)}
        />
      </SettingItem>
    </div>
  );
};

const AppearanceSettings: React.FC<{
  theme: string;
  setTheme: (theme: 'light' | 'dark' | 'auto') => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}> = ({ theme, setTheme, accentColor, setAccentColor }) => {
  const colors = [
    '#00f0ff', // Cyan
    '#ff00f0', // Magenta
    '#32ff64', // Green
    '#ff3232', // Red
    '#ffaa00', // Orange
    '#aa00ff', // Purple
  ];

  return (
    <div className="settings-section">
      <h2>Appearance</h2>

      <SettingItem label="Theme" description="Choose your preferred theme">
        <div className="theme-options">
          {(['light', 'dark', 'auto'] as const).map((t) => (
            <motion.button
              key={t}
              className={`theme-option ${theme === t ? 'active' : ''}`}
              onClick={() => setTheme(t)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </motion.button>
          ))}
        </div>
      </SettingItem>

      <SettingItem label="Accent Color" description="Choose your accent color">
        <div className="color-options">
          {colors.map((color) => (
            <motion.button
              key={color}
              className={`color-option ${accentColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setAccentColor(color)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              {accentColor === color && <Check size={14} color="white" />}
            </motion.button>
          ))}
        </div>
      </SettingItem>
    </div>
  );
};

const AudioSettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <h2>Audio Settings</h2>

      <SettingItem label="Default Volume" description="Set the default volume level">
        <NeonSlider
          value={((settings.defaultVolume as number) ?? 0.8) * 100}
          min={0}
          max={100}
          onChange={(v) => onUpdate('defaultVolume', v / 100)}
          glowColor="#00f0ff"
        />
      </SettingItem>

      <SettingItem label="Enable DSP" description="Enable digital signal processing for enhanced audio">
        <Toggle
          checked={(settings.enableDSP as boolean) ?? true}
          onChange={(v) => onUpdate('enableDSP', v)}
        />
      </SettingItem>

      <SettingItem label="Audio Device" description="Select your audio output device">
        <select
          className="setting-select"
          value={(settings.audioDevice as string) || 'default'}
          onChange={(e) => onUpdate('audioDevice', e.target.value)}
        >
          <option value="default">Default</option>
          <option value="speakers">Speakers</option>
          <option value="headphones">Headphones</option>
        </select>
      </SettingItem>
    </div>
  );
};

const VideoSettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <h2>Video Settings</h2>

      <SettingItem label="Hardware Acceleration" description="Use GPU for video decoding">
        <Toggle
          checked={(settings.hardwareAcceleration as boolean) ?? true}
          onChange={(v) => onUpdate('hardwareAcceleration', v)}
        />
      </SettingItem>

      <SettingItem label="Deinterlace" description="Enable deinterlacing for interlaced video">
        <Toggle
          checked={(settings.deinterlace as boolean) ?? false}
          onChange={(v) => onUpdate('deinterlace', v)}
        />
      </SettingItem>

      <SettingItem label="Default Aspect Ratio" description="Set the default aspect ratio">
        <select
          className="setting-select"
          value={(settings.aspectRatio as string) || 'auto'}
          onChange={(e) => onUpdate('aspectRatio', e.target.value)}
        >
          <option value="auto">Auto</option>
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="21:9">21:9</option>
        </select>
      </SettingItem>
    </div>
  );
};

const SubtitleSettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <h2>Subtitle Settings</h2>

      <SettingItem label="Enable Subtitles" description="Show subtitles by default">
        <Toggle
          checked={(settings.subtitleEnabled as boolean) ?? true}
          onChange={(v) => onUpdate('subtitleEnabled', v)}
        />
      </SettingItem>

      <SettingItem label="Default Language" description="Preferred subtitle language">
        <select
          className="setting-select"
          value={(settings.subtitleLanguage as string) || 'en'}
          onChange={(e) => onUpdate('subtitleLanguage', e.target.value)}
        >
          <option value="en">English</option>
          <option value="ar">Arabic</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
      </SettingItem>

      <SettingItem label="Font Size" description="Default subtitle font size">
        <NeonSlider
          value={(settings.subtitleSize as number) ?? 24}
          min={12}
          max={48}
          onChange={(v) => onUpdate('subtitleSize', v)}
          glowColor="#00f0ff"
        />
      </SettingItem>
    </div>
  );
};

const LibrarySettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <h2>Library Settings</h2>

      <SettingItem label="Auto Scan" description="Automatically scan library folders on startup">
        <Toggle
          checked={(settings.autoScan as boolean) ?? false}
          onChange={(v) => onUpdate('autoScan', v)}
        />
      </SettingItem>

      <SettingItem label="Library Paths" description="Folders to include in your library">
        <NeonButton variant="secondary" size="sm" leftIcon={<FolderOpen size={14} />}>
          Manage Folders
        </NeonButton>
      </SettingItem>

      <SettingItem label="Cache Size" description="Maximum cache size in MB">
        <NeonSlider
          value={(settings.cacheSize as number) ?? 512}
          min={128}
          max={2048}
          step={128}
          onChange={(v) => onUpdate('cacheSize', v)}
          glowColor="#00f0ff"
        />
      </SettingItem>
    </div>
  );
};

const AISettings: React.FC<{
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}> = ({ settings, onUpdate }) => {
  const [apiKey, setApiKey] = useState((settings.geminiApiKey as string) || '');

  const saveApiKey = () => {
    onUpdate('geminiApiKey', apiKey);
  };

  return (
    <div className="settings-section">
      <h2>AI Assistant</h2>

      <SettingItem label="Gemini API Key" description="Enter your Gemini API key to enable AI features">
        <div className="api-key-input">
          <input
            type="password"
            className="setting-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your API key"
          />
          <NeonButton variant="primary" size="sm" onClick={saveApiKey}>
            Save
          </NeonButton>
        </div>
      </SettingItem>

      <div className="setting-info">
        <Info size={16} />
        <p>
          Your API key is stored locally and never shared. Get your key from{' '}
          <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
            Google AI Studio
          </a>
        </p>
      </div>
    </div>
  );
};

const AboutSection: React.FC = () => {
  return (
    <div className="settings-section about-section">
      <h2>About KNOUX Player X</h2>

      <div className="about-logo">
        <span className="logo-text">KNOUX</span>
        <span className="logo-subtitle">Player X™</span>
      </div>

      <div className="about-info">
        <p><strong>Version:</strong> 1.0.0</p>
        <p><strong>Electron:</strong> 28.0.0</p>
        <p><strong>React:</strong> 18.2.0</p>
        <p><strong>TypeScript:</strong> 5.3.0</p>
      </div>

      <p className="about-description">
        KNOUX Player X is a next-generation media player with AI integration,
        featuring advanced DSP audio processing, intelligent subtitle synchronization,
        and a stunning neon glassmorphism UI.
      </p>

      <div className="about-links">
        <NeonButton variant="ghost" size="sm" onClick={() => window.knouxAPI.system.openExternal('https://knoux.dev')}>
          Website
        </NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={() => window.knouxAPI.system.openExternal('https://github.com/knoux/player-x')}>
          GitHub
        </NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={() => window.knouxAPI.system.openExternal('https://docs.knoux.dev')}>
          Documentation
        </NeonButton>
      </div>

      <p className="about-copyright">
        © 2024 KNOUX Development Team. All rights reserved.
      </p>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// مكونات مساعدة
// ═══════════════════════════════════════════════════════════════════════════

const SettingItem: React.FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
}> = ({ label, description, children }) => {
  return (
    <NeonPanel variant="dark" padding="md" className="setting-item">
      <div className="setting-info">
        <label className="setting-label">{label}</label>
        {description && <p className="setting-description">{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </NeonPanel>
  );
};

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, onChange }) => {
  return (
    <motion.button
      className={`toggle ${checked ? 'active' : ''}`}
      onClick={() => onChange(!checked)}
      whileTap={{ scale: 0.95 }}
    >
      <motion.div
        className="toggle-thumb"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </motion.button>
  );
};
