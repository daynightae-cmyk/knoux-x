import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
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
      const tasks: [Promise<string[]>, Promise<string | null>, Promise<DesktopCaptureSource[]>] = [
        window.knouxCreativeAPI.capture.getRecent(),
        window.knouxCreativeAPI.capture.getDefaultDirectory(),
        desktopRuntime
          ? window.knouxCreativeAPI.capture.getDesktopSources()
          : Promise.resolve([]),
      ];
      const [nextCaptures, directory, nextSources] = await Promise.all(tasks);
      setCaptures(nextCaptures);
      setDefaultDirectory(directory);
      setSources(nextSources);
      setSelectedSourceId((current) => (
        nextSources.some((source) => source.id === current) ? current : nextSources[0]?.id ?? ''
      ));
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

  const runCapture = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || !selectedSourceId || capturing || (!save && !copyToClipboard)) return;
    setCapturing(true);
    setError(null);
    setResult(null);
    try {
      const next = await window.knouxCreativeAPI.capture.captureDesktop({
        sourceId: selectedSourceId,
        mode,
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
        const nextCaptures = await window.knouxCreativeAPI.capture.getRecent();
        setCaptures(nextCaptures);
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
    selectedSourceId,
    t,
  ]);

  const editResult = useCallback((): void => {
    if (!result) return;
    setImageEditorSource({
      dataUrl: result.dataUrl,
      name: result.sourceName || 'KNOUX Capture',
      sourcePath: result.outputPath ?? undefined,
    });
    setView('image-editor');
  }, [result, setImageEditorSource, setView]);

  return (
    <section className="creative-view capture-studio" aria-labelledby="capture-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('capture.eyebrow')}</span>
          <h1 id="capture-title"><Camera size={30} /> {t('capture.title')}</h1>
          <p>{t('capture.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FolderCog size={16} />} onClick={() => void chooseDirectory()}>
            {t('capture.folder')}
          </NeonButton>
          <NeonButton variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void refresh()} disabled={loading || capturing}>
            {t('common.refresh')}
          </NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Desktop, window and region capture" featureAr="التقاط الشاشة والنافذة والمنطقة" />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="capture-studio-layout">
        <NeonPanel variant="dark" padding="lg" className="capture-control-panel">
          <div className="creative-section-heading compact-heading">
            <h2><ScanLine size={20} /> {t('capture.desktopStudio')}</h2>
            <span>{sources.length} {t('capture.sources')}</span>
          </div>

          <div className="capture-mode-switch" role="group" aria-label={t('capture.captureMode')}>
            <button
              type="button"
              className={mode === 'source' ? 'active' : ''}
              onClick={() => setMode('source')}
              disabled={capturing}
              aria-pressed={mode === 'source'}
            >
              <Monitor size={17} /> {t('capture.fullSource')}
            </button>
            <button
              type="button"
              className={mode === 'region' ? 'active' : ''}
              onClick={() => setMode('region')}
              disabled={capturing}
              aria-pressed={mode === 'region'}
            >
              <Crop size={17} /> {t('capture.region')}
            </button>
          </div>

          <div className="creative-form-grid capture-options-grid">
            <label>
              <span>{t('capture.format')}</span>
              <select value={format} onChange={(event) => setFormat(event.target.value as CaptureFormat)} disabled={capturing}>
                {formats.map((entry) => <option key={entry} value={entry}>{entry.toUpperCase()}</option>)}
              </select>
            </label>
            <label>
              <span><Timer size={14} /> {t('capture.delay')}</span>
              <select
                value={delaySeconds}
                onChange={(event) => setDelaySeconds(Number(event.target.value) as (typeof delays)[number])}
                disabled={capturing}
              >
                {delays.map((entry) => (
                  <option key={entry} value={entry}>{entry === 0 ? t('capture.noDelay') : `${entry} ${t('common.seconds')}`}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('capture.aspect')}</span>
              <select
                value={aspectPreset}
                onChange={(event) => setAspectPreset(event.target.value as RegionAspectPreset)}
                disabled={capturing || mode !== 'region'}
              >
                {aspectPresets.map((entry) => <option key={entry} value={entry}>{entry === 'free' ? t('capture.freeAspect') : entry}</option>)}
              </select>
            </label>
            <label>
              <span>{t('capture.quality')} · {jpegQuality}%</span>
              <input
                type="range"
                min="40"
                max="100"
                step="1"
                value={jpegQuality}
                onChange={(event) => setJpegQuality(Number(event.target.value))}
                disabled={capturing || format === 'png'}
              />
            </label>
          </div>

          <div className="capture-destination-options">
            <label className="creative-check">
              <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} disabled={capturing} />
              <Save size={16} /> {t('capture.saveFile')}
            </label>
            <label className="creative-check">
              <input
                type="checkbox"
                checked={copyToClipboard}
                onChange={(event) => setCopyToClipboard(event.target.checked)}
                disabled={capturing}
              />
              <Clipboard size={16} /> {t('capture.copyClipboard')}
            </label>
          </div>

          <div className="capture-path" title={defaultDirectory ?? undefined} dir="auto">
            {defaultDirectory
              ? `${t('capture.defaultFolder')}: ${defaultDirectory}`
              : t('capture.chooseOnFirst')}
          </div>

          <NeonButton
            variant="primary"
            size="lg"
            leftIcon={mode === 'region' ? <Crop size={18} /> : <Camera size={18} />}
            onClick={() => void runCapture()}
            disabled={!desktopRuntime || !selectedSourceId || capturing || (!save && !copyToClipboard)}
            fullWidth
          >
            {capturing
              ? (delaySeconds > 0 ? t('capture.countdown') : t('capture.capturing'))
              : mode === 'region' ? t('capture.selectRegion') : t('capture.captureSource')}
          </NeonButton>
        </NeonPanel>

        <NeonPanel variant="dark" padding="lg" className="capture-source-panel">
          <div className="creative-section-heading compact-heading">
            <h2><Monitor size={20} /> {t('capture.availableSources')}</h2>
            <NeonButton variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={capturing}>
              {t('common.refresh')}
            </NeonButton>
          </div>

          {!desktopRuntime ? (
            <div className="creative-empty-hint capture-desktop-only">
              <Monitor size={34} />
              <div>
                <strong>{t('capture.windowsOnlyTitle')}</strong>
                <span>{t('capture.windowsOnlyDescription')}</span>
              </div>
            </div>
          ) : loading ? (
            <div className="creative-loading">{t('capture.loadingSources')}</div>
          ) : sources.length === 0 ? (
            <div className="creative-empty">{t('capture.noSources')}</div>
          ) : (
            <div className="desktop-source-grid">
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={`desktop-source-card ${selectedSourceId === source.id ? 'selected' : ''}`}
                  onClick={() => setSelectedSourceId(source.id)}
                  disabled={capturing}
                  aria-pressed={selectedSourceId === source.id}
                >
                  <img src={source.thumbnail} alt="" />
                  <span className="desktop-source-card__label">
                    {sourceKind(source) === 'screen' ? <Monitor size={15} /> : <ImageIcon size={15} />}
                    <strong title={source.name}>{source.name}</strong>
                  </span>
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
            <div className="capture-result-actions">
              <NeonButton variant="secondary" size="sm" leftIcon={<Edit3 size={15} />} onClick={editResult}>
                {t('capture.editImage')}
              </NeonButton>
              <button type="button" className="capture-result-close" onClick={() => setResult(null)} aria-label={t('common.cancel')}>
                <X size={17} />
              </button>
            </div>
          </div>
          <div className="capture-result-grid">
            <div className="capture-result-preview"><img src={result.dataUrl} alt={t('capture.lastResult')} /></div>
            <dl className="capture-result-metadata">
              <div><dt>{t('capture.source')}</dt><dd>{result.sourceName}</dd></div>
              <div><dt>{t('capture.logicalRegion')}</dt><dd dir="ltr">{result.selection.x}, {result.selection.y} · {result.selection.width}×{result.selection.height}</dd></div>
              <div><dt>{t('capture.pixelRegion')}</dt><dd dir="ltr">{result.pixelSelection.x}, {result.pixelSelection.y} · {result.pixelSelection.width}×{result.pixelSelection.height}</dd></div>
              <div><dt>{t('capture.sourcePixels')}</dt><dd dir="ltr">{result.imageSize.width}×{result.imageSize.height}</dd></div>
              <div><dt>{t('capture.format')}</dt><dd>{result.format.toUpperCase()}</dd></div>
              <div><dt>{t('capture.destination')}</dt><dd dir="auto">{result.outputPath ? displayPath(result.outputPath) : t('capture.clipboardOnly')}</dd></div>
            </dl>
          </div>
        </NeonPanel>
      )}

      <div className="creative-section-heading">
        <h2>{t('capture.recent')}</h2>
        <span>{captures.length} {t('common.items')}</span>
      </div>

      {loading ? (
        <div className="creative-loading">{t('capture.loading')}</div>
      ) : captures.length === 0 ? (
        <div className="creative-empty">{t('capture.empty')}</div>
      ) : (
        <div className="capture-grid">
          {captures.map((filePath) => (
            <NeonPanel key={filePath} variant="dark" padding="sm">
              <div className="capture-card">
                <div className="capture-path" title={filePath} dir="auto">{displayPath(filePath)}</div>
                <NeonButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<FolderOpen size={14} />}
                  onClick={() => void window.knouxCreativeAPI.capture.showItem(filePath)}
                >
                  {t('capture.showFolder')}
                </NeonButton>
              </div>
            </NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
