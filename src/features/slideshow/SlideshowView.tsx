import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  CheckCircle2,
  FileImage,
  FilePlus2,
  Film,
  FolderOpen,
  ImagePlus,
  Music,
  Pause,
  Play,
  Save,
  Square,
  Trash2,
  Type,
  Video,
  WandSparkles,
} from 'lucide-react';

import type { SlideshowRecovery } from '../../../electron/creative/slideshow-project-service';
import type { SlideshowRenderSnapshot } from '../../../electron/creative/slideshow-render-service';
import type { SlideshowRenderFormat } from '../../core/creative/slideshowRender';
import {
  addAudioTrack,
  applyDurationToImages,
  createSlideshowSlide,
  reorderSlide,
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
} from '../../core/creative/slideshowProject';
import type {
  KenBurnsMode,
  SlideshowAspect,
  SlideshowAudioTrack,
  SlideshowFit,
  SlideshowProject,
  SlideshowResolution,
  SlideshowSlide,
  SlideshowTemplate,
  SlideshowTransition,
} from '../../core/creative/slideshowProject';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { useTranslation } from '../../i18n';

const templates: SlideshowTemplate[] = [
  'minimal',
  'cinematic',
  'family',
  'travel',
  'product',
  'portfolio',
  'social-vertical',
  'memorial-neutral',
];
const aspects: SlideshowAspect[] = ['16:9', '9:16', '1:1', '4:3', 'custom'];
const resolutions: SlideshowResolution[] = ['720p', '1080p', '1440p', '4k'];
const transitions: SlideshowTransition[] = ['none', 'crossfade', 'fade-black', 'wipe', 'slide', 'zoom', 'blur'];
const motions: KenBurnsMode[] = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
const fits: SlideshowFit[] = ['fit', 'fill', 'blur-background'];
const renderFormats: SlideshowRenderFormat[] = ['mp4', 'webm', 'gif'];
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
const audioExtensions = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']);

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function mediaDuration(mediaUrl: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind);
    media.preload = 'metadata';
    media.src = mediaUrl;
    const cleanup = (): void => {
      media.removeAttribute('src');
      media.load();
    };
    media.addEventListener('loadedmetadata', () => {
      const duration = media.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('Media duration is unavailable.'));
    }, { once: true });
    media.addEventListener('error', () => {
      cleanup();
      reject(new Error('Media metadata could not be decoded.'));
    }, { once: true });
  });
}

function extension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

