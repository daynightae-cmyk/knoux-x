import React, { useCallback, useMemo, useState } from 'react';
import {
  BotOff,
  FolderCog,
  Globe2,
  Info,
  MonitorCog,
  Palette,
  ShieldCheck,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { localeCoverage, useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';

type SettingsCategory = 'general' | 'appearance' | 'privacy' | 'media' | 'about';

interface Category {
  id: SettingsCategory;
  labelKey: string;
  icon: React.ReactNode;
}

const accentPresets = ['#8b5cf6', '#6d28d9', '#00d4ff', '#d4af37', '#f472b6', '#22c55e'];

export const SettingsView: React.FC = () => {
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [captureDirectory, setCaptureDirectory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    locale,
    setLocale,
  } = useAppStore();
  const { t } = useTranslation();

  const categories = useMemo<Category[]>(() => [
    { id: 'general', labelKey: 'settings.general', icon: <Globe2 size={18} /> },
    { id: 'appearance', labelKey: 'settings.appearance', icon: <Palette size={18} /> },
    { id: 'privacy', labelKey: 'settings.privacy', icon: <ShieldCheck size={18} /> },
    { id: 'media', labelKey: 'settings.media', icon: <MonitorCog size={18} /> },
    { id: 'about', labelKey: 'settings.about', icon: <Info size={18} /> },
  ], []);

  const loadCaptureDirectory = useCallback(async (): Promise<void> => {
    try {
      setCaptureDirectory(await window.knouxCreativeAPI.capture.getDefaultDirectory());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture settings could not be loaded.');
    }
  }, []);

  const chooseCaptureDirectory = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const directory = await window.knouxCreativeAPI.capture.chooseDefaultDirectory();
      if (directory) setCaptureDirectory(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture folder could not be changed.');
    }
  }, []);

  React.useEffect(() => { void loadCaptureDirectory(); }, [loadCaptureDirectory]);

  return (
    <section className="creative-view settings-view" aria-labelledby="settings-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">KNOUX Player X</span>
          <h1 id="settings-title"><MonitorCog size={30} /> {t('settings.title')}</h1>
          <p>{t('settings.localFirstDescription')}</p>
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="settings-creative-layout">
        <NeonPanel variant="dark" padding="sm" className="settings-creative-nav">
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={category === entry.id ? 'active' : ''}
              onClick={() => setCategory(entry.id)}
            >
              {entry.icon}<span>{t(entry.labelKey)}</span>
            </button>
          ))}
        </NeonPanel>

        <div className="settings-creative-content">
          {category === 'general' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.general')}</h2>
              <div className="setting-card">
                <div><strong>{t('settings.language')}</strong><span>{t('settings.languageDescription')}</span></div>
                <select value={locale} onChange={(event) => setLocale(event.target.value === 'ar' ? 'ar' : 'en')}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <div className="locale-coverage-grid">
                {Object.entries(localeCoverage()).map(([code, coverage]) => (
                  <div key={code}><strong>{code.toUpperCase()}</strong><span>{coverage.translated}/{coverage.total}</span><small>{coverage.percentage}%</small></div>
                ))}
              </div>
            </NeonPanel>
          )}

          {category === 'appearance' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.appearance')}</h2>
              <div className="setting-card">
                <div><strong>{t('settings.theme')}</strong><span>{t('settings.themeDescription')}</span></div>
                <div className="theme-choice-row">
                  {(['dark', 'light', 'auto'] as const).map((value) => (
                    <button key={value} type="button" className={theme === value ? 'active' : ''} onClick={() => setTheme(value)}>{t(`settings.${value}`)}</button>
                  ))}
                </div>
              </div>
              <div className="setting-card">
                <div><strong>{t('settings.accent')}</strong><span>{accentColor}</span></div>
                <div className="accent-choice-row">
                  {accentPresets.map((color) => (
                    <button key={color} type="button" aria-label={color} className={accentColor === color ? 'active' : ''} style={{ backgroundColor: color }} onClick={() => setAccentColor(color)} />
                  ))}
                </div>
              </div>
            </NeonPanel>
          )}

          {category === 'privacy' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.privacy')}</h2>
              <div className="privacy-principles">
                <div><ShieldCheck size={22} /><span><strong>{t('settings.localFirst')}</strong><small>{t('settings.localFirstDescription')}</small></span></div>
                <div><BotOff size={22} /><span><strong>{t('settings.aiDisabled')}</strong><small>No raw media is uploaded by capture, recording, editor, library, or export tools.</small></span></div>
              </div>
            </NeonPanel>
          )}

          {category === 'media' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.media')}</h2>
              <div className="setting-card">
                <div>
                  <strong>{t('settings.captureFolder')}</strong>
                  <span className="capture-path" title={captureDirectory ?? undefined}>{captureDirectory ?? t('capture.chooseOnFirst')}</span>
                </div>
                <NeonButton variant="secondary" leftIcon={<FolderCog size={16} />} onClick={() => void chooseCaptureDirectory()}>{t('settings.changeFolder')}</NeonButton>
              </div>
              <div className="setting-card">
                <div><strong>FFmpeg / FFprobe</strong><span>Capabilities are detected from the packaged runtime and shown only when verified.</span></div>
              </div>
            </NeonPanel>
          )}

          {category === 'about' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.about')}</h2>
              <dl className="about-grid">
                <div><dt>{t('settings.version')}</dt><dd>2.0.0</dd></div>
                <div><dt>{t('settings.developer')}</dt><dd>Eng. Sadek Elgazar (Knoux)</dd></div>
                <div><dt>{t('settings.website')}</dt><dd><button type="button" onClick={() => void window.knouxAPI.system.openExternal('https://knoux.store')}>knoux.store</button></dd></div>
                <div><dt>{t('settings.runtime')}</dt><dd>{navigator.userAgent}</dd></div>
              </dl>
            </NeonPanel>
          )}
        </div>
      </div>
    </section>
  );
};
