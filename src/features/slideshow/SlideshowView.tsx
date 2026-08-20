import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileImage,
  FilePlus2,
  Film,
  FolderOpen,
  FolderSearch,
  ImagePlus,
  LocateFixed,
  Music,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Video,
  WandSparkles,
} from 'lucide-react';

import type {
  SlideshowAssetStatus,
  SlideshowImportResult,
} from '../../../electron/creative/slideshow-asset-service';
import type {
  SlideshowOpenResult,
  SlideshowRecovery,
} from '../../../electron/creative/slideshow-project-service';
import type { SlideshowRenderSnapshot } from '../../../electron/creative/slideshow-render-service';
import type { SlideshowRenderFormat } from '../../core/creative/slideshowRender';
import { slideshowOutputActionState } from '../../core/creative/slideshowOutputState';
import {
  addAudioTrack,
  applyDurationToImages,
  audioGainAt,
  constrainSlideTransitions,
  createSlideshowSlide,
  duplicateSlide,
  effectiveAudioDuration,
  kenBurnsTransform,
  previewDuckGainAt,
  reorderSlide,
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
  SLIDESHOW_LIMITS,
  transitionDurationMaximum,
} from '../../core/creative/slideshowProject';
import type {
  CaptionDirection,
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
import { NeonSelect } from '../../components/neon/NeonSelect';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
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
const transitions: SlideshowTransition[] = [
  'none',
  'crossfade',
  'fade-black',
  'wipe',
  'slide',
  'zoom',
  'blur',
];
const motions: KenBurnsMode[] = [
  'none',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
];
const fits: SlideshowFit[] = ['fit', 'fill', 'blur-background'];
const directions: CaptionDirection[] = ['auto', 'ltr', 'rtl'];
const renderFormats: SlideshowRenderFormat[] = ['mp4', 'webm', 'gif'];
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
const audioExtensions = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']);

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}
function extension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}
function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${(safe % 60).toFixed(1).padStart(4, '0')}`;
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
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
    media.addEventListener(
      'loadedmetadata',
      () => {
        const duration = media.duration;
        cleanup();
        if (Number.isFinite(duration) && duration >= SLIDESHOW_LIMITS.audioTrimMin)
          resolve(duration);
        else reject(new Error('Media duration is unavailable.'));
      },
      { once: true }
    );
    media.addEventListener(
      'error',
      () => {
        cleanup();
        reject(new Error('Media metadata could not be decoded.'));
      },
      { once: true }
    );
  });
}

export const SlideshowView: React.FC = () => {
  const [project, setProject] = useState<SlideshowProject | null>(null);
  const projectRef = useRef<SlideshowProject | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [recoveries, setRecoveries] = useState<SlideshowRecovery[]>([]);
  const [assetStatuses, setAssetStatuses] = useState<SlideshowAssetStatus[]>([]);
  const [corruptOpen, setCorruptOpen] = useState<Extract<
    SlideshowOpenResult,
    { status: 'corrupt' }
  > | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renderFormat, setRenderFormat] = useState<SlideshowRenderFormat>('mp4');
  const [renderJobs, setRenderJobs] = useState<SlideshowRenderSnapshot[]>([]);
  const [undoHistory, setUndoHistory] = useState<SlideshowProject[]>([]);
  const [redoHistory, setRedoHistory] = useState<SlideshowProject[]>([]);
  const [newProjectName, setNewProjectName] = useState('My KNOUX Slideshow');
  const [newTemplate, setNewTemplate] = useState<SlideshowTemplate>('minimal');
  const [draggedSlideId, setDraggedSlideId] = useState<string | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewTimeRef = useRef(0);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const previewAudioContext = useRef<AudioContext | null>(null);
  const previewGainNodes = useRef(new Map<HTMLMediaElement, GainNode>());
  const { locale, t } = useTranslation();
  const l = useCallback((en: string, ar: string): string => (locale === 'ar' ? ar : en), [locale]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    previewTimeRef.current = previewTime;
  }, [previewTime]);
  const desktopRuntime =
    document.documentElement.dataset.runtime !== 'web-preview' &&
    typeof window.knouxSlideshowAPI?.create === 'function';
  const duration = useMemo(() => (project ? slideshowDuration(project) : 0), [project]);
  const ranges = useMemo(() => (project ? slideTimelineRanges(project.slides) : []), [project]);
  const outputSize = useMemo(
    () => (project ? slideshowOutputSize(project) : { width: 0, height: 0 }),
    [project]
  );
  const selectedSlide = useMemo(
    () => project?.slides.find((slide) => slide.id === selectedSlideId) ?? null,
    [project, selectedSlideId]
  );
  const selectedSlideIndex = project?.slides.findIndex((slide) => slide.id === selectedSlideId) ?? -1;
  const selectedTransitionMaximum = project && selectedSlideIndex >= 0
    ? transitionDurationMaximum(project.slides, selectedSlideIndex)
    : 0;
  const missingAssets = useMemo(
    () => assetStatuses.filter((entry) => entry.status !== 'present'),
    [assetStatuses]
  );
  const assetPathKey = useMemo(
    () =>
      project
        ? [
            ...project.slides.map((slide) => slide.sourcePath),
            ...project.audioTracks.map((track) => track.sourcePath),
            project.watermark?.sourcePath ?? '',
          ].join('|')
        : '',
    [project]
  );

  const visibleSlides = useMemo(() => {
    if (!project) return [];
    return ranges
      .map((range, index) => ({ slide: project.slides[index], range, index }))
      .filter(({ range }) => previewTime >= range.start && previewTime < range.end)
      .slice(-2);
  }, [previewTime, project, ranges]);

  const refreshRenderJobs = useCallback(async (): Promise<SlideshowRenderSnapshot[]> => {
    if (!desktopRuntime) return [];
    const jobs = await window.knouxSlideshowAPI.renderJobs();
    setRenderJobs(jobs);
    return jobs;
  }, [desktopRuntime]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) return;
    try {
      const [nextRecent, nextRecoveries, jobs] = await Promise.all([
        window.knouxSlideshowAPI.recent(),
        window.knouxSlideshowAPI.recoveries(),
        window.knouxSlideshowAPI.renderJobs(),
      ]);
      setRecent(nextRecent);
      setRecoveries(nextRecoveries);
      setRenderJobs(jobs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.workspaceFailed'));
    }
  }, [desktopRuntime, t]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);
  useEffect(() => {
    const unsubscribe = window.knouxSlideshowAPI?.onRenderProgress((snapshot) => {
        setRenderJobs((current) =>
          [snapshot, ...current.filter((entry) => entry.id !== snapshot.id)].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          )
        );
        if (['completed', 'failed', 'canceled'].includes(snapshot.status))
          void refreshRenderJobs().catch(() => undefined);
      });
    return unsubscribe;
  }, [refreshRenderJobs]);

  useEffect(() => {
    if (!desktopRuntime) return undefined;
    const refresh = (): void => { void refreshRenderJobs().catch(() => undefined); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [desktopRuntime, refreshRenderJobs]);

  useEffect(() => {
    if (!project || !dirty || !desktopRuntime) return undefined;
    const timer = window.setTimeout(() => {
      void window.knouxSlideshowAPI.autosave(project).catch(() => undefined);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [desktopRuntime, dirty, project]);

  useEffect(() => {
    const flush = (): void => {
      const current = projectRef.current;
      if (current && dirty && desktopRuntime)
        void window.knouxSlideshowAPI.autosave(current).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [desktopRuntime, dirty]);

  useEffect(() => {
    if (!desktopRuntime || !projectRef.current) {
      setAssetStatuses([]);
      return;
    }
    let active = true;
    void window.knouxSlideshowAPI
      .preflight(projectRef.current)
      .then((statuses) => {
        if (active) setAssetStatuses(statuses);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Media preflight failed.');
      });
    return () => {
      active = false;
    };
  }, [assetPathKey, desktopRuntime]);

  useEffect(() => {
    if (!previewPlaying || duration <= 0) return undefined;
    const startedAt = performance.now() - previewTimeRef.current * 1_000;
    previewTimerRef.current = window.setInterval(() => {
      const next = (performance.now() - startedAt) / 1_000;
      if (next >= duration) {
        setPreviewTime(duration);
        setPreviewPlaying(false);
      } else setPreviewTime(next);
    }, 50);
    return () => {
      if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    };
  }, [duration, previewPlaying]);

  useEffect(() => {
    if (!project) return;
    const context = previewAudioContext.current ?? new AudioContext();
    previewAudioContext.current = context;
    if (previewPlaying && context.state === 'suspended') void context.resume();
    const setMediaGain = (element: HTMLMediaElement, gain: number): void => {
      let node = previewGainNodes.current.get(element);
      if (!node) {
        const source = context.createMediaElementSource(element);
        node = context.createGain();
        source.connect(node).connect(context.destination);
        previewGainNodes.current.set(element, node);
      }
      element.volume = 1;
      node.gain.setValueAtTime(clamp(gain, 0, 2), context.currentTime);
    };
    visibleSlides.forEach(({ slide, range }) => {
      if (slide.kind !== 'video') return;
      const element = videoRefs.current.get(slide.id);
      if (!element) return;
      const target = slide.sourceIn + clamp(previewTime - range.start, 0, slide.duration);
      if (Math.abs(element.currentTime - target) > 0.1) element.currentTime = target;
      setMediaGain(element, slide.muted ? 0 : slide.volume);
      if (previewPlaying) void element.play().catch(() => undefined);
      else element.pause();
    });

    const voiceIntervals = project.audioTracks.filter((track) => {
      if (track.kind !== 'voice-over') return false;
      const mediaLength = track.sourceDuration ?? track.sourceOut ?? SLIDESHOW_LIMITS.audioTrimMin;
      const effective = effectiveAudioDuration(track, mediaLength, duration);
      return effective > 0;
    }).map((track) => {
      const mediaLength = track.sourceDuration ?? track.sourceOut ?? SLIDESHOW_LIMITS.audioTrimMin;
      return { start: track.start, end: track.start + effectiveAudioDuration(track, mediaLength, duration) };
    });
    const activeIds = new Set(project.audioTracks.map((track) => track.id));
    for (const [id, element] of audioElements.current) {
      if (!activeIds.has(id)) {
        element.pause();
        element.removeAttribute('src');
        audioElements.current.delete(id);
      }
    }
    project.audioTracks.forEach((track) => {
      const status = assetStatuses.find(
        (entry) => entry.assetId === track.id && entry.status === 'present'
      );
      if (!status?.mediaUrl) return;
      let element = audioElements.current.get(track.id);
      if (!element) {
        element = new Audio(status.mediaUrl);
        element.preload = 'auto';
        audioElements.current.set(track.id, element);
      }
      const mediaLength =
        track.sourceDuration ?? status.duration ?? track.sourceOut ?? SLIDESHOW_LIMITS.audioTrimMin;
      const effective = effectiveAudioDuration(track, mediaLength, duration);
      const local = previewTime - track.start;
      if (local < 0 || local > effective || !previewPlaying) {
        element.pause();
        return;
      }
      const trimLength = (track.sourceOut ?? mediaLength) - track.sourceIn;
      const sourceTime = track.sourceIn + (track.loop ? local % trimLength : local);
      if (Math.abs(element.currentTime - sourceTime) > 0.1) element.currentTime = sourceTime;
      const duck = track.kind === 'music' && track.duckingEnabled
        ? previewDuckGainAt(previewTime, track.duckingGain, voiceIntervals)
        : 1;
      setMediaGain(element, audioGainAt(track, previewTime, mediaLength, duration) * duck);
      void element.play().catch(() => undefined);
    });
  }, [assetStatuses, duration, previewPlaying, previewTime, project, visibleSlides]);

  useEffect(
    () => () => {
      for (const element of audioElements.current.values()) {
        element.pause();
        element.removeAttribute('src');
      }
      previewGainNodes.current.clear();
      void previewAudioContext.current?.close();
      previewAudioContext.current = null;
    },
    []
  );

  const activate = useCallback(
    (next: SlideshowProject, filePath?: string, unsaved = false): void => {
      setProject(structuredClone(next));
      setProjectPath(filePath);
      setSelectedSlideId(next.slides[0]?.id ?? null);
      setPreviewTime(0);
      setPreviewPlaying(false);
      setDirty(unsaved);
      setError(null);
      setNotice(null);
      setCorruptOpen(null);
      setUndoHistory([]);
      setRedoHistory([]);
    },
    []
  );

  const commit = useCallback((next: SlideshowProject): void => {
    const current = projectRef.current;
    if (current) setUndoHistory((history) => [...history, structuredClone(current)].slice(-100));
    setRedoHistory([]);
    setProject({
      ...structuredClone(next),
      slides: constrainSlideTransitions(next.slides),
      updatedAt: new Date().toISOString(),
    });
    setDirty(true);
  }, []);

  const undo = useCallback((): void => {
    const current = projectRef.current;
    setUndoHistory((history) => {
      const previous = history.at(-1);
      if (!current || !previous) return history;
      setRedoHistory((redo) => [...redo, structuredClone(current)].slice(-100));
      setProject(structuredClone(previous));
      setDirty(true);
      return history.slice(0, -1);
    });
  }, []);
  const redo = useCallback((): void => {
    const current = projectRef.current;
    setRedoHistory((history) => {
      const next = history.at(-1);
      if (!current || !next) return history;
      setUndoHistory((undoStack) => [...undoStack, structuredClone(current)].slice(-100));
      setProject(structuredClone(next));
      setDirty(true);
      return history.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const createProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy || !newProjectName.trim()) return;
    setBusy(true);
    try {
      activate(await window.knouxSlideshowAPI.create(newProjectName.trim(), newTemplate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.createFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, newProjectName, newTemplate, t]);

  const handleOpened = useCallback(
    (opened: SlideshowOpenResult): void => {
      if (opened.status === 'opened') activate(opened.project, opened.filePath);
      else {
        setCorruptOpen(opened);
        setProject(null);
        setError(opened.error);
      }
    },
    [activate]
  );

  const openProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setBusy(true);
    try {
      const opened = await window.knouxSlideshowAPI.open();
      if (opened) handleOpened(opened);
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('slideshow.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, handleOpened, refreshWorkspace, t]);
  const openRecent = useCallback(
    async (filePath: string): Promise<void> => {
      setBusy(true);
      try {
        handleOpened(await window.knouxSlideshowAPI.openRecent(filePath));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('slideshow.openFailed'));
      } finally {
        setBusy(false);
      }
    },
    [handleOpened, t]
  );

  const recoverBackup = useCallback(
    async (backupPath: string): Promise<void> => {
      if (!corruptOpen) return;
      setBusy(true);
      try {
        const recovered = await window.knouxSlideshowAPI.recoverBackup(
          corruptOpen.filePath,
          corruptOpen.quarantinePath,
          backupPath
        );
        activate(recovered.project, recovered.filePath, true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Backup recovery failed.');
      } finally {
        setBusy(false);
      }
    },
    [activate, corruptOpen]
  );

  const saveProject = useCallback(
    async (saveAs = false): Promise<void> => {
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
    },
    [busy, desktopRuntime, project, projectPath, refreshWorkspace, t]
  );

  const addImported = useCallback(
    (result: SlideshowImportResult): void => {
      const current = projectRef.current;
      if (!current) return;
      const known = new Set(current.slides.map((slide) => slide.sourcePath.toLocaleLowerCase()));
      const additions = result.assets
        .filter((asset) => !known.has(asset.filePath.toLocaleLowerCase()))
        .map((asset) =>
          createSlideshowSlide({
            id: crypto.randomUUID(),
            sourcePath: asset.filePath,
            kind: asset.family as 'image' | 'video',
            title: basename(asset.filePath),
            duration: asset.family === 'video' ? asset.duration! : current.defaultImageDuration,
            sourceDuration: asset.duration,
            transition: current.defaultTransition,
            transitionDuration: current.defaultTransitionDuration,
          })
        );
      if (additions.length > 0) {
        commit({ ...current, slides: [...current.slides, ...additions] });
        setSelectedSlideId(additions.at(-1)!.id);
      }
      setNotice(
        l(
          `${additions.length} added · ${result.skipped} skipped · ${result.failed} failed`,
          `تمت إضافة ${additions.length} · تم تخطي ${result.skipped} · فشل ${result.failed}`
        )
      );
    },
    [commit, l]
  );
  const importMedia = useCallback(
    async (folder: boolean): Promise<void> => {
      if (!projectRef.current || busy || !desktopRuntime) return;
      setBusy(true);
      setError(null);
      try {
        addImported(
          folder
            ? await window.knouxSlideshowAPI.importFolder()
            : await window.knouxSlideshowAPI.importFiles()
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Media import failed.');
      } finally {
        setBusy(false);
      }
    },
    [addImported, busy, desktopRuntime]
  );

  const addTextCard = useCallback(
    (kind: 'title' | 'end-card'): void => {
      const current = projectRef.current;
      if (!current) return;
      const slide = createSlideshowSlide({
        id: crypto.randomUUID(),
        sourcePath: '',
        kind,
        title: kind === 'title' ? current.name : l('Thank you', 'شكرًا لكم'),
        duration: current.defaultImageDuration,
        transition: current.defaultTransition,
        transitionDuration: current.defaultTransitionDuration,
      });
      slide.backgroundColor = current.backgroundColor;
      slide.kenBurns = 'none';
      commit({ ...current, slides: [...current.slides, slide] });
      setSelectedSlideId(slide.id);
    },
    [commit, l]
  );

  const addAudio = useCallback(
    async (kind: SlideshowAudioTrack['kind']): Promise<void> => {
      const current = projectRef.current;
      if (!current || busy || duration < SLIDESHOW_LIMITS.audioTrimMin) return;
      setBusy(true);
      try {
        const selected = await window.knouxCreativeAPI.media.open();
        if (!selected) return;
        if (!audioExtensions.has(extension(selected.filePath)))
          throw new Error(l('Choose a supported audio file.', 'اختر ملفًا صوتيًا مدعومًا.'));
        const sourceDuration = await mediaDuration(selected.mediaUrl, 'audio');
        const fade = kind === 'music' ? Math.min(1, sourceDuration / 2) : 0;
        const track: SlideshowAudioTrack = {
          id: crypto.randomUUID(),
          sourcePath: selected.filePath,
          name: basename(selected.filePath),
          start: 0,
          sourceIn: 0,
          sourceOut: sourceDuration,
          sourceDuration,
          volume: kind === 'music' ? 0.65 : 1,
          fadeIn: fade,
          fadeOut: fade,
          loop: kind === 'music',
          kind,
          duckingEnabled: kind === 'music',
          duckingGain: 0.25,
        };
        commit(addAudioTrack(current, track));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Audio import failed.');
      } finally {
        setBusy(false);
      }
    },
    [busy, commit, duration, l]
  );

  const addWatermark = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (!current || busy) return;
    setBusy(true);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      if (!imageExtensions.has(extension(selected.filePath)))
        throw new Error(l('Choose an image watermark.', 'اختر صورة علامة مائية.'));
      commit({
        ...current,
        watermark: {
          sourcePath: selected.filePath,
          opacity: 0.7,
          scale: 0.16,
          position: 'bottom-right',
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Watermark failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, commit, l]);

  const patchSelectedSlide = useCallback(
    (patcher: (slide: SlideshowSlide) => SlideshowSlide): void => {
      const current = projectRef.current;
      if (!current || !selectedSlideId) return;
      commit({
        ...current,
        slides: current.slides.map((slide) =>
          slide.id === selectedSlideId ? patcher(structuredClone(slide)) : slide
        ),
      });
    },
    [commit, selectedSlideId]
  );
  const moveSelected = useCallback(
    (direction: -1 | 1): void => {
      const current = projectRef.current;
      if (!current || !selectedSlideId) return;
      const index = current.slides.findIndex((slide) => slide.id === selectedSlideId);
      commit({
        ...current,
        slides: reorderSlide(current.slides, selectedSlideId, index + direction),
      });
    },
    [commit, selectedSlideId]
  );
  const removeSelected = useCallback((): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    const index = current.slides.findIndex((slide) => slide.id === selectedSlideId);
    const slides = current.slides.filter((slide) => slide.id !== selectedSlideId);
    commit({ ...current, slides });
    setSelectedSlideId(slides[Math.min(index, slides.length - 1)]?.id ?? null);
  }, [commit, selectedSlideId]);
  const duplicateSelected = useCallback((): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    const id = crypto.randomUUID();
    commit({ ...current, slides: duplicateSlide(current.slides, selectedSlideId, id) });
    setSelectedSlideId(id);
  }, [commit, selectedSlideId]);

  const patchAudio = useCallback(
    (trackId: string, patch: Partial<SlideshowAudioTrack>): void => {
      const current = projectRef.current;
      if (!current) return;
      commit({
        ...current,
        audioTracks: current.audioTracks.map((track) =>
          track.id === trackId ? { ...track, ...patch } : track
        ),
      });
    },
    [commit]
  );

  const activateCompletedOutput = useCallback(
    async (jobId: string, action: 'open' | 'reveal'): Promise<void> => {
      try {
        const jobs = await refreshRenderJobs();
        const job = jobs.find((entry) => entry.id === jobId);
        if (!job || job.outputExists === false) return;
        if (action === 'open') await window.knouxSlideshowAPI.openOutput(jobId);
        else await window.knouxSlideshowAPI.revealOutput(jobId);
      } catch (reason) {
        await refreshRenderJobs().catch(() => undefined);
        setError(reason instanceof Error ? reason.message : 'Completed output is unavailable.');
      }
    },
    [refreshRenderJobs]
  );

  const relinkFile = useCallback(
    async (status: SlideshowAssetStatus): Promise<void> => {
      const current = projectRef.current;
      if (!current) return;
      try {
        const selected = await window.knouxSlideshowAPI.relinkFile(status.family);
        if (!selected) return;
        const next = structuredClone(current);
        if (status.role === 'slide')
          next.slides = next.slides.map((slide) =>
            slide.id === status.assetId
              ? {
                  ...slide,
                  sourcePath: selected.filePath,
                  sourceDuration: slide.kind === 'video' ? selected.duration : null,
                  sourceOut: slide.kind === 'video' ? selected.duration : null,
                  duration: slide.kind === 'video' ? selected.duration! : slide.duration,
                }
              : slide
          );
        else if (status.role === 'audio')
          next.audioTracks = next.audioTracks.map((track) =>
            track.id === status.assetId
              ? {
                  ...track,
                  sourcePath: selected.filePath,
                  sourceDuration: selected.duration,
                  sourceIn: 0,
                  sourceOut: selected.duration,
                  fadeIn: 0,
                  fadeOut: 0,
                }
              : track
          );
        else if (next.watermark) next.watermark.sourcePath = selected.filePath;
        commit(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Relink failed.');
      }
    },
    [commit]
  );
  const relinkFolder = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (!current) return;
    try {
      const result = await window.knouxSlideshowAPI.relinkFolder(current);
      const next = structuredClone(current);
      result.matches.forEach((match) => {
        if (match.role === 'slide')
          next.slides = next.slides.map((slide) =>
            slide.id === match.assetId
              ? {
                  ...slide,
                  sourcePath: match.newPath,
                  sourceDuration: slide.kind === 'video' ? match.duration : null,
                  sourceOut: slide.kind === 'video' ? match.duration : null,
                  duration: slide.kind === 'video' ? match.duration! : slide.duration,
                }
              : slide
          );
        else if (match.role === 'audio')
          next.audioTracks = next.audioTracks.map((track) =>
            track.id === match.assetId
              ? {
                  ...track,
                  sourcePath: match.newPath,
                  sourceDuration: match.duration,
                  sourceIn: 0,
                  sourceOut: match.duration,
                  fadeIn: 0,
                  fadeOut: 0,
                }
              : track
          );
        else if (next.watermark) next.watermark.sourcePath = match.newPath;
      });
      if (result.matches.length > 0) commit(next);
      setNotice(
        l(
          `${result.matches.length} relinked · ${result.unresolved.length} unresolved · ${result.ambiguous.length} ambiguous`,
          `تم ربط ${result.matches.length} · غير محلول ${result.unresolved.length} · ملتبس ${result.ambiguous.length}`
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Folder relink failed.');
    }
  }, [commit, l]);

  const startRender = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (!current || missingAssets.length > 0 || current.slides.length === 0 || !desktopRuntime)
      return;
    setError(null);
    try {
      const queued = await window.knouxSlideshowAPI.render(current, renderFormat);
      if (queued)
        setRenderJobs((jobs) => [queued, ...jobs.filter((entry) => entry.id !== queued.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Render enqueue failed.');
    }
  }, [desktopRuntime, missingAssets.length, renderFormat]);

  if (!project) {
    return (
      <section className="creative-view slideshow-view" aria-labelledby="slideshow-title">
        <header className="creative-header">
          <div>
            <span className="creative-eyebrow">{t('slideshow.eyebrow')}</span>
            <h1 id="slideshow-title">
              <Film size={30} /> {t('slideshow.title')}
            </h1>
            <p>{t('slideshow.description')}</p>
          </div>
        </header>
        <RuntimeModeNotice
          feature="Offline slideshow projects and FFmpeg rendering"
          featureAr="مشاريع عروض شرائح ورندر FFmpeg محلي"
        />
        {error && (
          <div className="creative-error" role="alert">
            {error}
          </div>
        )}
        {corruptOpen && (
          <NeonPanel variant="dark" padding="lg" className="slideshow-corrupt-panel">
            <h2>{l('Corrupt project quarantined', 'تم عزل المشروع التالف')}</h2>
            <p dir="auto">{corruptOpen.filePath}</p>
            <p>
              {l(
                'The corrupt bytes remain preserved. Choose the newest valid backup to recover.',
                'تم الاحتفاظ بالبيانات التالفة. اختر أحدث نسخة احتياطية صالحة للاستعادة.'
              )}
            </p>
            {corruptOpen.backups.length === 0 ? (
              <div className="creative-empty">
                {l('No valid backup is available.', 'لا توجد نسخة احتياطية صالحة.')}
              </div>
            ) : (
              corruptOpen.backups.map((backup) => (
                <button
                  key={backup.filePath}
                  type="button"
                  onClick={() => void recoverBackup(backup.filePath)}
                >
                  <RotateCcw size={15} />
                  <span>
                    {new Date(backup.modifiedAt).toLocaleString(
                      locale === 'ar' ? 'ar-AE' : 'en-US'
                    )}{' '}
                    · {backup.sha256.slice(0, 12)}
                  </span>
                </button>
              ))
            )}
          </NeonPanel>
        )}
        <div className="slideshow-start-grid">
          <NeonPanel variant="dark" padding="lg" className="slideshow-start-card">
            <WandSparkles size={46} />
            <h2>{t('slideshow.newProject')}</h2>
            <label>
              <span>{l('Project name', 'اسم المشروع')}</span>
              <input
                data-testid="slideshow-new-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value.slice(0, 160))}
              />
            </label>
            <label>
              <span>{l('Template', 'القالب')}</span>
              <NeonSelect
                value={newTemplate}
                onChange={(val) => setNewTemplate(val as SlideshowTemplate)}
                options={templates.map((entry) => ({ value: entry, label: entry }))}
                label={l('Template', 'القالب')}
              />
            </label>
            <NeonButton
              variant="primary"
              leftIcon={<FilePlus2 size={16} />}
              onClick={() => void createProject()}
              disabled={!desktopRuntime || busy || !newProjectName.trim()}
              data-disabled-reason={
                !desktopRuntime
                  ? l('Desktop runtime is required.', 'يلزم إصدار سطح المكتب.')
                  : undefined
              }
            >
              {t('slideshow.create')}
            </NeonButton>
            <NeonButton
              variant="secondary"
              leftIcon={<FolderOpen size={16} />}
              onClick={() => void openProject()}
              disabled={!desktopRuntime || busy}
            >
              {t('slideshow.open')}
            </NeonButton>
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg">
            <h2>{t('slideshow.recoveries')}</h2>
            {recoveries.length === 0 ? (
              <div className="creative-empty">{t('slideshow.noRecoveries')}</div>
            ) : (
              recoveries.map((entry) =>
                entry.status === 'valid' && entry.project ? (
                  <button
                    key={entry.filePath}
                    type="button"
                    className="slideshow-project-link"
                    onClick={() => activate(entry.project!, undefined, true)}
                  >
                    <strong>{entry.project.name}</strong>
                    <span>
                      {new Date(entry.modifiedAt).toLocaleString(
                        locale === 'ar' ? 'ar-AE' : 'en-US'
                      )}
                    </span>
                  </button>
                ) : (
                  <div key={entry.filePath} className="creative-error">
                    <strong>
                      {l('Corrupt autosave preserved', 'تم الاحتفاظ بالحفظ التلقائي التالف')}
                    </strong>
                    <span dir="auto">{entry.quarantinePath}</span>
                  </div>
                )
              )
            )}
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg">
            <h2>{t('slideshow.recent')}</h2>
            {recent.length === 0 ? (
              <div className="creative-empty">{t('slideshow.noRecent')}</div>
            ) : (
              recent.map((filePath) => (
                <button
                  key={filePath}
                  type="button"
                  className="slideshow-project-link"
                  onClick={() => void openRecent(filePath)}
                >
                  <strong>{basename(filePath)}</strong>
                  <span dir="auto">{filePath}</span>
                </button>
              ))
            )}
          </NeonPanel>
        </div>
      </section>
    );
  }

  return (
    <section className="creative-view slideshow-view" aria-labelledby="slideshow-title">
      <header className="creative-header slideshow-header">
        <div>
          <span className="creative-eyebrow">{t('slideshow.eyebrow')}</span>
          <h1 id="slideshow-title">
            <Film size={30} /> {project.name}
          </h1>
          <p>
            {outputSize.width}×{outputSize.height} · {project.fps} FPS · {project.slides.length}{' '}
            {t('slideshow.slides')} · {formatTime(duration)}
          </p>
        </div>
        <div className="creative-actions">
          <NeonButton
            variant="ghost"
            leftIcon={<FilePlus2 size={15} />}
            onClick={() => {
              setProject(null);
              setProjectPath(undefined);
            }}
          >
            {t('common.new')}
          </NeonButton>
          <NeonButton
            variant="ghost"
            leftIcon={<FolderOpen size={15} />}
            onClick={() => void openProject()}
            disabled={busy}
          >
            {t('common.open')}
          </NeonButton>
          <NeonButton
            variant="secondary"
            leftIcon={<Save size={15} />}
            onClick={() => void saveProject(false)}
            disabled={busy}
          >
            {dirty ? t('slideshow.saveChanges') : t('common.save')}
          </NeonButton>
          <NeonButton variant="ghost" onClick={() => void saveProject(true)} disabled={busy}>
            {t('common.saveAs')}
          </NeonButton>
        </div>
      </header>
      <RuntimeModeNotice
        feature="Offline slideshow projects and FFmpeg rendering"
        featureAr="مشاريع عروض شرائح ورندر FFmpeg محلي"
      />
      <StudioPresetBar
        kind="slideshow"
        values={{
          template: project.template,
          aspect: project.aspect,
          resolution: project.resolution,
          fps: project.fps,
          defaultImageDuration: project.defaultImageDuration,
          defaultTransition: project.defaultTransition,
          renderFormat,
        }}
        onApply={(values) => {
          const next = structuredClone(project);
          if (templates.includes(values.template as SlideshowTemplate))
            next.template = values.template as SlideshowTemplate;
          if (aspects.includes(values.aspect as SlideshowAspect))
            next.aspect = values.aspect as SlideshowAspect;
          if (resolutions.includes(values.resolution as SlideshowResolution))
            next.resolution = values.resolution as SlideshowResolution;
          if ([24, 25, 30, 50, 60].includes(Number(values.fps)))
            next.fps = Number(values.fps) as SlideshowProject['fps'];
          if (typeof values.defaultImageDuration === 'number')
            next.defaultImageDuration = clamp(values.defaultImageDuration, 0.1, 86_400);
          if (transitions.includes(values.defaultTransition as SlideshowTransition))
            next.defaultTransition = values.defaultTransition as SlideshowTransition;
          if (renderFormats.includes(values.renderFormat as SlideshowRenderFormat))
            setRenderFormat(values.renderFormat as SlideshowRenderFormat);
          commit(next);
        }}
      />
      {error && (
        <div className="creative-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="creative-success" role="status">
          {notice}
        </div>
      )}

      <div className="slideshow-toolbar" aria-label={l('Slideshow actions', 'إجراءات عرض الشرائح')}>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<ImagePlus size={14} />}
          onClick={() => void importMedia(false)}
          disabled={!desktopRuntime || busy}
        >
          {l('Add Media', 'إضافة وسائط')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<FolderSearch size={14} />}
          onClick={() => void importMedia(true)}
          disabled={!desktopRuntime || busy}
        >
          {l('Add Folder', 'إضافة مجلد')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<Type size={14} />}
          onClick={() => addTextCard('title')}
        >
          {t('slideshow.addTitle')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<CheckCircle2 size={14} />}
          onClick={() => addTextCard('end-card')}
        >
          {t('slideshow.addEnd')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<Music size={14} />}
          onClick={() => void addAudio('music')}
          disabled={duration < 0.05}
          data-disabled-reason={
            duration < 0.05 ? l('Add a slide first.', 'أضف شريحة أولًا.') : undefined
          }
        >
          {t('slideshow.addMusic')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<AudioLines size={14} />}
          onClick={() => void addAudio('voice-over')}
          disabled={duration < 0.05}
        >
          {t('slideshow.addVoice')}
        </NeonButton>
        <NeonButton
          variant="ghost"
          size="sm"
          leftIcon={<FileImage size={14} />}
          onClick={() => void addWatermark()}
        >
          {project.watermark ? l('Replace watermark', 'استبدال العلامة') : t('slideshow.watermark')}
        </NeonButton>
        <button
          type="button"
          aria-label={l('Undo', 'تراجع')}
          onClick={undo}
          disabled={undoHistory.length === 0}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label={l('Redo', 'إعادة')}
          onClick={redo}
          disabled={redoHistory.length === 0}
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          aria-label={l('Duplicate slide', 'تكرار الشريحة')}
          onClick={duplicateSelected}
          disabled={!selectedSlide}
        >
          <Copy size={16} />
        </button>
        <button
          type="button"
          aria-label={l('Move earlier', 'تحريك للخلف')}
          onClick={() => moveSelected(-1)}
          disabled={!selectedSlide || project.slides[0]?.id === selectedSlide.id}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          aria-label={l('Move later', 'تحريك للأمام')}
          onClick={() => moveSelected(1)}
          disabled={!selectedSlide || project.slides.at(-1)?.id === selectedSlide.id}
        >
          <ArrowDown size={16} />
        </button>
        <button
          type="button"
          aria-label={l('Delete slide', 'حذف الشريحة')}
          onClick={removeSelected}
          disabled={!selectedSlide}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {missingAssets.length > 0 && (
        <NeonPanel variant="dark" padding="md" className="slideshow-missing-panel">
          <div className="creative-section-heading">
            <h2>{l('Missing media', 'وسائط مفقودة')}</h2>
            <NeonButton
              variant="secondary"
              size="sm"
              leftIcon={<FolderSearch size={14} />}
              onClick={() => void relinkFolder()}
            >
              {l('Relink Folder', 'ربط من مجلد')}
            </NeonButton>
          </div>
          {missingAssets.map((status) => (
            <div key={`${status.role}-${status.assetId}`}>
              <span>
                {status.role} · {status.status}
              </span>
              <code dir="ltr">{status.sourcePath}</code>
              <button type="button" onClick={() => void relinkFile(status)}>
                <LocateFixed size={15} />
                {l('Relink File', 'ربط ملف')}
              </button>
            </div>
          ))}
        </NeonPanel>
      )}

      <div className="slideshow-main-grid">
        <NeonPanel variant="dark" padding="none" className="slideshow-preview-panel">
          <div
            className="slideshow-preview-stage"
            style={{
              aspectRatio: `${outputSize.width}/${outputSize.height}`,
              background: project.backgroundColor,
            }}
          >
            {visibleSlides.length === 0 ? (
              <div className="creative-empty">{t('slideshow.emptyPreview')}</div>
            ) : (
              visibleSlides.map(({ slide, range }, layerIndex) => {
                const status = assetStatuses.find(
                  (entry) => entry.assetId === slide.id && entry.status === 'present'
                );
                const localProgress = clamp((previewTime - range.start) / slide.duration, 0, 1);
                const motion = kenBurnsTransform(slide.kenBurns, localProgress);
                const incoming =
                  visibleSlides.length > 1 && layerIndex === visibleSlides.length - 1;
                const transitionProgress = incoming
                  ? clamp(
                      (previewTime - range.start) / Math.max(0.001, slide.transitionDuration),
                      0,
                      1
                    )
                  : 1;
                const layerOpacity =
                  visibleSlides.length > 1
                    ? incoming
                      ? transitionProgress
                      : 1 - transitionProgress
                    : 1;
                const mediaStyle: React.CSSProperties = {
                  objectFit: slide.fit === 'fit' ? 'contain' : 'cover',
                  objectPosition: `${slide.focalX * 100}% ${slide.focalY * 100}%`,
                  transform: `translate(${motion.x}%,${motion.y}%) scale(${motion.scale * slide.cropZoom})`,
                };
                return (
                  <div
                    key={slide.id}
                    className={`slideshow-preview-layer transition-${slide.transition}`}
                    style={{ opacity: layerOpacity }}
                  >
                    {slide.kind === 'title' || slide.kind === 'end-card' ? (
                      <div
                        className="slideshow-text-card"
                        dir={slide.captionDirection === 'auto' ? 'auto' : slide.captionDirection}
                      >
                        <strong>{slide.title}</strong>
                        <span>{slide.caption}</span>
                      </div>
                    ) : status?.mediaUrl ? (
                      slide.kind === 'image' ? (
                        <img src={status.mediaUrl} alt={slide.title} style={mediaStyle} />
                      ) : (
                        <video
                          ref={(element) => {
                            if (element) videoRefs.current.set(slide.id, element);
                            else videoRefs.current.delete(slide.id);
                          }}
                          src={status.mediaUrl}
                          muted={slide.muted}
                          style={mediaStyle}
                        />
                      )
                    ) : (
                      <div className="creative-error">
                        {l('Missing media — relink required', 'الوسائط مفقودة — يلزم الربط')}
                      </div>
                    )}
                    {(slide.kind === 'image' || slide.kind === 'video') &&
                      (slide.title || slide.caption) && (
                        <div
                          className="slideshow-caption"
                          dir={slide.captionDirection === 'auto' ? 'auto' : slide.captionDirection}
                        >
                          {slide.title && <strong>{slide.title}</strong>}
                          <span>{slide.caption}</span>
                        </div>
                      )}
                  </div>
                );
              })
            )}
            {project.watermark &&
              (() => {
                const status = assetStatuses.find(
                  (entry) => entry.role === 'watermark' && entry.status === 'present'
                );
                return status?.mediaUrl ? (
                  <img
                    className={`slideshow-watermark-image ${project.watermark!.position}`}
                    src={status.mediaUrl}
                    alt={l('Watermark', 'علامة مائية')}
                    style={{
                      opacity: project.watermark!.opacity,
                      width: `${project.watermark!.scale * 100}%`,
                    }}
                  />
                ) : null;
              })()}
            <button
              type="button"
              aria-label={
                previewPlaying
                  ? l('Pause preview', 'إيقاف المعاينة')
                  : l('Play preview', 'تشغيل المعاينة')
              }
              className="slideshow-preview-toggle"
              onClick={() => {
                if (previewTime >= duration) setPreviewTime(0);
                setPreviewPlaying((value) => !value);
              }}
            >
              {previewPlaying ? <Pause size={22} /> : <Play size={22} />}
            </button>
          </div>
          <div className="slideshow-preview-controls">
            <input
              aria-label={l('Preview time', 'وقت المعاينة')}
              type="range"
              min="0"
              max={Math.max(0.001, duration)}
              step="0.05"
              value={Math.min(previewTime, duration)}
              onChange={(event) => {
                setPreviewPlaying(false);
                setPreviewTime(Number(event.target.value));
              }}
            />
            <strong dir="ltr">
              {formatTime(previewTime)} / {formatTime(duration)}
            </strong>
          </div>
        </NeonPanel>

        <NeonPanel variant="dark" padding="md" className="slideshow-inspector">
          <h2>{selectedSlide ? t('slideshow.slideInspector') : t('slideshow.projectSettings')}</h2>
          {selectedSlide ? (
            <div className="slideshow-form-stack">
              <label>
                <span>{t('slideshow.slideTitle')}</span>
                <input
                  value={selectedSlide.title}
                  onChange={(event) =>
                    patchSelectedSlide((slide) => ({
                      ...slide,
                      title: event.target.value.slice(0, 300),
                    }))
                  }
                />
              </label>
              <label>
                <span>{t('slideshow.caption')}</span>
                <textarea
                  value={selectedSlide.caption}
                  dir={
                    selectedSlide.captionDirection === 'auto'
                      ? 'auto'
                      : selectedSlide.captionDirection
                  }
                  onChange={(event) =>
                    patchSelectedSlide((slide) => ({
                      ...slide,
                      caption: event.target.value.normalize('NFC').slice(0, 1000),
                    }))
                  }
                />
              </label>
              <label>
                <span>{l('Caption direction', 'اتجاه النص')}</span>
                <NeonSelect
                  value={selectedSlide.captionDirection}
                  onChange={(val) =>
                    patchSelectedSlide((slide) => ({
                      ...slide,
                      captionDirection: val as CaptionDirection,
                    }))
                  }
                  options={directions.map((entry) => ({ value: entry, label: entry }))}
                  label={l('Caption direction', 'اتجاه النص')}
                />
              </label>
              <label>
                <span>{t('slideshow.duration')}</span>
                <input
                  type="number"
                  min="0.1"
                  max="86400"
                  step="0.1"
                  value={selectedSlide.duration}
                  disabled={selectedSlide.kind === 'video'}
                  onChange={(event) =>
                    patchSelectedSlide((slide) => ({
                      ...slide,
                      duration: clamp(Number(event.target.value), 0.1, 86400),
                      transitionDuration: Math.min(
                        slide.transitionDuration,
                        clamp(Number(event.target.value), 0.1, 86400) / 2
                      ),
                    }))
                  }
                />
              </label>
              {selectedSlide.kind === 'video' && (
                <div className="slideshow-two-columns">
                  <label>
                    <span>{l('Source in', 'بداية المصدر')}</span>
                    <input
                      type="number"
                      min="0"
                      max={(selectedSlide.sourceOut ?? 0) - 0.05}
                      step="0.05"
                      value={selectedSlide.sourceIn}
                      onChange={(event) =>
                        patchSelectedSlide((slide) => {
                          const sourceIn = clamp(
                            Number(event.target.value),
                            0,
                            (slide.sourceOut ?? 0) - 0.05
                          );
                          return {
                            ...slide,
                            sourceIn,
                            duration: (slide.sourceOut ?? sourceIn + 0.05) - sourceIn,
                          };
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>{l('Source out', 'نهاية المصدر')}</span>
                    <input
                      type="number"
                      min={selectedSlide.sourceIn + 0.05}
                      max={selectedSlide.sourceDuration ?? undefined}
                      step="0.05"
                      value={selectedSlide.sourceOut ?? 0}
                      onChange={(event) =>
                        patchSelectedSlide((slide) => {
                          const sourceOut = clamp(
                            Number(event.target.value),
                            slide.sourceIn + 0.05,
                            slide.sourceDuration ?? slide.sourceIn + 0.05
                          );
                          return { ...slide, sourceOut, duration: sourceOut - slide.sourceIn };
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <div className="slideshow-two-columns">
                <label>
                  <span>{t('slideshow.fit')}</span>
                  <NeonSelect
                    value={selectedSlide.fit}
                    onChange={(val) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        fit: val as SlideshowFit,
                      }))
                    }
                    options={fits.map((entry) => ({ value: entry, label: entry }))}
                    label={t('slideshow.fit')}
                  />
                </label>
                <label>
                  <span>{t('slideshow.motion')}</span>
                  <NeonSelect
                    value={selectedSlide.kenBurns}
                    disabled={selectedSlide.kind !== 'image'}
                    onChange={(val) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        kenBurns: val as KenBurnsMode,
                      }))
                    }
                    options={motions.map((entry) => ({ value: entry, label: entry }))}
                    label={t('slideshow.motion')}
                  />
                </label>
              </div>
              <div className="slideshow-three-columns">
                <label>
                  <span>{l('Focal X', 'بؤرة X')}</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedSlide.focalX}
                    onChange={(event) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        focalX: clamp(Number(event.target.value), 0, 1),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{l('Focal Y', 'بؤرة Y')}</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedSlide.focalY}
                    onChange={(event) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        focalY: clamp(Number(event.target.value), 0, 1),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{l('Crop zoom', 'تكبير القص')}</span>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    step="0.05"
                    value={selectedSlide.cropZoom}
                    onChange={(event) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        cropZoom: clamp(Number(event.target.value), 1, 4),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="slideshow-two-columns">
                <label>
                  <span>{t('slideshow.transition')}</span>
<NeonSelect
                  value={selectedSlide.transition}
                  onChange={(val) =>
                    patchSelectedSlide((slide) => ({
                      ...slide,
                      transition: val as SlideshowTransition,
                    }))
                  }
                  options={transitions.map((entry) => ({ value: entry, label: entry }))}
                  label={t('slideshow.transition')}
                />
                </label>
                <label>
                  <span>{t('slideshow.transitionDuration')}</span>
                  <input
                    type="number"
                    min="0"
                    max={selectedTransitionMaximum}
                    step="0.05"
                    value={selectedSlide.transitionDuration}
                    disabled={selectedSlide.transition === 'none'}
                    onChange={(event) =>
                      patchSelectedSlide((slide) => ({
                        ...slide,
                        transitionDuration: clamp(
                          Number(event.target.value),
                          0,
                          selectedTransitionMaximum
                        ),
                      }))
                    }
                  />
                </label>
              </div>
              {selectedSlide.kind === 'video' && (
                <>
                  <label>
                    <span>
                      {t('slideshow.volume')} · {Math.round(selectedSlide.volume * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.01"
                      value={selectedSlide.volume}
                      onChange={(event) =>
                        patchSelectedSlide((slide) => ({
                          ...slide,
                          volume: clamp(Number(event.target.value), 0, 2),
                        }))
                      }
                    />
                  </label>
                  <label className="creative-check">
                    <input
                      type="checkbox"
                      checked={selectedSlide.muted}
                      onChange={(event) =>
                        patchSelectedSlide((slide) => ({ ...slide, muted: event.target.checked }))
                      }
                    />
                    {t('slideshow.muteVideo')}
                  </label>
                </>
              )}
            </div>
          ) : (
            <div className="creative-empty">{t('slideshow.selectSlide')}</div>
          )}
        </NeonPanel>
      </div>

      <NeonPanel variant="dark" padding="md" className="slideshow-settings-panel">
        <div className="slideshow-settings-grid">
          <label>
            <span>{t('slideshow.template')}</span>
            <NeonSelect
              value={project.template}
              onChange={(val) =>
                commit({ ...project, template: val as SlideshowTemplate })
              }
              options={templates.map((entry) => ({ value: entry, label: entry }))}
              label={t('slideshow.template')}
            />
          </label>
          <label>
            <span>{t('slideshow.aspect')}</span>
            <NeonSelect
              value={project.aspect}
              onChange={(val) =>
                commit({ ...project, aspect: val as SlideshowAspect })
              }
              options={aspects.map((entry) => ({ value: entry, label: entry }))}
              label={t('slideshow.aspect')}
            />
          </label>
          <label>
            <span>{t('slideshow.resolution')}</span>
            <NeonSelect
              value={project.resolution}
              onChange={(val) =>
                commit({ ...project, resolution: val as SlideshowResolution })
              }
              options={resolutions.map((entry) => ({ value: entry, label: entry }))}
              label={t('slideshow.resolution')}
            />
          </label>
          <label>
            <span>{t('slideshow.fps')}</span>
            <NeonSelect
              value={String(project.fps)}
              onChange={(val) =>
                commit({ ...project, fps: Number(val) as SlideshowProject['fps'] })
              }
              options={[24, 25, 30, 50, 60].map((entry) => ({ value: String(entry), label: `${entry}` }))}
              label={t('slideshow.fps')}
            />
          </label>
          {project.aspect === 'custom' && (
            <>
              <label>
                <span>{l('Custom width', 'عرض مخصص')}</span>
                <input
                  type="number"
                  min="64"
                  max="7680"
                  step="2"
                  value={project.customWidth}
                  onChange={(event) =>
                    commit({
                      ...project,
                      customWidth: Math.round(clamp(Number(event.target.value), 64, 7680) / 2) * 2,
                    })
                  }
                />
              </label>
              <label>
                <span>{l('Custom height', 'ارتفاع مخصص')}</span>
                <input
                  type="number"
                  min="64"
                  max="7680"
                  step="2"
                  value={project.customHeight}
                  onChange={(event) =>
                    commit({
                      ...project,
                      customHeight: Math.round(clamp(Number(event.target.value), 64, 7680) / 2) * 2,
                    })
                  }
                />
              </label>
            </>
          )}
          <label>
            <span>{l('Background', 'الخلفية')}</span>
            <input
              type="color"
              value={project.backgroundColor}
              onChange={(event) => commit({ ...project, backgroundColor: event.target.value })}
            />
          </label>
          <label>
            <span>{t('slideshow.defaultDuration')}</span>
            <input
              type="number"
              min="0.1"
              max="86400"
              step="0.1"
              value={project.defaultImageDuration}
              onChange={(event) =>
                commit({
                  ...project,
                  defaultImageDuration: clamp(Number(event.target.value), 0.1, 86400),
                })
              }
            />
          </label>
          <label>
            <span>{l('Global transition', 'الانتقال العام')}</span>
<NeonSelect
              data-testid="slideshow-global-transition"
              value={project.defaultTransition}
              onChange={(val) =>
                commit({
                  ...project,
                  defaultTransition: val as SlideshowTransition,
                })
              }
              options={transitions.map((entry) => ({ value: entry, label: entry }))}
              label={l('Global transition', 'الانتقال العام')}
            />
          </label>
          <label>
            <span>{l('Global transition duration', 'مدة الانتقال العام')}</span>
            <input
              data-testid="slideshow-global-transition-duration"
              type="number"
              min="0"
              max="86400"
              step="0.05"
              value={project.defaultTransitionDuration}
              disabled={project.defaultTransition === 'none'}
              onChange={(event) =>
                commit({
                  ...project,
                  defaultTransitionDuration: clamp(Number(event.target.value), 0, 86_400),
                })
              }
            />
          </label>
          <NeonButton
            variant="ghost"
            size="sm"
            onClick={() =>
              commit({
                ...project,
                slides: applyDurationToImages(project.slides, project.defaultImageDuration),
              })
            }
          >
            {t('slideshow.applyImages')}
          </NeonButton>
          <NeonButton
            variant="ghost"
            size="sm"
            onClick={() =>
              commit({
                ...project,
                slides: project.slides.map((slide, index) => ({
                  ...slide,
                  transition: index === 0 ? slide.transition : project.defaultTransition,
                  transitionDuration: Math.min(
                    project.defaultTransitionDuration,
                    slide.duration / 2,
                    index === 0 ? slide.duration / 2 : project.slides[index - 1].duration / 2
                  ),
                })),
              })
            }
          >
            {l('Apply transition to all', 'تطبيق الانتقال على الكل')}
          </NeonButton>
        </div>
      </NeonPanel>

      <div className="creative-section-heading">
        <h2>{t('slideshow.timeline')}</h2>
        <span>
          {project.slides.length} {t('slideshow.slides')}
        </span>
      </div>
      <div className="slideshow-strip" role="list">
        {project.slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            draggable
            onDragStart={() => setDraggedSlideId(slide.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedSlideId && draggedSlideId !== slide.id)
                commit({ ...project, slides: reorderSlide(project.slides, draggedSlideId, index) });
              setDraggedSlideId(null);
            }}
            className={`${selectedSlideId === slide.id ? 'selected' : ''} ${draggedSlideId === slide.id ? 'dragging' : ''}`}
            onClick={() => {
              setSelectedSlideId(slide.id);
              setPreviewPlaying(false);
              setPreviewTime(ranges[index]?.start ?? 0);
            }}
          >
            <span>{index + 1}</span>
            {slide.kind === 'video' ? (
              <Video size={22} />
            ) : slide.kind === 'image' ? (
              <FileImage size={22} />
            ) : (
              <Type size={22} />
            )}
            <strong>{slide.title || basename(slide.sourcePath)}</strong>
            <small>
              {formatTime(slide.duration)} · {slide.transition}
            </small>
          </button>
        ))}
      </div>

      <div className="creative-section-heading">
        <h2>{t('slideshow.audio')}</h2>
        <span>
          {project.audioTracks.length} {t('common.items')}
        </span>
      </div>
      <div className="slideshow-audio-list">
        {project.audioTracks.length === 0 ? (
          <div className="creative-empty">{t('slideshow.noAudio')}</div>
        ) : (
          project.audioTracks.map((track) => {
            const max = track.sourceDuration ?? track.sourceOut ?? 0.05;
            const effective = effectiveAudioDuration(track, max, duration);
            return (
              <NeonPanel
                key={track.id}
                variant="dark"
                padding="sm"
                className="slideshow-audio-card"
              >
                <div>
                  <strong>{track.name}</strong>
                  <span>{track.kind}</span>
                </div>
                <label>
                  {l('Start', 'البداية')}
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, duration - 0.05)}
                    step="0.05"
                    value={track.start}
                    onChange={(event) =>
                      patchAudio(track.id, {
                        start: clamp(Number(event.target.value), 0, Math.max(0, duration - 0.05)),
                      })
                    }
                  />
                </label>
                <label>
                  {l('Trim in', 'بداية القص')}
                  <input
                    type="number"
                    min="0"
                    max={(track.sourceOut ?? max) - 0.05}
                    step="0.05"
                    value={track.sourceIn}
                    onChange={(event) => {
                      const sourceIn = clamp(
                        Number(event.target.value),
                        0,
                        (track.sourceOut ?? max) - 0.05
                      );
                      patchAudio(track.id, { sourceIn, fadeIn: 0, fadeOut: 0 });
                    }}
                  />
                </label>
                <label>
                  {l('Trim out', 'نهاية القص')}
                  <input
                    type="number"
                    min={track.sourceIn + 0.05}
                    max={max}
                    step="0.05"
                    value={track.sourceOut ?? max}
                    onChange={(event) => {
                      const sourceOut = clamp(
                        Number(event.target.value),
                        track.sourceIn + 0.05,
                        max
                      );
                      patchAudio(track.id, { sourceOut, fadeIn: 0, fadeOut: 0 });
                    }}
                  />
                </label>
                <label>
                  {t('slideshow.volume')}
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={track.volume}
                    onChange={(event) =>
                      patchAudio(track.id, { volume: clamp(Number(event.target.value), 0, 2) })
                    }
                  />
                </label>
                <label>
                  {t('slideshow.fadeIn')}
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, effective - track.fadeOut)}
                    step="0.05"
                    value={track.fadeIn}
                    onChange={(event) =>
                      patchAudio(track.id, {
                        fadeIn: clamp(Number(event.target.value), 0, effective - track.fadeOut),
                      })
                    }
                  />
                </label>
                <label>
                  {t('slideshow.fadeOut')}
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, effective - track.fadeIn)}
                    step="0.05"
                    value={track.fadeOut}
                    onChange={(event) =>
                      patchAudio(track.id, {
                        fadeOut: clamp(Number(event.target.value), 0, effective - track.fadeIn),
                      })
                    }
                  />
                </label>
                <label className="creative-check">
                  <input
                    type="checkbox"
                    checked={track.loop}
                    onChange={(event) => patchAudio(track.id, { loop: event.target.checked })}
                  />
                  {t('slideshow.loop')}
                </label>
                {track.kind === 'music' && (
                  <>
                    <label className="creative-check">
                      <input
                        type="checkbox"
                        checked={track.duckingEnabled}
                        onChange={(event) =>
                          patchAudio(track.id, { duckingEnabled: event.target.checked })
                        }
                      />
                      {l('Duck under voice-over', 'خفض تحت التعليق الصوتي')}
                    </label>
                    <label>
                      {l('Duck gain', 'مستوى الخفض')}
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.01"
                        value={track.duckingGain}
                        onChange={(event) =>
                          patchAudio(track.id, {
                            duckingGain: clamp(Number(event.target.value), 0.05, 1),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  aria-label={l('Remove audio track', 'حذف المسار الصوتي')}
                  onClick={() =>
                    commit({
                      ...project,
                      audioTracks: project.audioTracks.filter((entry) => entry.id !== track.id),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </NeonPanel>
            );
          })
        )}
      </div>

      {project.watermark && (
        <NeonPanel variant="dark" padding="md" className="slideshow-watermark-editor">
          <div>
            <h2>{l('Watermark', 'العلامة المائية')}</h2>
            <code dir="ltr">{project.watermark.sourcePath}</code>
          </div>
          <label>
            {l('Position', 'الموضع')}
            <NeonSelect
              value={project.watermark.position}
              onChange={(val) =>
                commit({
                  ...project,
                  watermark: {
                    ...project.watermark!,
                    position: val as SlideshowProject['watermark'] extends infer _T
                      ? 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
                      : never,
                  },
                })
              }
              options={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].map(
                (entry) => ({ value: entry, label: entry }),
              )}
              label={l('Position', 'الموضع')}
            />
          </label>
          <label>
            {l('Scale', 'الحجم')}
            <input
              type="range"
              min="0.02"
              max="1"
              step="0.01"
              value={project.watermark.scale}
              onChange={(event) =>
                commit({
                  ...project,
                  watermark: {
                    ...project.watermark!,
                    scale: clamp(Number(event.target.value), 0.02, 1),
                  },
                })
              }
            />
          </label>
          <label>
            {l('Opacity', 'الشفافية')}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={project.watermark.opacity}
              onChange={(event) =>
                commit({
                  ...project,
                  watermark: {
                    ...project.watermark!,
                    opacity: clamp(Number(event.target.value), 0, 1),
                  },
                })
              }
            />
          </label>
          <NeonButton
            variant="danger"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            onClick={() => commit({ ...project, watermark: null })}
          >
            {l('Remove', 'إزالة')}
          </NeonButton>
        </NeonPanel>
      )}

      <NeonPanel variant="dark" padding="md" className="slideshow-render-panel">
        <div>
          <h2>{t('slideshow.render')}</h2>
          <p>
            {missingAssets.length > 0
              ? l(
                  `${missingAssets.length} missing assets must be relinked.`,
                  `يجب ربط ${missingAssets.length} من الوسائط المفقودة.`
                )
              : t('slideshow.renderDescription')}
          </p>
        </div>
        <NeonSelect
          value={renderFormat}
          onChange={(val) => setRenderFormat(val as SlideshowRenderFormat)}
          options={renderFormats.map((entry) => ({ value: entry, label: entry.toUpperCase() }))}
        />
        <NeonButton
          variant="primary"
          leftIcon={<Film size={16} />}
          onClick={() => void startRender()}
          disabled={!desktopRuntime || project.slides.length === 0 || missingAssets.length > 0}
          data-disabled-reason={
            missingAssets.length > 0
              ? l('Relink missing media first.', 'اربط الوسائط المفقودة أولًا.')
              : undefined
          }
        >
          {t('slideshow.startRender')}
        </NeonButton>
      </NeonPanel>
      <div className="slideshow-render-history">
        <div className="creative-section-heading">
          <h2>{l('Render queue and history', 'قائمة وسجل الرندر')}</h2>
          <span>{renderJobs.length}</span>
        </div>
        {renderJobs.length === 0 ? (
          <div className="creative-empty">{l('No render jobs yet.', 'لا توجد مهام رندر.')}</div>
        ) : (
          renderJobs.map((job) => (
            <NeonPanel key={job.id} variant="dark" padding="sm" className="slideshow-render-job">
              <div>
                <strong>{l(job.status, job.status)}</strong>
                <span>{job.percentage.toFixed(1)}%</span>
                <small dir="ltr">{job.outputPath ? basename(job.outputPath) : job.id}</small>
              </div>
              <progress max="100" value={job.percentage} />
              {job.error && <span className="creative-error">{job.error}</span>}
              {job.validation && (
                <code dir="ltr">
                  {job.validation.width}×{job.validation.height} · {job.validation.fps} ·{' '}
                  {job.validation.sha256}
                </code>
              )}
              {['queued', 'preparing', 'rendering', 'validating'].includes(job.status) && (
                <NeonButton
                  variant="danger"
                  size="sm"
                  leftIcon={<Square size={14} />}
                  onClick={() => void window.knouxSlideshowAPI.cancelRender(job.id)}
                >
                  {t('common.cancel')}
                </NeonButton>
              )}
              {job.status === 'completed' && (
                <>
                  <NeonButton
                    variant="secondary"
                    size="sm"
                    leftIcon={<Play size={14} />}
                    disabled={slideshowOutputActionState(job.outputExists).disabled}
                    title={job.outputExists === false ? l('Output file is missing.', 'ملف الناتج مفقود.') : undefined}
                    data-disabled-reason={slideshowOutputActionState(job.outputExists).disabledReason}
                    onClick={() => void activateCompletedOutput(job.id, 'open')}
                  >
                    {l('Open Output', 'فتح الناتج')}
                  </NeonButton>
                  <NeonButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<ExternalLink size={14} />}
                    disabled={slideshowOutputActionState(job.outputExists).disabled}
                    title={job.outputExists === false ? l('Output file is missing.', 'ملف الناتج مفقود.') : undefined}
                    data-disabled-reason={slideshowOutputActionState(job.outputExists).disabledReason}
                    onClick={() => void activateCompletedOutput(job.id, 'reveal')}
                  >
                    {l('Reveal', 'إظهار في المجلد')}
                  </NeonButton>
                </>
              )}
            </NeonPanel>
          ))
        )}
      </div>
    </section>
  );
};
