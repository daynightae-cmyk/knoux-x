import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  BotOff,
  Copy,
  ExternalLink,
  FolderCog,
  Github,
  Globe2,
  Info,
  Instagram,
  Mail,
  MessageCircle,
  MonitorCog,
  Music2,
  Palette,
  Phone,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { KNOUX_BRAND } from '../../config/brand';
import { localeCoverage, useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { KNOUX_THEME_CATALOG } from '../../theme/knouxThemeCatalog';

type SettingsCategory = 'general' | 'appearance' | 'accessibility' | 'privacy' | 'media' | 'about' | 'developer';

type RuntimeInfo = Awaited<ReturnType<Window['knouxAPI']['system']['getInfo']>>;

interface Category {
  id: SettingsCategory;
  labelKey: string;
  icon: React.ReactNode;
}

const accentPresets = ['#8b5cf6', '#6d28d9', '#00d4ff', '#d4af37', '#f472b6', '#22c55e'];

export const SettingsView: React.FC = () => {
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [captureDirectory, setCaptureDirectory] = useState<string | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    locale,
    setLocale,
    motionEnabled,
    setMotionEnabled,
  } = useAppStore();
  const { t } = useTranslation();

  const categories = useMemo<Category[]>(() => [
    { id: 'general', labelKey: 'settings.general', icon: <Globe2 size={18} /> },
    { id: 'appearance', labelKey: 'settings.appearance', icon: <Palette size={18} /> },
    { id: 'accessibility', labelKey: 'settings.accessibility', icon: <Accessibility size={18} /> },
    { id: 'privacy', labelKey: 'settings.privacy', icon: <ShieldCheck size={18} /> },
    { id: 'media', labelKey: 'settings.media', icon: <MonitorCog size={18} /> },
    { id: 'about', labelKey: 'settings.about', icon: <Info size={18} /> },
    { id: 'developer', labelKey: 'settings.developer', icon: <UserRound size={18} /> },
  ], []);

  const visibleCategories = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    if (!query) return categories;
    return categories.filter((entry) => t(entry.labelKey).toLocaleLowerCase(locale).includes(query));
  }, [categories, locale, searchQuery, t]);

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

  const openExternal = useCallback(async (url: string): Promise<void> => {
    setError(null);
    try {
      const target = new URL(url);
      if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Unsupported link protocol.');
      await window.knouxAPI.system.openExternal(target.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The official link could not be opened.');
    }
  }, []);

  const copyContact = useCallback(async (value: string): Promise<void> => {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(locale === 'ar' ? 'تعذر نسخ بيانات التواصل.' : 'The contact detail could not be copied.');
    }
  }, [locale]);

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    if (!runtimeInfo) return;
    await copyContact(JSON.stringify({ product: 'KNOUX Player X', ...runtimeInfo }, null, 2));
  }, [copyContact, runtimeInfo]);

  useEffect(() => {
    void loadCaptureDirectory();
    void window.knouxAPI.system.getInfo().then(setRuntimeInfo).catch(() => setRuntimeInfo(null));
  }, [loadCaptureDirectory]);

  useEffect(() => {
    if (!searchQuery.trim() || visibleCategories.length === 0) return;
    if (!visibleCategories.some((entry) => entry.id === category)) setCategory(visibleCategories[0].id);
  }, [category, searchQuery, visibleCategories]);

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

      <label className="settings-search-box">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('settings.search')}
        />
      </label>

      <div className="settings-creative-layout">
        <NeonPanel variant="dark" padding="sm" className="settings-creative-nav">
          {visibleCategories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={category === entry.id ? 'active' : ''}
              onClick={() => setCategory(entry.id)}
            >
              {entry.icon}<span>{t(entry.labelKey)}</span>
            </button>
          ))}
          {visibleCategories.length === 0 && <p className="settings-no-results">{t('settings.noResults')}</p>}
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
              <div className="setting-heading">
                <strong>{t('settings.theme')}</strong>
                <span>{t('settings.themeDescription')}</span>
              </div>
              <div className="theme-preview-grid">
                {KNOUX_THEME_CATALOG.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={theme === preset.id ? 'active' : ''}
                    onClick={() => { setTheme(preset.id); setAccentColor(preset.accent); }}
                    aria-pressed={theme === preset.id}
                  >
                    <span className="theme-preview-art" style={{ background: `linear-gradient(145deg, ${preset.background}, ${preset.surface} 62%, ${preset.accent})` }}>
                      <i style={{ backgroundColor: preset.accent }} />
                    </span>
                    <span><strong>{locale === 'ar' ? preset.labelAr : preset.label}</strong><small>{locale === 'ar' ? preset.descriptionAr : preset.description}</small></span>
                  </button>
                ))}
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

          {category === 'accessibility' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.accessibility')}</h2>
              <div className="setting-card">
                <div><strong>{t('settings.motion')}</strong><span>{t('settings.motionDescription')}</span></div>
                <button
                  type="button"
                  className={`settings-toggle ${motionEnabled ? 'active' : ''}`}
                  role="switch"
                  aria-checked={motionEnabled}
                  onClick={() => setMotionEnabled(!motionEnabled)}
                >
                  <span /> {motionEnabled ? t('settings.enabled') : t('settings.disabled')}
                </button>
              </div>
              <div className="setting-card">
                <div><strong>{t('settings.highContrast')}</strong><span>{t('settings.highContrastDescription')}</span></div>
                <NeonButton
                  variant="secondary"
                  onClick={() => {
                    const preset = KNOUX_THEME_CATALOG.find((entry) => entry.id === 'high-contrast');
                    if (preset) { setTheme(preset.id); setAccentColor(preset.accent); }
                  }}
                >
                  {t('settings.apply')}
                </NeonButton>
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
              <div className="about-brand-card">
                <BrandMark size={72} />
                <div>
                  <strong>KNOUX Player X</strong>
                  <p>A Knoux Product · Crafted by {KNOUX_BRAND.developer}</p>
                </div>
              </div>
              <dl className="about-grid">
                <div><dt>{t('settings.version')}</dt><dd>{runtimeInfo?.version ?? '2.0.0'}</dd></div>
                <div><dt>Electron</dt><dd>{runtimeInfo?.electronVersion ?? t('common.unavailable')}</dd></div>
                <div><dt>Chromium</dt><dd>{runtimeInfo?.chromeVersion ?? t('common.unknown')}</dd></div>
                <div><dt>Node.js</dt><dd>{runtimeInfo?.nodeVersion ?? t('common.unavailable')}</dd></div>
                <div><dt>{t('settings.runtime')}</dt><dd>{runtimeInfo ? `${runtimeInfo.platform} · ${runtimeInfo.arch}` : navigator.userAgent}</dd></div>
              </dl>
              <div className="developer-actions">
                <NeonButton variant="secondary" leftIcon={<Copy size={16} />} onClick={() => void copyDiagnostics()} disabled={!runtimeInfo}>{t('settings.copyDiagnostics')}</NeonButton>
                <NeonButton variant="secondary" onClick={() => window.dispatchEvent(new Event('knoux:show-product-tour'))}>{t('settings.productTour')}</NeonButton>
              </div>
            </NeonPanel>
          )}

          {category === 'developer' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.developer')}</h2>
              <div className="developer-hero-card">
                <BrandMark size={84} />
                <div>
                  <span>CRAFTED BY KNOUX</span>
                  <h3>{KNOUX_BRAND.developer}</h3>
                  <p>{t('settings.developerRoles')}</p>
                </div>
              </div>
              <div className="developer-actions" aria-label={locale === 'ar' ? 'روابط المطور الرسمية' : 'Official developer links'}>
                <NeonButton variant="secondary" leftIcon={<ExternalLink size={16} />} onClick={() => void openExternal(KNOUX_BRAND.website)}>Website</NeonButton>
                <NeonButton variant="secondary" leftIcon={<Github size={16} />} onClick={() => void openExternal(KNOUX_BRAND.github)}>GitHub</NeonButton>
                <NeonButton variant="secondary" leftIcon={<Music2 size={16} />} onClick={() => void openExternal(KNOUX_BRAND.tiktok)}>TikTok</NeonButton>
                <NeonButton variant="secondary" leftIcon={<Instagram size={16} />} onClick={() => void openExternal(KNOUX_BRAND.instagram)}>Instagram</NeonButton>
                <NeonButton variant="secondary" leftIcon={<MessageCircle size={16} />} onClick={() => void openExternal(KNOUX_BRAND.whatsapp)}>WhatsApp</NeonButton>
              </div>
              <h3>{t('settings.repositories')}</h3>
              <div className="developer-repositories">
                {KNOUX_BRAND.repositories.map((repository) => (
                  <button type="button" key={repository.url} onClick={() => void openExternal(repository.url)}>
                    <Github size={18} />
                    <span>{repository.name}</span>
                    <ExternalLink size={14} />
                  </button>
                ))}
              </div>
              <div className="developer-contact">
                <button type="button" onClick={() => void copyContact(KNOUX_BRAND.email)}>
                  <Mail size={17} /><span>{KNOUX_BRAND.email}</span><Copy size={14} />
                </button>
                <button type="button" onClick={() => void copyContact(KNOUX_BRAND.phone)}>
                  <Phone size={17} /><span>{KNOUX_BRAND.phone}</span><Copy size={14} />
                </button>
              </div>
            </NeonPanel>
          )}
        </div>
      </div>
    </section>
  );
};
