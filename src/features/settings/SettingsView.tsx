import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  AudioLines,
  BotOff,
  Copy,
  Download,
  ExternalLink,
  FolderCog,
  FolderPlus,
  HardDrive,
  Info,
  MonitorCog,
  Palette,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { KNOUX_BRAND } from '../../config/brand';
import {
  APPLICATION_SETTING_KEYS,
  parseApplicationSettings,
  type ApplicationSettingKey,
  type ApplicationSettings,
} from '../../core/settings/applicationSettings';
import { localeCoverage, useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { ThemeType } from '../../store/appStore';
import { KNOUX_THEME_CATALOG } from '../../theme/knouxThemeCatalog';

import { CustomizationSettingsPanel } from './CustomizationSettingsPanel';

type SettingsCategory =
  | 'general'
  | 'playback'
  | 'audio'
  | 'video'
  | 'subtitles'
  | 'appearance'
  | 'accessibility'
  | 'customization'
  | 'storage'
  | 'privacy'
  | 'developer'
  | 'diagnostics'
  | 'about';

type RuntimeInfo = Awaited<ReturnType<Window['knouxAPI']['system']['getInfo']>>;
type IpcHealth = Awaited<ReturnType<Window['knouxAPI']['system']['getIpcHealth']>>;

interface Category {
  id: SettingsCategory;
  labelKey: string;
  icon: React.ReactNode;
}

interface AudioDeviceOption {
  id: string;
  label: string;
}

const equalizerFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const accentPresets = ['#8b5cf6', '#6d28d9', '#00d4ff', '#d4af37', '#f472b6', '#22c55e'];

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function isTheme(value: string): value is ThemeType {
  return KNOUX_THEME_CATALOG.some((preset) => preset.id === value);
}

function ToggleSetting({
  checked,
  disabled = false,
  onChange,
  enabledLabel,
  disabledLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
  enabledLabel: string;
  disabledLabel: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? 'active' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span /> {checked ? enabledLabel : disabledLabel}
    </button>
  );
}

export const SettingsView: React.FC = () => {
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [captureDirectory, setCaptureDirectory] = useState<string | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [ipcHealth, setIpcHealth] = useState<IpcHealth | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    setTheme,
    setAccentColor,
    setLocale,
    setMotionEnabled,
  } = useAppStore();
  const { locale, t } = useTranslation();

  const categories = useMemo<Category[]>(() => [
    { id: 'general', labelKey: 'settings.general', icon: <MonitorCog size={18} /> },
    { id: 'playback', labelKey: 'settings.playback', icon: <Play size={18} /> },
    { id: 'audio', labelKey: 'settings.audio', icon: <AudioLines size={18} /> },
    { id: 'video', labelKey: 'settings.video', icon: <Video size={18} /> },
    { id: 'subtitles', labelKey: 'settings.subtitles', icon: <Subtitles size={18} /> },
    { id: 'appearance', labelKey: 'settings.appearance', icon: <Palette size={18} /> },
    { id: 'accessibility', labelKey: 'settings.accessibility', icon: <Accessibility size={18} /> },
    { id: 'customization', labelKey: 'settings.customization', icon: <SlidersHorizontal size={18} /> },
    { id: 'storage', labelKey: 'settings.storage', icon: <HardDrive size={18} /> },
    { id: 'privacy', labelKey: 'settings.privacy', icon: <ShieldCheck size={18} /> },
    { id: 'developer', labelKey: 'settings.developerCenter', icon: <SlidersHorizontal size={18} /> },
    { id: 'diagnostics', labelKey: 'settings.diagnostics', icon: <HardDrive size={18} /> },
    { id: 'about', labelKey: 'settings.about', icon: <Info size={18} /> },
  ], []);

  const visibleCategories = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    if (!query) return categories;
    return categories.filter((entry) => t(entry.labelKey).toLocaleLowerCase(locale).includes(query));
  }, [categories, locale, searchQuery, t]);

  const applyUiSettings = useCallback((next: ApplicationSettings): void => {
    setLocale(next.language);
    if (isTheme(next.theme)) setTheme(next.theme);
    setAccentColor(next.accentColor);
    setMotionEnabled(next.motionEnabled);
  }, [setAccentColor, setLocale, setMotionEnabled, setTheme]);

  const loadSettings = useCallback(async (applyToUi = false): Promise<void> => {
    setError(null);
    try {
      const loaded = parseApplicationSettings(await window.knouxAPI.settings.getAll());
      setSettings(loaded);
      if (applyToUi) applyUiSettings(loaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.loadFailed'));
    }
  }, [applyUiSettings, t]);

  const loadRuntimeDetails = useCallback(async (): Promise<void> => {
    const results = await Promise.allSettled([
      window.knouxCreativeAPI.capture.getDefaultDirectory(),
      window.knouxAPI.system.getInfo(),
      navigator.mediaDevices?.enumerateDevices?.() ?? Promise.resolve([]),
    ]);
    if (results[0].status === 'fulfilled') setCaptureDirectory(results[0].value);
    if (results[1].status === 'fulfilled') setRuntimeInfo(results[1].value);
    if (results[2].status === 'fulfilled') {
      const devices = results[2].value
        .filter((device) => device.kind === 'audiooutput')
        .map((device, index) => ({
          id: device.deviceId || `output-${index}`,
          label: device.label || `${t('settings.audioDevice')} ${index + 1}`,
        }));
      setAudioDevices(devices);
    }
  }, [t]);

  const refreshIpcHealth = useCallback(async (): Promise<void> => {
    setIpcHealth(await window.knouxAPI.system.getIpcHealth());
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadRuntimeDetails();
    return window.knouxAPI.settings.onChange((key, value) => {
      if (!APPLICATION_SETTING_KEYS.has(key as ApplicationSettingKey)) return;
      setSettings((current) => current ? { ...current, [key]: value } as ApplicationSettings : current);
    });
  }, [loadRuntimeDetails, loadSettings]);

  useEffect(() => {
    if (!searchQuery.trim() || visibleCategories.length === 0) return;
    if (!visibleCategories.some((entry) => entry.id === category)) setCategory(visibleCategories[0].id);
  }, [category, searchQuery, visibleCategories]);

  const updateSetting = useCallback(async <K extends ApplicationSettingKey>(
    key: K,
    value: ApplicationSettings[K],
  ): Promise<void> => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.knouxAPI.settings.set(key, value);
      const next = { ...settings, [key]: value } as ApplicationSettings;
      setSettings(next);
      if (key === 'language' || key === 'theme' || key === 'accentColor' || key === 'motionEnabled') {
        applyUiSettings(next);
      }
      setNotice(t('settings.saved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [applyUiSettings, busy, settings, t]);

  const chooseCaptureDirectory = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const directory = await window.knouxCreativeAPI.capture.chooseDefaultDirectory();
      if (directory) setCaptureDirectory(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    }
  }, [t]);

  const addLibraryFolder = useCallback(async (): Promise<void> => {
    if (!settings) return;
    setError(null);
    try {
      const directory = await window.knouxAPI.file.openDirectory({ title: t('settings.addLibraryFolder') });
      if (!directory || settings.libraryPaths.includes(directory)) return;
      await updateSetting('libraryPaths', [...settings.libraryPaths, directory]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    }
  }, [settings, t, updateSetting]);

  const exportSettings = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const destination = await window.knouxAPI.file.saveFile({
        title: t('settings.exportSettings'),
        defaultPath: 'KNOUX-Player-X.settings.json',
        filters: [{ name: 'KNOUX Settings', extensions: ['json'] }],
      });
      if (!destination) return;
      await window.knouxAPI.file.writeFile(destination, await window.knouxAPI.settings.export());
      setNotice(t('settings.exported'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const importSettings = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const source = await window.knouxAPI.file.openFile({
        title: t('settings.importSettings'),
        filters: [{ name: 'KNOUX Settings', extensions: ['json'] }],
      });
      if (!source) return;
      const raw = await window.knouxAPI.file.readFile(source);
      const text = new TextDecoder().decode(raw);
      await window.knouxAPI.settings.import(text);
      await loadSettings(true);
      setNotice(t('settings.imported'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    } finally {
      setBusy(false);
    }
  }, [loadSettings, t]);

  const resetSettings = useCallback(async (): Promise<void> => {
    if (!window.confirm(t('settings.resetConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await window.knouxAPI.settings.reset();
      await loadSettings(true);
      setNotice(t('settings.resetComplete'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    } finally {
      setBusy(false);
    }
  }, [loadSettings, t]);

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    if (!runtimeInfo || !settings) return;
    const diagnostics = JSON.stringify({
      product: 'KNOUX Player X',
      runtime: runtimeInfo,
      settings: {
        language: settings.language,
        theme: settings.theme,
        hardwareAcceleration: settings.hardwareAcceleration,
        logLevel: settings.logLevel,
      },
    }, null, 2);
    await navigator.clipboard.writeText(diagnostics);
    setNotice(t('settings.copyDiagnostics'));
  }, [runtimeInfo, settings, t]);

  const openExternal = useCallback(async (url: string): Promise<void> => {
    try {
      await window.knouxAPI.system.openExternal(new URL(url).toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.operationFailed'));
    }
  }, [t]);

  if (!settings) {
    return <section className="creative-view"><div className={error ? 'creative-error' : 'creative-loading'}>{error ?? t('settings.loadFailed')}</div></section>;
  }

  const toggle = (key: ApplicationSettingKey, labelKey: string, description?: string): React.ReactElement => {
    const value = Boolean(settings[key]);
    return (
      <div className="setting-card">
        <div><strong>{t(labelKey)}</strong>{description && <span>{description}</span>}</div>
        <ToggleSetting
          checked={value}
          disabled={busy}
          onChange={(next) => void updateSetting(key as never, next as never)}
          enabledLabel={t('settings.enabled')}
          disabledLabel={t('settings.disabled')}
        />
      </div>
    );
  };

  return (
    <section
      className="creative-view settings-view settings-runtime-view"
      aria-labelledby="settings-title"
      data-sprint02-surface={category === 'about' ? 'About' : category === 'developer' ? 'Developer Center' : category === 'diagnostics' ? 'Diagnostics' : 'Settings'}
    >
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">KNOUX Player X · Local Preferences</span>
          <h1 id="settings-title"><MonitorCog size={30} /> {t('settings.title')}</h1>
          <p>{t('settings.description')}</p>
        </div>
        <div className="settings-status-pill"><ShieldCheck size={15} /> {t('settings.saved')}</div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}
      {notice && <div className="creative-success" role="status">{notice}</div>}

      <label className="settings-search-box">
        <Search size={18} aria-hidden="true" />
        <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('settings.search')} />
      </label>

      <div className="settings-creative-layout settings-runtime-layout">
        <NeonPanel variant="dark" padding="sm" className="settings-creative-nav">
          {visibleCategories.map((entry) => (
            <button key={entry.id} type="button" data-settings-category={entry.id} className={category === entry.id ? 'active' : ''} onClick={() => setCategory(entry.id)}>
              {entry.icon}<span>{t(entry.labelKey)}</span>
            </button>
          ))}
          {visibleCategories.length === 0 && <p className="settings-no-results">{t('settings.noResults')}</p>}
        </NeonPanel>

        <div className="settings-creative-content settings-runtime-content">
          {category === 'general' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.general')}</h2>
              <div className="setting-card">
                <div><strong>{t('settings.language')}</strong><span>{localeCoverage()[settings.language].percentage}%</span></div>
                <select value={settings.language} disabled={busy} onChange={(event) => void updateSetting('language', event.target.value === 'ar' ? 'ar' : 'en')}>
                  <option value="en">English</option><option value="ar">العربية</option>
                </select>
              </div>
              {toggle('minimizeToTray', 'settings.minimizeToTray')}
              {toggle('showNotifications', 'settings.showNotifications')}
              {toggle('rememberWindowState', 'settings.rememberWindowState')}
            </NeonPanel>
          )}

          {category === 'playback' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.playback')}</h2>
              {toggle('autoPlay', 'settings.autoPlay')}
              {toggle('resumePlayback', 'settings.resumePlayback')}
              {toggle('muted', 'settings.muted')}
              <label className="settings-range-card"><span>{t('settings.defaultVolume')} · {Math.round(settings.defaultVolume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={settings.defaultVolume} onChange={(event) => void updateSetting('defaultVolume', Number(event.target.value))} /></label>
              <div className="setting-card"><div><strong>{t('settings.playbackRate')}</strong></div><select value={settings.playbackRate} onChange={(event) => void updateSetting('playbackRate', Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div>
            </NeonPanel>
          )}

          {category === 'audio' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.audio')}</h2>
              <div className="setting-card"><div><strong>{t('settings.audioDevice')}</strong></div><select value={settings.audioDevice} onChange={(event) => void updateSetting('audioDevice', event.target.value)}><option value="default">{t('settings.systemDefault')}</option>{audioDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></div>
              {toggle('enableDSP', 'settings.enableDSP')}
              <div className="settings-section-heading"><strong>{t('settings.equalizer')}</strong><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateSetting('equalizer', new Array(10).fill(0))}>{t('settings.resetEqualizer')}</NeonButton></div>
              <div className="settings-equalizer-grid">
                {equalizerFrequencies.map((frequency, index) => (
                  <label key={frequency}><strong>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</strong><input type="range" min="-20" max="20" step="0.5" value={settings.equalizer[index]} onChange={(event) => void updateSetting('equalizer', settings.equalizer.map((gain, band) => band === index ? Number(event.target.value) : gain))} /><span>{settings.equalizer[index].toFixed(1)} dB</span></label>
                ))}
              </div>
            </NeonPanel>
          )}

          {category === 'video' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.video')}</h2>
              {toggle('hardwareAcceleration', 'settings.hardwareAcceleration', t('settings.hardwareRestart'))}
              {toggle('deinterlace', 'settings.deinterlace')}
              <label className="settings-range-card">
                <span>{t('settings.brightness')} · {settings.brightness}%</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  value={settings.brightness}
                  onChange={(event) => void updateSetting('brightness', Number(event.target.value))}
                />
              </label>
              <label className="settings-range-card">
                <span>{t('settings.contrast')} · {settings.contrast}%</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  value={settings.contrast}
                  onChange={(event) => void updateSetting('contrast', Number(event.target.value))}
                />
              </label>
              <div className="setting-card"><div><strong>{t('settings.aspectRatio')}</strong></div><select value={settings.aspectRatio} onChange={(event) => void updateSetting('aspectRatio', event.target.value as ApplicationSettings['aspectRatio'])}>{['auto', '16:9', '4:3', '21:9', '1:1'].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></div>
            </NeonPanel>
          )}

          {category === 'subtitles' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.subtitles')}</h2>
              {toggle('subtitleEnabled', 'settings.subtitleEnabled')}
              <div className="settings-two-columns">
                <label><span>{t('settings.subtitleLanguage')}</span><select value={settings.subtitleLanguage} onChange={(event) => void updateSetting('subtitleLanguage', event.target.value)}><option value="auto">Auto</option><option value="en">English</option><option value="ar">العربية</option></select></label>
                <label><span>{t('settings.subtitlePosition')}</span><select value={settings.subtitlePosition} onChange={(event) => void updateSetting('subtitlePosition', event.target.value as ApplicationSettings['subtitlePosition'])}><option value="top">{t('settings.top')}</option><option value="center">{t('settings.center')}</option><option value="bottom">{t('settings.bottom')}</option></select></label>
                <label><span>{t('settings.subtitleSize')} · {settings.subtitleSize}px</span><input type="range" min="12" max="96" step="1" value={settings.subtitleSize} onChange={(event) => void updateSetting('subtitleSize', Number(event.target.value))} /></label>
                <label><span>{t('settings.subtitleColor')}</span><input type="color" value={settings.subtitleColor.slice(0, 7)} onChange={(event) => void updateSetting('subtitleColor', event.target.value)} /></label>
                <label><span>{t('settings.subtitleBackground')}</span><input type="color" value={settings.subtitleBackground.slice(0, 7)} onChange={(event) => void updateSetting('subtitleBackground', `${event.target.value}cc`)} /></label>
              </div>
            </NeonPanel>
          )}

          {category === 'appearance' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.appearance')}</h2>
              <div className="theme-preview-grid">
                {KNOUX_THEME_CATALOG.map((preset) => (
                  <button type="button" key={preset.id} className={settings.theme === preset.id ? 'active' : ''} onClick={() => { void updateSetting('theme', preset.id); void updateSetting('accentColor', preset.accent); }}>
                    <span className="theme-preview-art" style={{ background: `linear-gradient(145deg, ${preset.background}, ${preset.surface} 62%, ${preset.accent})` }}><i style={{ backgroundColor: preset.accent }} /></span>
                    <span><strong>{locale === 'ar' ? preset.labelAr : preset.label}</strong><small>{locale === 'ar' ? preset.descriptionAr : preset.description}</small></span>
                  </button>
                ))}
              </div>
              <div className="setting-card"><div><strong>{t('settings.accent')}</strong><span>{settings.accentColor}</span></div><div className="accent-choice-row">{accentPresets.map((color) => <button key={color} type="button" aria-label={color} className={settings.accentColor === color ? 'active' : ''} style={{ backgroundColor: color }} onClick={() => void updateSetting('accentColor', color)} />)}</div></div>
            </NeonPanel>
          )}

          {category === 'accessibility' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.accessibility')}</h2>
              {toggle('motionEnabled', 'settings.motion')}
              <div className="setting-card"><div><strong>High Contrast</strong><span>Apply the verified KNOUX high-contrast theme.</span></div><NeonButton variant="secondary" onClick={() => void updateSetting('theme', 'high-contrast')}>{t('settings.enabled')}</NeonButton></div>
            </NeonPanel>
          )}

          {category === 'customization' && (
            <CustomizationSettingsPanel
              settings={settings}
              busy={busy}
              updateSetting={updateSetting}
              reportError={setError}
              reportNotice={setNotice}
            />
          )}

          {category === 'storage' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.storage')}</h2>
              <div className="setting-card"><div><strong>{t('settings.captureFolder')}</strong><span className="capture-path" title={captureDirectory ?? undefined}>{captureDirectory ?? '—'}</span></div><NeonButton variant="secondary" leftIcon={<FolderCog size={16} />} onClick={() => void chooseCaptureDirectory()}>{t('settings.chooseCaptureFolder')}</NeonButton></div>
              <div className="settings-section-heading"><strong>{t('settings.libraryPaths')}</strong><NeonButton variant="secondary" size="sm" leftIcon={<FolderPlus size={14} />} onClick={() => void addLibraryFolder()}>{t('settings.addLibraryFolder')}</NeonButton></div>
              <div className="settings-folder-list">
                {settings.libraryPaths.map((folder) => <div key={folder}><span title={folder}>{basename(folder)}</span><code dir="auto">{folder}</code><button type="button" aria-label={t('settings.removeFolder')} onClick={() => void updateSetting('libraryPaths', settings.libraryPaths.filter((entry) => entry !== folder))}><Trash2 size={15} /></button></div>)}
                {settings.libraryPaths.length === 0 && <div className="creative-empty">—</div>}
              </div>
              {toggle('autoScan', 'settings.autoScan')}
              <label className="settings-range-card"><span>{t('settings.cacheSize')} · {settings.cacheSizeMB} MB</span><input type="range" min="64" max="8192" step="64" value={settings.cacheSizeMB} onChange={(event) => void updateSetting('cacheSizeMB', Number(event.target.value))} /></label>
              <div className="setting-card"><div><strong>{t('settings.logLevel')}</strong></div><select value={settings.logLevel} onChange={(event) => void updateSetting('logLevel', event.target.value as ApplicationSettings['logLevel'])}>{['debug', 'info', 'warn', 'error'].map((level) => <option key={level} value={level}>{level.toUpperCase()}</option>)}</select></div>
              <div className="settings-backup-actions">
                <NeonButton variant="secondary" leftIcon={<Download size={15} />} onClick={() => void exportSettings()} disabled={busy}>{t('settings.exportSettings')}</NeonButton>
                <NeonButton variant="secondary" leftIcon={<Upload size={15} />} onClick={() => void importSettings()} disabled={busy}>{t('settings.importSettings')}</NeonButton>
                <NeonButton variant="danger" leftIcon={<RotateCcw size={15} />} onClick={() => void resetSettings()} disabled={busy}>{t('settings.resetSettings')}</NeonButton>
              </div>
            </NeonPanel>
          )}

          {category === 'privacy' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.privacy')}</h2>
              <div className="privacy-principles settings-privacy-grid">
                <div><ShieldCheck size={22} /><span><strong>{t('settings.localPersistence')}</strong><small>{t('settings.losslessPersistence')}</small></span></div>
                <div><BotOff size={22} /><span><strong>{t('settings.noTelemetry')}</strong><small>{t('settings.optionalAI')}</small></span></div>
                <div><HardDrive size={22} /><span><strong>{t('settings.mediaOffline')}</strong><small>{t('settings.ffmpegVerified')}</small></span></div>
              </div>
            </NeonPanel>
          )}

          {category === 'developer' && (
            <NeonPanel variant="dark" padding="lg" data-component="DeveloperCenter">
              <h2>{t('settings.developerCenter')}</h2>
              <p>Typed command, IPC, build identity, and packaged-runtime foundation.</p>
              <dl className="about-grid">
                <div><dt>Version</dt><dd>{runtimeInfo?.version ?? '—'}</dd></div>
                <div><dt>SHA</dt><dd>{runtimeInfo?.sha ?? '—'}</dd></div>
                <div><dt>Branch</dt><dd>{runtimeInfo?.branch ?? '—'}</dd></div>
                <div><dt>Runtime</dt><dd>{runtimeInfo?.packaged ? 'Packaged Desktop' : 'Development Desktop'}</dd></div>
              </dl>
              <div className="developer-actions">
                <NeonButton data-command-id="developer.refresh-build" variant="secondary" onClick={() => void loadRuntimeDetails()}>Refresh build identity</NeonButton>
                <NeonButton data-command-id="developer.copy-build" variant="secondary" disabled={!runtimeInfo} onClick={() => void navigator.clipboard.writeText(JSON.stringify(runtimeInfo, null, 2))}>Copy build identity</NeonButton>
              </div>
            </NeonPanel>
          )}

          {category === 'diagnostics' && (
            <NeonPanel variant="dark" padding="lg" data-component="DiagnosticsFoundation">
              <h2>{t('settings.diagnostics')}</h2>
              <p>Authoritative startup IPC state and recorder diagnostics share the packaged runtime.</p>
              <dl className="about-grid">
                <div><dt>Status</dt><dd>{ipcHealth?.status ?? 'Not sampled'}</dd></div>
                <div><dt>Exposed</dt><dd>{ipcHealth?.exposed.length ?? '—'}</dd></div>
                <div><dt>Registered</dt><dd>{ipcHealth?.registered.length ?? '—'}</dd></div>
                <div><dt>Missing</dt><dd>{ipcHealth?.missing.length ?? '—'}</dd></div>
              </dl>
              <div className="developer-actions">
                <NeonButton data-command-id="diagnostics.refresh" variant="secondary" onClick={() => void refreshIpcHealth()}>Refresh diagnostics</NeonButton>
                <NeonButton data-command-id="diagnostics.open-overlay" variant="secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true }))}>Open live diagnostics</NeonButton>
              </div>
            </NeonPanel>
          )}

          {category === 'about' && (
            <NeonPanel variant="dark" padding="lg">
              <h2>{t('settings.about')}</h2>
              <div className="about-brand-card"><BrandMark size={72} /><div><strong>KNOUX Player X</strong><p>A Knoux Product · Crafted by {KNOUX_BRAND.developer}</p></div></div>
              <dl className="about-grid">
                <div><dt>{t('settings.version')}</dt><dd>{runtimeInfo?.version ?? '2.0.0'}</dd></div>
                <div><dt>Electron</dt><dd>{runtimeInfo?.electronVersion ?? '—'}</dd></div>
                <div><dt>Chromium</dt><dd>{runtimeInfo?.chromeVersion ?? '—'}</dd></div>
                <div><dt>Node.js</dt><dd>{runtimeInfo?.nodeVersion ?? '—'}</dd></div>
                <div><dt>{t('settings.runtime')}</dt><dd>{runtimeInfo ? `${runtimeInfo.platform} · ${runtimeInfo.arch}` : '—'}</dd></div>
              </dl>
              <div className="developer-actions">
                <NeonButton variant="secondary" leftIcon={<Copy size={16} />} onClick={() => void copyDiagnostics()} disabled={!runtimeInfo}>{t('settings.copyDiagnostics')}</NeonButton>
                <NeonButton variant="secondary" onClick={() => window.dispatchEvent(new Event('knoux:show-product-tour'))}>{t('settings.productTour')}</NeonButton>
                <NeonButton variant="secondary" leftIcon={<ExternalLink size={16} />} onClick={() => void openExternal(KNOUX_BRAND.website)}>{t('settings.website')}</NeonButton>
              </div>
            </NeonPanel>
          )}
        </div>
      </div>
    </section>
  );
};