export const SlideshowView: React.FC = () => {
  const [project, setProject] = useState<SlideshowProject | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [recoveries, setRecoveries] = useState<SlideshowRecovery[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderFormat, setRenderFormat] = useState<SlideshowRenderFormat>('mp4');
  const [renderSnapshot, setRenderSnapshot] = useState<SlideshowRenderSnapshot | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const { locale, t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview'
    && typeof window.knouxSlideshowAPI?.create === 'function';
  const duration = useMemo(() => project ? slideshowDuration(project) : 0, [project]);
  const ranges = useMemo(() => project ? slideTimelineRanges(project.slides) : [], [project]);
  const outputSize = useMemo(() => project ? slideshowOutputSize(project) : { width: 0, height: 0 }, [project]);
  const selectedSlide = useMemo(() => project?.slides.find((slide) => slide.id === selectedSlideId) ?? null, [project, selectedSlideId]);
  const activePreviewIndex = useMemo(() => {
    if (!project || project.slides.length === 0) return -1;
    const index = ranges.findIndex((range) => previewTime >= range.start && previewTime < range.end);
    return index >= 0 ? index : project.slides.length - 1;
  }, [previewTime, project, ranges]);
  const activePreviewSlide = activePreviewIndex >= 0 ? project?.slides[activePreviewIndex] ?? null : null;

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) return;
    try {
      const [nextRecent, nextRecoveries] = await Promise.all([
        window.knouxSlideshowAPI.recent(),
        window.knouxSlideshowAPI.recoveries(),
      ]);
      setRecent(nextRecent);
      setRecoveries(nextRecoveries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.workspaceFailed'));
    }
  }, [desktopRuntime, t]);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);

  useEffect(() => window.knouxSlideshowAPI?.onRenderProgress((snapshot) => {
    setRenderSnapshot(snapshot);
  }), []);

  useEffect(() => {
    if (!project || !dirty || !desktopRuntime) return undefined;
    const timer = window.setTimeout(() => {
      void window.knouxSlideshowAPI.autosave(project).catch(() => undefined);
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [desktopRuntime, dirty, project]);

  useEffect(() => {
    if (!previewPlaying || duration <= 0) return undefined;
    const startedAt = performance.now() - previewTime * 1000;
    previewTimerRef.current = window.setInterval(() => {
      const next = (performance.now() - startedAt) / 1000;
      if (next >= duration) {
        setPreviewTime(duration);
        setPreviewPlaying(false);
        if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
        previewTimerRef.current = null;
      } else setPreviewTime(next);
    }, 50);
    return () => {
      if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    };
  }, [duration, previewPlaying, previewTime]);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    const source = activePreviewSlide?.sourcePath;
    if (!source) return () => { active = false; };
    void window.knouxCreativeAPI.media.toUrl(source)
      .then((url) => { if (active) setPreviewUrl(url); })
      .catch(() => { if (active) setPreviewUrl(null); });
    return () => { active = false; };
  }, [activePreviewSlide?.sourcePath]);

  const activate = useCallback((next: SlideshowProject, filePath?: string, unsaved = false): void => {
    setProject(structuredClone(next));
    setProjectPath(filePath);
    setSelectedSlideId(next.slides[0]?.id ?? null);
    setPreviewTime(0);
    setPreviewPlaying(false);
    setDirty(unsaved);
    setError(null);
    setRenderSnapshot(null);
  }, []);

  const commit = useCallback((next: SlideshowProject): void => {
    setProject({ ...structuredClone(next), updatedAt: new Date().toISOString() });
    setDirty(true);
  }, []);

  const createProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    const name = window.prompt(t('slideshow.projectName'), t('slideshow.defaultProject'))?.trim();
    if (!name) return;
    const template = (window.prompt(t('slideshow.templatePrompt'), 'minimal') ?? 'minimal') as SlideshowTemplate;
    const validTemplate = templates.includes(template) ? template : 'minimal';
    setBusy(true);
    try {
      activate(await window.knouxSlideshowAPI.create(name, validTemplate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.createFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, t]);

  const openProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setBusy(true);
    try {
      const opened = await window.knouxSlideshowAPI.open();
      if (opened) activate(opened.project, opened.filePath);
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, refreshWorkspace, t]);

  const openRecent = useCallback(async (filePath: string): Promise<void> => {
    setBusy(true);
    try {
      const opened = await window.knouxSlideshowAPI.openRecent(filePath);
      activate(opened.project, opened.filePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, t]);

  const saveProject = useCallback(async (saveAs = false): Promise<void> => {
    if (!project || busy || !desktopRuntime) return;
    setBusy(true);
    try {
      const saved = await window.knouxSlideshowAPI.save(project, projectPath, saveAs);
      if (saved) {
        setProjectPath(saved);
        setDirty(false);
        await refreshWorkspace();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, project, projectPath, refreshWorkspace, t]);

  const addMediaSlide = useCallback(async (): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      const ext = extension(selected.filePath);
      if (audioExtensions.has(ext)) throw new Error(t('slideshow.selectVisualMedia'));
      const kind: SlideshowSlide['kind'] = imageExtensions.has(ext) ? 'image' : 'video';
      const itemDuration = kind === 'image'
        ? project.defaultImageDuration
        : await mediaDuration(selected.mediaUrl, 'video');
      const slide = createSlideshowSlide({
        id: crypto.randomUUID(),
        sourcePath: selected.filePath,
        kind,
        title: basename(selected.filePath),
        duration: itemDuration,
        transition: project.defaultTransition,
        transitionDuration: project.defaultTransitionDuration,
      });
      commit({ ...project, slides: [...project.slides, slide] });
      setSelectedSlideId(slide.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, commit, project, t]);

  const addTextCard = useCallback((kind: 'title' | 'end-card'): void => {
    if (!project) return;
    const title = window.prompt(kind === 'title' ? t('slideshow.titleText') : t('slideshow.endText'), kind === 'title' ? project.name : t('slideshow.defaultEnd'))?.trim();
    if (!title) return;
    const caption = window.prompt(t('slideshow.caption'), '') ?? '';
    const slide = createSlideshowSlide({
      id: crypto.randomUUID(),
      sourcePath: '',
      kind,
      title,
      caption,
      duration: project.defaultImageDuration,
      transition: project.defaultTransition,
      transitionDuration: project.defaultTransitionDuration,
    });
    slide.backgroundColor = project.backgroundColor;
    slide.kenBurns = 'none';
    commit({ ...project, slides: [...project.slides, slide] });
    setSelectedSlideId(slide.id);
  }, [commit, project, t]);

  const addAudio = useCallback(async (kind: SlideshowAudioTrack['kind']): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      if (!audioExtensions.has(extension(selected.filePath))) throw new Error(t('slideshow.selectAudioFile'));
      const sourceDuration = await mediaDuration(selected.mediaUrl, 'audio');
      const track: SlideshowAudioTrack = {
        id: crypto.randomUUID(),
        sourcePath: selected.filePath,
        name: basename(selected.filePath),
        start: 0,
        sourceIn: 0,
        sourceOut: sourceDuration,
        volume: kind === 'music' ? 0.65 : 1,
        fadeIn: kind === 'music' ? 1 : 0,
        fadeOut: kind === 'music' ? 1 : 0,
        loop: kind === 'music',
        kind,
      };
      commit(addAudioTrack(project, track));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.addAudioFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, commit, project, t]);

  const addWatermark = useCallback(async (): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      if (!imageExtensions.has(extension(selected.filePath))) throw new Error(t('slideshow.selectImageFile'));
      commit({
        ...project,
        watermark: {
          sourcePath: selected.filePath,
          opacity: 0.7,
          scale: 0.16,
          position: 'bottom-right',
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.watermarkFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, commit, project, t]);

  const patchSelectedSlide = useCallback((patcher: (slide: SlideshowSlide) => SlideshowSlide): void => {
    if (!project || !selectedSlide) return;
    commit({
      ...project,
      slides: project.slides.map((slide) => slide.id === selectedSlide.id ? patcher(structuredClone(slide)) : slide),
    });
  }, [commit, project, selectedSlide]);

  const moveSelectedSlide = useCallback((direction: -1 | 1): void => {
    if (!project || !selectedSlide) return;
    const index = project.slides.findIndex((slide) => slide.id === selectedSlide.id);
    commit({ ...project, slides: reorderSlide(project.slides, selectedSlide.id, index + direction) });
  }, [commit, project, selectedSlide]);

  const deleteSelectedSlide = useCallback((): void => {
    if (!project || !selectedSlide) return;
    const index = project.slides.findIndex((slide) => slide.id === selectedSlide.id);
    const slides = project.slides.filter((slide) => slide.id !== selectedSlide.id);
    commit({ ...project, slides });
    setSelectedSlideId(slides[Math.min(index, slides.length - 1)]?.id ?? null);
  }, [commit, project, selectedSlide]);

  const patchAudioTrack = useCallback((trackId: string, patch: Partial<SlideshowAudioTrack>): void => {
    if (!project) return;
    commit({
      ...project,
      audioTracks: project.audioTracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
    });
  }, [commit, project]);

  const render = useCallback(async (): Promise<void> => {
    if (!project || project.slides.length === 0 || busy || !desktopRuntime) return;
    setBusy(true);
    setError(null);
    setRenderSnapshot(null);
    try {
      const result = await window.knouxSlideshowAPI.render(project, renderFormat);
      if (result) setRenderSnapshot(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.renderFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, project, renderFormat, t]);

  if (!project) {
    return (
      <section className="creative-view slideshow-view" aria-labelledby="slideshow-title">
        <header className="creative-header"><div><span className="creative-eyebrow">{t('slideshow.eyebrow')}</span><h1 id="slideshow-title"><Film size={30} /> {t('slideshow.title')}</h1><p>{t('slideshow.description')}</p></div></header>
        <RuntimeModeNotice feature="Offline slideshow projects and FFmpeg rendering" featureAr="مشاريع عروض شرائح ورندر FFmpeg محلي" />
        {error && <div className="creative-error" role="alert">{error}</div>}
        <div className="slideshow-start-grid">
          <NeonPanel variant="dark" padding="lg" className="slideshow-start-card"><WandSparkles size={46} /><h2>{t('slideshow.newProject')}</h2><p>{t('slideshow.newDescription')}</p><NeonButton variant="primary" leftIcon={<FilePlus2 size={16} />} onClick={() => void createProject()} disabled={!desktopRuntime || busy}>{t('slideshow.create')}</NeonButton><NeonButton variant="secondary" leftIcon={<FolderOpen size={16} />} onClick={() => void openProject()} disabled={!desktopRuntime || busy}>{t('slideshow.open')}</NeonButton></NeonPanel>
          <NeonPanel variant="dark" padding="lg"><h2>{t('slideshow.recoveries')}</h2>{recoveries.length === 0 ? <div className="creative-empty">{t('slideshow.noRecoveries')}</div> : recoveries.map((entry) => <button key={entry.filePath} type="button" className="slideshow-project-link" onClick={() => activate(entry.project, undefined, true)}><strong>{entry.project.name}</strong><span>{new Date(entry.modifiedAt).toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-US')}</span></button>)}</NeonPanel>
          <NeonPanel variant="dark" padding="lg"><h2>{t('slideshow.recent')}</h2>{recent.length === 0 ? <div className="creative-empty">{t('slideshow.noRecent')}</div> : recent.map((filePath) => <button key={filePath} type="button" className="slideshow-project-link" onClick={() => void openRecent(filePath)}><strong>{basename(filePath)}</strong><span dir="auto">{filePath}</span></button>)}</NeonPanel>
        </div>
      </section>
    );
  }

  return (
    <section className="creative-view slideshow-view" aria-labelledby="slideshow-title">
      <header className="creative-header slideshow-header">
        <div><span className="creative-eyebrow">{t('slideshow.eyebrow')}</span><h1 id="slideshow-title"><Film size={30} /> {project.name}</h1><p>{outputSize.width}×{outputSize.height} · {project.fps} FPS · {project.slides.length} {t('slideshow.slides')} · {formatTime(duration)}</p></div>
        <div className="creative-actions"><NeonButton variant="ghost" leftIcon={<FilePlus2 size={15} />} onClick={() => void createProject()} disabled={busy}>{t('common.new')}</NeonButton><NeonButton variant="ghost" leftIcon={<FolderOpen size={15} />} onClick={() => void openProject()} disabled={busy}>{t('common.open')}</NeonButton><NeonButton variant="secondary" leftIcon={<Save size={15} />} onClick={() => void saveProject(false)} disabled={busy}>{dirty ? t('slideshow.saveChanges') : t('common.save')}</NeonButton><NeonButton variant="ghost" onClick={() => void saveProject(true)} disabled={busy}>{t('common.saveAs')}</NeonButton></div>
      </header>
      <RuntimeModeNotice feature="Offline slideshow projects and FFmpeg rendering" featureAr="مشاريع عروض شرائح ورندر FFmpeg محلي" />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="slideshow-toolbar">
        <NeonButton variant="ghost" size="sm" leftIcon={<ImagePlus size={14} />} onClick={() => void addMediaSlide()}>{t('slideshow.addMedia')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<Type size={14} />} onClick={() => addTextCard('title')}>{t('slideshow.addTitle')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<CheckCircle2 size={14} />} onClick={() => addTextCard('end-card')}>{t('slideshow.addEnd')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<Music size={14} />} onClick={() => void addAudio('music')}>{t('slideshow.addMusic')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<AudioLines size={14} />} onClick={() => void addAudio('voice-over')}>{t('slideshow.addVoice')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<FileImage size={14} />} onClick={() => void addWatermark()}>{t('slideshow.watermark')}</NeonButton>
        <button type="button" onClick={() => moveSelectedSlide(-1)} disabled={!selectedSlide || project.slides[0]?.id === selectedSlide.id} title={t('slideshow.moveEarlier')}><ArrowUp size={16} /></button>
        <button type="button" onClick={() => moveSelectedSlide(1)} disabled={!selectedSlide || project.slides[project.slides.length - 1]?.id === selectedSlide.id} title={t('slideshow.moveLater')}><ArrowDown size={16} /></button>
        <button type="button" onClick={deleteSelectedSlide} disabled={!selectedSlide} title={t('common.cancel')}><Trash2 size={16} /></button>
      </div>

      <div className="slideshow-main-grid">
        <NeonPanel variant="dark" padding="none" className="slideshow-preview-panel">
          <div className="slideshow-preview-stage" style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}`, background: activePreviewSlide?.backgroundColor ?? project.backgroundColor }}>
            {activePreviewSlide?.kind === 'title' || activePreviewSlide?.kind === 'end-card' ? (
              <div className="slideshow-text-card" dir="auto"><strong>{activePreviewSlide.title}</strong><span>{activePreviewSlide.caption}</span></div>
            ) : activePreviewSlide?.kind === 'image' && previewUrl ? (
              <img src={previewUrl} alt={activePreviewSlide.title} data-fit={activePreviewSlide.fit} data-motion={activePreviewSlide.kenBurns} />
            ) : activePreviewSlide?.kind === 'video' && previewUrl ? (
              <video src={previewUrl} muted={activePreviewSlide.muted} autoPlay={previewPlaying} />
            ) : <div className="creative-empty">{t('slideshow.emptyPreview')}</div>}
            {project.watermark && <div className={`slideshow-watermark ${project.watermark.position}`} style={{ opacity: project.watermark.opacity }}>{basename(project.watermark.sourcePath)}</div>}
            <button type="button" className="slideshow-preview-toggle" onClick={() => {
              if (previewTime >= duration) setPreviewTime(0);
              setPreviewPlaying((value) => !value);
            }}>{previewPlaying ? <Pause size={22} /> : <Play size={22} />}</button>
          </div>
          <div className="slideshow-preview-controls"><input type="range" min="0" max={Math.max(0.001, duration)} step="0.05" value={Math.min(previewTime, duration)} onChange={(event) => { setPreviewPlaying(false); setPreviewTime(Number(event.target.value)); }} /><strong dir="ltr">{formatTime(previewTime)} / {formatTime(duration)}</strong></div>
        </NeonPanel>

        <NeonPanel variant="dark" padding="md" className="slideshow-inspector">
          <h2>{selectedSlide ? t('slideshow.slideInspector') : t('slideshow.projectSettings')}</h2>
          {selectedSlide ? (
            <div className="slideshow-form-stack">
              <label><span>{t('slideshow.slideTitle')}</span><input value={selectedSlide.title} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, title: event.target.value.slice(0, 300) }))} /></label>
              <label><span>{t('slideshow.caption')}</span><textarea value={selectedSlide.caption} dir="auto" onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, caption: event.target.value.slice(0, 1000) }))} /></label>
              <label><span>{t('slideshow.duration')}</span><input type="number" min="0.1" step="0.1" value={selectedSlide.duration} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, duration: Math.max(0.1, Number(event.target.value)), transitionDuration: Math.min(slide.transitionDuration, Math.max(0.1, Number(event.target.value)) / 2) }))} /></label>
              <div className="slideshow-two-columns"><label><span>{t('slideshow.fit')}</span><select value={selectedSlide.fit} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, fit: event.target.value as SlideshowFit }))}>{fits.map((fit) => <option key={fit} value={fit}>{t(`slideshow.fit_${fit}`)}</option>)}</select></label><label><span>{t('slideshow.motion')}</span><select value={selectedSlide.kenBurns} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, kenBurns: event.target.value as KenBurnsMode }))}>{motions.map((motion) => <option key={motion} value={motion}>{motion}</option>)}</select></label></div>
              <div className="slideshow-two-columns"><label><span>{t('slideshow.transition')}</span><select value={selectedSlide.transition} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, transition: event.target.value as SlideshowTransition }))}>{transitions.map((transition) => <option key={transition} value={transition}>{transition}</option>)}</select></label><label><span>{t('slideshow.transitionDuration')}</span><input type="number" min="0" max={selectedSlide.duration / 2} step="0.1" value={selectedSlide.transitionDuration} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, transitionDuration: Math.max(0, Math.min(slide.duration / 2, Number(event.target.value))) }))} /></label></div>
              {selectedSlide.kind === 'video' && <><label><span>{t('slideshow.volume')} · {Math.round(selectedSlide.volume * 100)}%</span><input type="range" min="0" max="2" step="0.01" value={selectedSlide.volume} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, volume: Number(event.target.value) }))} /></label><label className="creative-check"><input type="checkbox" checked={selectedSlide.muted} onChange={(event) => patchSelectedSlide((slide) => ({ ...slide, muted: event.target.checked }))} />{t('slideshow.muteVideo')}</label></>}
            </div>
          ) : <div className="creative-empty">{t('slideshow.selectSlide')}</div>}
        </NeonPanel>
      </div>

      <NeonPanel variant="dark" padding="md" className="slideshow-settings-panel">
        <div className="slideshow-settings-grid">
          <label><span>{t('slideshow.template')}</span><select value={project.template} onChange={(event) => commit({ ...project, template: event.target.value as SlideshowTemplate })}>{templates.map((template) => <option key={template} value={template}>{template}</option>)}</select></label>
          <label><span>{t('slideshow.aspect')}</span><select value={project.aspect} onChange={(event) => commit({ ...project, aspect: event.target.value as SlideshowAspect })}>{aspects.map((aspect) => <option key={aspect} value={aspect}>{aspect}</option>)}</select></label>
          <label><span>{t('slideshow.resolution')}</span><select value={project.resolution} onChange={(event) => commit({ ...project, resolution: event.target.value as SlideshowResolution })}>{resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution.toUpperCase()}</option>)}</select></label>
          <label><span>{t('slideshow.fps')}</span><select value={project.fps} onChange={(event) => commit({ ...project, fps: Number(event.target.value) as SlideshowProject['fps'] })}>{[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps}</option>)}</select></label>
          <label><span>{t('slideshow.defaultDuration')}</span><input type="number" min="0.5" step="0.5" value={project.defaultImageDuration} onChange={(event) => commit({ ...project, defaultImageDuration: Math.max(0.5, Number(event.target.value)) })} /></label>
          <NeonButton variant="ghost" size="sm" onClick={() => commit({ ...project, slides: applyDurationToImages(project.slides, project.defaultImageDuration) })}>{t('slideshow.applyImages')}</NeonButton>
        </div>
      </NeonPanel>

      <div className="creative-section-heading"><h2>{t('slideshow.timeline')}</h2><span>{project.slides.length} {t('slideshow.slides')}</span></div>
      <div className="slideshow-strip">
        {project.slides.map((slide, index) => <button key={slide.id} type="button" className={selectedSlideId === slide.id ? 'selected' : ''} onClick={() => { setSelectedSlideId(slide.id); setPreviewPlaying(false); setPreviewTime(ranges[index]?.start ?? 0); }}><span>{index + 1}</span>{slide.kind === 'video' ? <Video size={22} /> : slide.kind === 'image' ? <FileImage size={22} /> : <Type size={22} />}<strong>{slide.title || basename(slide.sourcePath)}</strong><small>{formatTime(slide.duration)} · {slide.transition}</small></button>)}
      </div>

      <div className="creative-section-heading"><h2>{t('slideshow.audio')}</h2><span>{project.audioTracks.length} {t('common.items')}</span></div>
      <div className="slideshow-audio-list">{project.audioTracks.length === 0 ? <div className="creative-empty">{t('slideshow.noAudio')}</div> : project.audioTracks.map((track) => <NeonPanel key={track.id} variant="dark" padding="sm" className="slideshow-audio-card"><div><strong>{track.name}</strong><span>{track.kind}</span></div><label>{t('slideshow.volume')}<input type="range" min="0" max="2" step="0.01" value={track.volume} onChange={(event) => patchAudioTrack(track.id, { volume: Number(event.target.value) })} /></label><label>{t('slideshow.fadeIn')}<input type="number" min="0" step="0.1" value={track.fadeIn} onChange={(event) => patchAudioTrack(track.id, { fadeIn: Math.max(0, Number(event.target.value)) })} /></label><label>{t('slideshow.fadeOut')}<input type="number" min="0" step="0.1" value={track.fadeOut} onChange={(event) => patchAudioTrack(track.id, { fadeOut: Math.max(0, Number(event.target.value)) })} /></label><label className="creative-check"><input type="checkbox" checked={track.loop} onChange={(event) => patchAudioTrack(track.id, { loop: event.target.checked })} />{t('slideshow.loop')}</label><button type="button" onClick={() => commit({ ...project, audioTracks: project.audioTracks.filter((entry) => entry.id !== track.id) })}><Trash2 size={15} /></button></NeonPanel>)}</div>

      <NeonPanel variant="dark" padding="md" className="slideshow-render-panel">
        <div><h2>{t('slideshow.render')}</h2><p>{t('slideshow.renderDescription')}</p></div>
        <select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value as SlideshowRenderFormat)}>{renderFormats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>
        {renderSnapshot && <div className="slideshow-render-progress"><div><strong>{t(`slideshow.render_${renderSnapshot.status}`)}</strong><span>{renderSnapshot.percentage.toFixed(1)}%</span></div><progress max="100" value={renderSnapshot.percentage} />{renderSnapshot.outputPath && <small dir="auto">{basename(renderSnapshot.outputPath)}</small>}</div>}
        {renderSnapshot && ['queued', 'preparing', 'rendering', 'validating'].includes(renderSnapshot.status) ? <NeonButton variant="danger" leftIcon={<Square size={15} />} onClick={() => void window.knouxSlideshowAPI.cancelRender(renderSnapshot.id)}>{t('common.cancel')}</NeonButton> : <NeonButton variant="primary" leftIcon={<Film size={16} />} onClick={() => void render()} disabled={busy || project.slides.length === 0}>{t('slideshow.startRender')}</NeonButton>}
      </NeonPanel>
    </section>
  );
};
