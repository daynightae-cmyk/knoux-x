import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Clipboard,
  Crop,
  Edit3,
  FolderCog,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  RefreshCw,
  Save,
  ScanLine,
  Timer,
  X,
} from 'lucide-react';

import type {
  DesktopCaptureMode,
  DesktopCaptureResult,
  RegionAspectPreset,
} from '../../../electron/creative/region-capture-service';
import type { DesktopCaptureSource } from '../../../electron/preload-creative';
import type { CaptureUploadConsent } from '../../../electron/creative/capture-consent-store';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import type { CaptureFormat } from '../../core/creative/capture';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';

const delays = [0, 3, 5, 10] as const;
const aspectPresets: RegionAspectPreset[] = ['free', '1:1', '4:3', '16:9', '9:16', '21:9'];
const formats: CaptureFormat[] = ['png', 'jpeg', 'webp'];

function sourceKind(source: DesktopCaptureSource): 'screen' | 'window' {
  return source.id.startsWith('screen:') ? 'screen' : 'window';
}

function displayPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export const CaptureView: React.FC = () => {
  const [captures, setCaptures] = useState<string[]>([]);
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [mode, setMode] = useState<DesktopCaptureMode>('region');
  const [format, setFormat] = useState<CaptureFormat>('png');
  const [delaySeconds, setDelaySeconds] = useState<(typeof delays)[number]>(0);
  const [aspectPreset, setAspectPreset] = useState<RegionAspectPreset>('free');
  const [jpegQuality, setJpegQuality] = useState(92);
  const [save, setSave] = useState(true);
  const [copyToClipboard, setCopyToClipboard] = useState(false);
  const [defaultDirectory, setDefaultDirectory] = useState<string | null>(null);
  const [result, setResult] = useState<DesktopCaptureResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [uploadConsent, setUploadConsent] = useState<CaptureUploadConsent | null>(null);
  const [searchResultUrl, setSearchResultUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuInvokerRef = useRef<HTMLElement | null>(null);
  const setView = useAppStore((state) => state.setView);
  const setImageEditorSource = useImageEditorStore((state) => state.setSource);
  const { t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview'
    && typeof window.knouxCreativeAPI?.capture?.captureDesktop === 'function';
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextCaptures, directory, nextSources] = await Promise.all([
        window.knouxCreativeAPI.capture.getRecent(),
        window.knouxCreativeAPI.capture.getDefaultDirectory(),
        desktopRuntime ? window.knouxCreativeAPI.capture.getDesktopSources() : Promise.resolve([]),
      ]);
      setCaptures(nextCaptures);
      setDefaultDirectory(directory);
      setSources(nextSources);
      setSelectedSourceId((current) => (
        nextSources.some((source) => source.id === current) ? current : nextSources[0]?.id ?? ''
      ));
      const retainedResponse = await window.knouxCreativeAPI.capture.listRetained();
      const retained = Array.isArray(retainedResponse) ? retainedResponse[0] : null;
      if (retained) {
        const stored = await window.knouxCreativeAPI.capture.retainedAction(retained.id, 'get');
        if (stored && !Array.isArray(stored) && 'summary' in stored && 'dataUrl' in stored) {
          setResult((current) => current ?? {
            retained: stored.summary, sourceId: stored.summary.sourceId, sourceName: stored.summary.sourceName,
            displayId: stored.summary.displayId, mode: 'region', format: stored.summary.format, dataUrl: stored.dataUrl,
            outputPath: stored.summary.outputPath,
            selection: { x: 0, y: 0, width: stored.summary.width, height: stored.summary.height },
            pixelSelection: { x: 0, y: 0, width: stored.summary.width, height: stored.summary.height },
            imageSize: { width: stored.summary.width, height: stored.summary.height }, scale: { x: 1, y: 1 }, openActionMenu: false,
          });
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('capture.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [desktopRuntime, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const chooseDirectory = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const directory = await window.knouxCreativeAPI.capture.chooseDefaultDirectory();
      if (directory) setDefaultDirectory(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('capture.folderFailed'));
    }
  }, [t]);

  const runCapture = useCallback(async (requestedMode: DesktopCaptureMode = mode): Promise<void> => {
    if (!desktopRuntime || !selectedSource || capturing || (!save && !copyToClipboard)) return;
    setCapturing(true);
    setError(null);
    setResult(null);
    try {
      const next = await window.knouxCreativeAPI.capture.captureDesktop({
        sourceId: selectedSource.id,
        mode: requestedMode,
        format,
        save,
        copyToClipboard,
        delaySeconds,
        aspectPreset,
        jpegQuality,
      });
      if (!next) return;
      setResult(next);
      if (next.outputPath) {
        setCaptures(await window.knouxCreativeAPI.capture.getRecent());
        setDefaultDirectory(next.outputPath.replace(/[\\/][^\\/]+$/, ''));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('capture.desktopFailed'));
    } finally {
      setCapturing(false);
    }
  }, [
    aspectPreset,
    capturing,
    copyToClipboard,
    delaySeconds,
    desktopRuntime,
    format,
    jpegQuality,
    mode,
    save,
    selectedSource,
    t,
  ]);

  useEffect(() => {
    const handleCommand = (event: Event): void => {
      if ((event as CustomEvent<{ command?: string }>).detail?.command !== 'region-capture') return;
      setMode('region');
      void runCapture('region');
    };
    window.addEventListener('knoux:command', handleCommand);
    return () => window.removeEventListener('knoux:command', handleCommand);
  }, [runCapture]);

  const editResult = useCallback((): void => {
    if (!result) return;
    setImageEditorSource({
      dataUrl: result.dataUrl,
      name: result.sourceName || 'KNOUX Capture',
      sourcePath: result.outputPath ?? undefined,
    });
    setView('image-editor');
  }, [result, setImageEditorSource, setView]);

  const closeResultMenu = useCallback((): void => {
    setMenuOpen(false);
    window.setTimeout(() => menuInvokerRef.current?.focus(), 0);
  }, []);

  const retainedAction = useCallback(async (action: 'copy' | 'pin' | 'unpin' | 'delete'): Promise<void> => {
    if (!result) return;
    const response = await window.knouxCreativeAPI.capture.retainedAction(result.retained.id, action);
    if (action === 'delete') {
      setResult(null);
      closeResultMenu();
      return;
    }
    if (response && typeof response === 'object' && 'id' in response) {
      setResult((current) => current ? { ...current, retained: response as typeof current.retained } : current);
    }
    closeResultMenu();
  }, [closeResultMenu, result]);

  const saveRetainedAs = useCallback(async (): Promise<void> => {
    if (!result) return;
    const outputPath = await window.knouxCreativeAPI.capture.saveFrame({
      dataUrl: result.dataUrl,
      mediaName: result.sourceName,
      timestampSeconds: 0,
      format,
    });
    if (outputPath) {
      setResult({ ...result, outputPath, retained: { ...result.retained, outputPath } });
      setCaptures(await window.knouxCreativeAPI.capture.getRecent());
    }
    closeResultMenu();
  }, [closeResultMenu, format, result]);

  const retake = useCallback(async (): Promise<void> => {
    if (result) await window.knouxCreativeAPI.capture.retainedAction(result.retained.id, 'delete');
    closeResultMenu();
    await runCapture(mode);
  }, [closeResultMenu, mode, result, runCapture]);

  const requestGoogleSearch = useCallback(async (): Promise<void> => {
    if (!result) return;
    const response = await window.knouxCreativeAPI.capture.createUploadConsent(result.retained.id, 'google-lens');
    if (!response || typeof response !== 'object' || !('nonce' in response)) throw new Error('Upload consent could not be created.');
    setUploadConsent(response as CaptureUploadConsent);
    closeResultMenu();
  }, [closeResultMenu, result]);

  const resolveGoogleSearch = useCallback(async (accepted: boolean): Promise<void> => {
    if (!uploadConsent) return;
    const consentId = uploadConsent.id;
    setUploadConsent(null);
    const response = await window.knouxCreativeAPI.capture.resolveUploadConsent(consentId, accepted);
    if (accepted && response && typeof response === 'object' && 'url' in response && typeof response.url === 'string') setSearchResultUrl(response.url);
  }, [uploadConsent]);

  const menuActions = useMemo(() => result ? [
    { id: 'copy', label: 'Copy', disabled: false, run: () => retainedAction('copy') },
    { id: 'save-as', label: `Save As ${format.toUpperCase()}`, disabled: false, run: saveRetainedAs },
    { id: 'quick-export', label: 'Quick Export', disabled: !defaultDirectory, reason: 'Choose an authorized capture folder first.', run: saveRetainedAs },
    { id: 'image-editor', label: 'Open in Image Editor', disabled: false, run: async () => { closeResultMenu(); editResult(); } },
    { id: 'show-folder', label: 'Show in Folder', disabled: !result.outputPath, reason: 'Save the retained result before opening its folder.', run: async () => { if (result.outputPath) await window.knouxCreativeAPI.capture.showItem(result.outputPath); closeResultMenu(); } },
    { id: 'copy-path', label: 'Copy Path', disabled: !result.outputPath, reason: 'Save the retained result before copying its path.', run: async () => { if (result.outputPath) await navigator.clipboard.writeText(result.outputPath); closeResultMenu(); } },
    { id: 'pin', label: result.retained.pinned ? 'Unpin' : 'Pin', disabled: false, run: () => retainedAction(result.retained.pinned ? 'unpin' : 'pin') },
    { id: 'retake', label: 'Retake', disabled: false, run: retake },
    { id: 'google-lens', label: 'Google Lens / Search', disabled: false, run: requestGoogleSearch },
    { id: 'windows-share', label: 'Windows Share', disabled: true, reason: 'Windows Share capability is unavailable in this runtime.', run: async () => undefined },
    { id: 'slideshow', label: 'Send to Slideshow', disabled: false, run: async () => { closeResultMenu(); setView('slideshow'); } },
    { id: 'video-editor', label: 'Send to Video Editor', disabled: false, run: async () => { closeResultMenu(); setView('editor'); } },
    { id: 'delete', label: 'Delete Retained Result', disabled: false, run: () => retainedAction('delete') },
    { id: 'cancel', label: 'Cancel', disabled: false, run: async () => closeResultMenu() },
  ] : [], [closeResultMenu, defaultDirectory, editResult, format, requestGoogleSearch, result, retainedAction, retake, saveRetainedAs, setView]);

  const openResultMenu = useCallback((invoker: HTMLElement): void => {
    menuInvokerRef.current = invoker;
    setMenuIndex(Math.max(0, menuActions.findIndex((action) => !action.disabled)));
    setMenuOpen(true);
  }, [menuActions]);

  useEffect(() => {
    if (!result?.openActionMenu) return;
    const invoker = document.querySelector<HTMLElement>('[data-action-id="capture.result-actions"]');
    if (invoker) openResultMenu(invoker);
  }, [openResultMenu, result]);

  useEffect(() => {
    if (!menuOpen) return;
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    buttons[menuIndex]?.focus();
  }, [menuIndex, menuOpen]);

  return (
    <section className="creative-view capture-studio" aria-labelledby="capture-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('capture.eyebrow')}</span>
          <h1 id="capture-title"><Camera size={30} /> {t('capture.title')}</h1>
          <p>{t('capture.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FolderCog size={16} />} onClick={() => void chooseDirectory()}>{t('capture.folder')}</NeonButton>
          <NeonButton variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void refresh()} disabled={loading || capturing}>{t('common.refresh')}</NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Desktop, window and region capture" featureAr="التقاط الشاشة والنافذة والمنطقة" />
      <StudioPresetBar
        kind="capture"
        values={{ mode, format, delaySeconds, aspectPreset, jpegQuality, save, copyToClipboard }}
        onApply={(values) => {
          if (['source', 'region'].includes(String(values.mode))) setMode(values.mode as DesktopCaptureMode);
          if (formats.includes(values.format as CaptureFormat)) setFormat(values.format as CaptureFormat);
          if (delays.includes(values.delaySeconds as typeof delays[number])) setDelaySeconds(values.delaySeconds as typeof delays[number]);
          if (aspectPresets.includes(values.aspectPreset as RegionAspectPreset)) setAspectPreset(values.aspectPreset as RegionAspectPreset);
          if (typeof values.jpegQuality === 'number') setJpegQuality(Math.max(1, Math.min(100, values.jpegQuality)));
          if (typeof values.save === 'boolean') setSave(values.save);
          if (typeof values.copyToClipboard === 'boolean') setCopyToClipboard(values.copyToClipboard);
        }}
      />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="capture-studio-layout">
        <NeonPanel variant="dark" padding="lg" className="capture-control-panel">
          <div className="creative-section-heading compact-heading">
            <h2><ScanLine size={20} /> {t('capture.desktopStudio')}</h2>
            <span title={selectedSource?.name}>{selectedSource?.name ?? `${sources.length} ${t('capture.sources')}`}</span>
          </div>

          <div className="capture-mode-switch" role="group" aria-label={t('capture.captureMode')}>
            <button type="button" className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')} disabled={capturing} aria-pressed={mode === 'source'}><Monitor size={17} /> {t('capture.fullSource')}</button>
            <button type="button" className={mode === 'region' ? 'active' : ''} onClick={() => setMode('region')} disabled={capturing} aria-pressed={mode === 'region'}><Crop size={17} /> {t('capture.region')}</button>
          </div>

          <div className="creative-form-grid capture-options-grid">
            <label><span>{t('capture.format')}</span><select value={format} onChange={(event) => setFormat(event.target.value as CaptureFormat)} disabled={capturing}>{formats.map((entry) => <option key={entry} value={entry}>{entry.toUpperCase()}</option>)}</select></label>
            <label><span><Timer size={14} /> {t('capture.delay')}</span><select value={delaySeconds} onChange={(event) => setDelaySeconds(Number(event.target.value) as (typeof delays)[number])} disabled={capturing}>{delays.map((entry) => <option key={entry} value={entry}>{entry === 0 ? t('capture.noDelay') : `${entry} ${t('common.seconds')}`}</option>)}</select></label>
            <label><span>{t('capture.aspect')}</span><select value={aspectPreset} onChange={(event) => setAspectPreset(event.target.value as RegionAspectPreset)} disabled={capturing || mode !== 'region'}>{aspectPresets.map((entry) => <option key={entry} value={entry}>{entry === 'free' ? t('capture.freeAspect') : entry}</option>)}</select></label>
            <label><span>{t('capture.quality')} · {jpegQuality}%</span><input type="range" min="40" max="100" step="1" value={jpegQuality} onChange={(event) => setJpegQuality(Number(event.target.value))} disabled={capturing || format === 'png'} /></label>
          </div>

          <div className="capture-destination-options">
            <label className="creative-check"><input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} disabled={capturing} /><Save size={16} /> {t('capture.saveFile')}</label>
            <label className="creative-check"><input type="checkbox" checked={copyToClipboard} onChange={(event) => setCopyToClipboard(event.target.checked)} disabled={capturing} /><Clipboard size={16} /> {t('capture.copyClipboard')}</label>
          </div>

          <div className="capture-path" title={defaultDirectory ?? undefined} dir="auto">{defaultDirectory ? `${t('capture.defaultFolder')}: ${defaultDirectory}` : t('capture.chooseOnFirst')}</div>

          <NeonButton variant="primary" size="lg" leftIcon={mode === 'region' ? <Crop size={18} /> : <Camera size={18} />} onClick={() => void runCapture()} disabled={!desktopRuntime || !selectedSource || capturing || (!save && !copyToClipboard)} fullWidth>
            {capturing ? (delaySeconds > 0 ? t('capture.countdown') : t('capture.capturing')) : mode === 'region' ? t('capture.selectRegion') : t('capture.captureSource')}
          </NeonButton>
        </NeonPanel>

        <NeonPanel variant="dark" padding="lg" className="capture-source-panel">
          <div className="creative-section-heading compact-heading"><h2><Monitor size={20} /> {t('capture.availableSources')}</h2><NeonButton variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={capturing}>{t('common.refresh')}</NeonButton></div>
          {!desktopRuntime ? (
            <div className="creative-empty-hint capture-desktop-only"><Monitor size={34} /><div><strong>{t('capture.windowsOnlyTitle')}</strong><span>{t('capture.windowsOnlyDescription')}</span></div></div>
          ) : loading ? (
            <div className="creative-loading">{t('capture.loadingSources')}</div>
          ) : sources.length === 0 ? (
            <div className="creative-empty">{t('capture.noSources')}</div>
          ) : (
            <div className="desktop-source-grid">
              {sources.map((source) => (
                <button key={source.id} type="button" className={`desktop-source-card ${selectedSourceId === source.id ? 'selected' : ''}`} onClick={() => setSelectedSourceId(source.id)} disabled={capturing} aria-pressed={selectedSourceId === source.id}>
                  <img src={source.thumbnail} alt="" />
                  <span className="desktop-source-card__label">{sourceKind(source) === 'screen' ? <Monitor size={15} /> : <ImageIcon size={15} />}<strong title={source.name}>{source.name}</strong></span>
                  <small>{sourceKind(source) === 'screen' ? t('capture.screen') : t('capture.window')}</small>
                </button>
              ))}
            </div>
          )}
        </NeonPanel>
      </div>

      {result && (
        <NeonPanel variant="dark" padding="lg" className="capture-result-panel">
          <div className="creative-section-heading compact-heading">
            <h2><ImageIcon size={20} /> {t('capture.lastResult')}</h2>
            <div className="capture-result-actions"><NeonButton variant="secondary" size="sm" leftIcon={<Edit3 size={15} />} onClick={editResult}>{t('capture.editImage')}</NeonButton><button type="button" className="capture-result-close" onClick={() => setResult(null)} aria-label={t('common.cancel')}><X size={17} /></button></div>
          </div>
          <div className="capture-result-grid">
            <div
              className="capture-result-preview"
              tabIndex={0}
              role="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-action-id="capture.result-actions"
              data-command-id="capture.open-result-menu"
              onContextMenu={(event) => { event.preventDefault(); openResultMenu(event.currentTarget); }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'Enter') {
                  event.preventDefault(); openResultMenu(event.currentTarget);
                }
              }}
              onDoubleClick={(event) => openResultMenu(event.currentTarget)}
            ><img src={result.dataUrl} alt={t('capture.lastResult')} /></div>
            <dl className="capture-result-metadata">
              <div><dt>{t('capture.source')}</dt><dd>{result.sourceName}</dd></div>
              <div><dt>{t('capture.logicalRegion')}</dt><dd dir="ltr">{result.selection.x}, {result.selection.y} · {result.selection.width}×{result.selection.height}</dd></div>
              <div><dt>{t('capture.pixelRegion')}</dt><dd dir="ltr">{result.pixelSelection.x}, {result.pixelSelection.y} · {result.pixelSelection.width}×{result.pixelSelection.height}</dd></div>
              <div><dt>{t('capture.sourcePixels')}</dt><dd dir="ltr">{result.imageSize.width}×{result.imageSize.height}</dd></div>
              <div><dt>{t('capture.format')}</dt><dd>{result.format.toUpperCase()}</dd></div>
              <div><dt>{t('capture.destination')}</dt><dd dir="auto">{result.outputPath ? displayPath(result.outputPath) : t('capture.clipboardOnly')}</dd></div>
            </dl>
          </div>
          {menuOpen && <div
            ref={menuRef}
            className="capture-result-menu"
            role="menu"
            aria-label="Retained capture actions"
            data-sprint02-surface="Captures"
            onKeyDown={(event) => {
              const enabled = menuActions.map((action, index) => ({ action, index })).filter(({ action }) => !action.disabled);
              const current = enabled.findIndex(({ index }) => index === menuIndex);
              if (event.key === 'Escape') { event.preventDefault(); closeResultMenu(); return; }
              if (event.key === 'Home') { event.preventDefault(); setMenuIndex(enabled[0]?.index ?? 0); return; }
              if (event.key === 'End') { event.preventDefault(); setMenuIndex(enabled.at(-1)?.index ?? 0); return; }
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); setMenuIndex(enabled[(current + 1 + enabled.length) % enabled.length]?.index ?? 0); return; }
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); setMenuIndex(enabled[(current - 1 + enabled.length) % enabled.length]?.index ?? 0); }
            }}
          >
            {menuActions.map((action, index) => <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={index === menuIndex ? 0 : -1}
              disabled={action.disabled}
              data-action-id={`capture.result.${action.id}`}
              data-command-id={`capture.${action.id}`}
              data-disabled-reason={action.reason}
              aria-description={action.reason}
              onClick={() => void action.run().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
            >{action.label}</button>)}
          </div>}
        </NeonPanel>
      )}

      {uploadConsent && <div className="capture-consent-backdrop" role="presentation">
        <section className="capture-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-consent-title" data-sprint02-surface="Captures">
          <h2 id="capture-consent-title">Upload retained capture to Google Lens?</h2>
          <p>This one-shot consent uploads only retained result <code>{uploadConsent.retainedId}</code> to <strong>{uploadConsent.provider}</strong>. It expires at {uploadConsent.expiresAt}, is bound to SHA-256 <code>{uploadConsent.sha256}</code>, covers {uploadConsent.bytes} bytes, is consumed once, and is never saved.</p>
          <div className="creative-actions">
            <NeonButton data-action-id="capture.consent.decline" data-command-id="capture.google-consent-decline" variant="secondary" onClick={() => void resolveGoogleSearch(false)}>Decline</NeonButton>
            <NeonButton data-action-id="capture.consent.accept" data-command-id="capture.google-consent-accept" variant="primary" onClick={() => void resolveGoogleSearch(true)}>Upload once</NeonButton>
          </div>
        </section>
      </div>}
      {searchResultUrl && <div className="creative-success" role="status">Google image search created an allowlisted result URL: <code>{searchResultUrl}</code><button type="button" onClick={() => setSearchResultUrl(null)} aria-label="Dismiss Google result"><X size={14} /></button></div>}

      <div className="creative-section-heading"><h2>{t('capture.recent')}</h2><span>{captures.length} {t('common.items')}</span></div>
      {loading ? <div className="creative-loading">{t('capture.loading')}</div> : captures.length === 0 ? <div className="creative-empty">{t('capture.empty')}</div> : (
        <div className="capture-grid">
          {captures.map((filePath) => (
            <NeonPanel key={filePath} variant="dark" padding="sm"><div className="capture-card"><div className="capture-path" title={filePath} dir="auto">{displayPath(filePath)}</div><NeonButton variant="ghost" size="sm" leftIcon={<FolderOpen size={14} />} onClick={() => void window.knouxCreativeAPI.capture.showItem(filePath)}>{t('capture.showFolder')}</NeonButton></div></NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
