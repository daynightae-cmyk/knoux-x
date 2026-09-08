import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Copy,
  ImagePlus,
  Music,
  Pause,
  Play,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';

import { NeonSelect } from '../../components/neon/NeonSelect';
import {
  addAudioTrack,
  constrainSlideTransitions,
  createSlideshowSlide,
  duplicateSlide,
  reorderSlide,
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
  type KenBurnsMode,
  type SlideshowAudioTrack,
  type SlideshowProject,
  type SlideshowSlide,
  type SlideshowTransition,
} from '../../core/creative/slideshowProject';

interface MobileOpenResult {
  project: SlideshowProject;
  filePath?: string;
}

export interface MobileSlideshowEditorHandle {
  save(): Promise<boolean>;
  renderMp4(): Promise<boolean>;
}

interface HistoryState {
  past: SlideshowProject[];
  future: SlideshowProject[];
}

const audioExtensions = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']);
const transitions: SlideshowTransition[] = ['none', 'crossfade', 'fade-black', 'wipe', 'slide', 'zoom', 'blur'];
const motions: KenBurnsMode[] = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function extension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function readMediaDuration(mediaUrl: string, kind: 'video' | 'audio'): Promise<number> {
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

function normalizeOpened(value: unknown): MobileOpenResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const project = record.project;
  if (!project || typeof project !== 'object') return null;
  return {
    project: project as SlideshowProject,
    filePath: typeof record.filePath === 'string' ? record.filePath : undefined,
  };
}

function clip(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

export const MobileSlideshowEditor = forwardRef<MobileSlideshowEditorHandle>((_, ref) => {
  const [project, setProject] = useState<SlideshowProject | null>(null);
  const projectRef = useRef<SlideshowProject | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const historyRef = useRef<HistoryState>({ past: [], future: [] });

  useEffect(() => { projectRef.current = project; }, [project]);

  const duration = useMemo(() => project ? slideshowDuration(project) : 0, [project]);
  const ranges = useMemo(() => project ? slideTimelineRanges(project.slides) : [], [project]);
  const selectedSlide = useMemo(
    () => project?.slides.find((slide) => slide.id === selectedSlideId) ?? null,
    [project, selectedSlideId],
  );
  const selectedIndex = project?.slides.findIndex((slide) => slide.id === selectedSlideId) ?? -1;
  const activeSlide = useMemo(() => {
    if (!project || project.slides.length === 0) return null;
    const index = ranges.findIndex((range) => previewTime >= range.start && previewTime < range.end);
    return project.slides[index < 0 ? Math.max(0, project.slides.length - 1) : index] ?? null;
  }, [previewTime, project, ranges]);

  const refreshRecent = useCallback(async (): Promise<void> => {
    try {
      setRecent(await window.knouxSlideshowAPI.recent());
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => { void refreshRecent(); }, [refreshRecent]);

  const activate = useCallback((next: SlideshowProject, filePath?: string, unsaved = false): void => {
    historyRef.current = { past: [], future: [] };
    setProject(structuredClone(next));
    setProjectPath(filePath);
    setSelectedSlideId(next.slides[0]?.id ?? null);
    setPreviewTime(0);
    setPlaying(false);
    setDirty(unsaved);
    setError(null);
    setNotice(null);
  }, []);

  const commit = useCallback((next: SlideshowProject): void => {
    const current = projectRef.current;
    if (current) {
      historyRef.current.past.push(structuredClone(current));
      if (historyRef.current.past.length > 60) historyRef.current.past.shift();
    }
    historyRef.current.future = [];
    const normalized = {
      ...structuredClone(next),
      slides: constrainSlideTransitions(next.slides),
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = normalized;
    setProject(normalized);
    setDirty(true);
  }, []);

  const undo = useCallback((): void => {
    const current = projectRef.current;
    const previous = historyRef.current.past.pop();
    if (!current || !previous) return;
    historyRef.current.future.push(structuredClone(current));
    projectRef.current = structuredClone(previous);
    setProject(structuredClone(previous));
    setSelectedSlideId(previous.slides[0]?.id ?? null);
    setDirty(true);
  }, []);

  const redo = useCallback((): void => {
    const current = projectRef.current;
    const next = historyRef.current.future.pop();
    if (!current || !next) return;
    historyRef.current.past.push(structuredClone(current));
    projectRef.current = structuredClone(next);
    setProject(structuredClone(next));
    setSelectedSlideId(next.slides[0]?.id ?? null);
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!project || !dirty) return undefined;
    const timer = window.setTimeout(() => {
      void window.knouxSlideshowAPI.autosave(structuredClone(project)).catch(() => undefined);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [dirty, project]);

  useEffect(() => {
    if (!playing || duration <= 0) return undefined;
    const start = performance.now() - previewTime * 1_000;
    const timer = window.setInterval(() => {
      const next = (performance.now() - start) / 1_000;
      if (next >= duration) {
        setPreviewTime(duration);
        setPlaying(false);
      } else setPreviewTime(next);
    }, 50);
    return () => window.clearInterval(timer);
  }, [duration, playing, previewTime]);

  useEffect(() => {
    let active = true;
    setActiveMediaUrl(null);
    if (!activeSlide?.sourcePath) return () => { active = false; };
    void window.knouxCreativeAPI.media.toUrl(activeSlide.sourcePath)
      .then((url) => { if (active) setActiveMediaUrl(url); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Preview media could not be opened.');
      });
    return () => { active = false; };
  }, [activeSlide?.sourcePath]);

  const createProject = useCallback(async (): Promise<void> => {
    if (busy) return;
    const name = window.prompt('Project name', 'Knoux X Mobile Slideshow')?.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      activate(await window.knouxSlideshowAPI.create(name, 'minimal'), undefined, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Slideshow could not be created.');
    } finally {
      setBusy(false);
    }
  }, [activate, busy]);

  const openProject = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const opened = normalizeOpened(await window.knouxSlideshowAPI.open());
      if (opened) activate(opened.project, opened.filePath);
      await refreshRecent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Slideshow could not be opened.');
    } finally {
      setBusy(false);
    }
  }, [activate, busy, refreshRecent]);

  const openRecent = useCallback(async (filePath: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const opened = normalizeOpened(await window.knouxSlideshowAPI.openRecent(filePath));
      if (!opened) throw new Error('Recent slideshow payload is invalid.');
      activate(opened.project, opened.filePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recent slideshow could not be opened.');
    } finally {
      setBusy(false);
    }
  }, [activate, busy]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = projectRef.current;
    if (!current || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await window.knouxSlideshowAPI.save(structuredClone(current), projectPath);
      if (!saved) throw new Error('Slideshow save failed.');
      setProjectPath(saved);
      setDirty(false);
      await refreshRecent();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Slideshow save failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, projectPath, refreshRecent]);

  const renderMp4 = useCallback(async (): Promise<boolean> => {
    const current = projectRef.current;
    if (!current || busy || current.slides.length === 0) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const queued = await window.knouxSlideshowAPI.render(structuredClone(current), 'mp4');
      if (!queued) {
        setError('MP4 slideshow rendering is not implemented on this Android runtime yet. Your project remains saved and editable.');
        return false;
      }
      setNotice('MP4 render queued successfully.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MP4 render could not be queued.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useImperativeHandle(ref, () => ({ save, renderMp4 }), [renderMp4, save]);

  const importSlides = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.knouxSlideshowAPI.importFiles();
      const known = new Set(current.slides.map((slide) => slide.sourcePath.toLocaleLowerCase()));
      const additions: SlideshowSlide[] = [];
      for (const asset of result.assets) {
        if (known.has(asset.filePath.toLocaleLowerCase())) continue;
        if (asset.family !== 'image' && asset.family !== 'video') continue;
        const sourceDuration = asset.family === 'video'
          ? (asset.duration ?? await readMediaDuration(asset.mediaUrl, 'video'))
          : null;
        additions.push(createSlideshowSlide({
          id: crypto.randomUUID(),
          sourcePath: asset.filePath,
          kind: asset.family,
          title: basename(asset.filePath),
          duration: asset.family === 'video' ? sourceDuration! : current.defaultImageDuration,
          sourceDuration,
          transition: current.defaultTransition,
          transitionDuration: current.defaultTransitionDuration,
        }));
      }
      if (additions.length > 0) {
        commit({ ...current, slides: [...current.slides, ...additions] });
        setSelectedSlideId(additions.at(-1)?.id ?? null);
      }
      setNotice(`${additions.length} media item${additions.length === 1 ? '' : 's'} added.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media import failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, commit]);

  const addAudio = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (!current || busy || duration <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      if (!audioExtensions.has(extension(selected.filePath))) throw new Error('Choose a supported audio file.');
      const sourceDuration = await readMediaDuration(selected.mediaUrl, 'audio');
      const fade = Math.min(1, sourceDuration / 2);
      const track: SlideshowAudioTrack = {
        id: crypto.randomUUID(),
        sourcePath: selected.filePath,
        name: basename(selected.filePath),
        start: 0,
        sourceIn: 0,
        sourceOut: sourceDuration,
        sourceDuration,
        volume: 0.65,
        fadeIn: fade,
        fadeOut: fade,
        loop: true,
        kind: 'music',
        duckingEnabled: false,
        duckingGain: 0.25,
      };
      commit(addAudioTrack(current, track));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audio import failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, commit, duration]);

  const patchSelected = useCallback((patcher: (slide: SlideshowSlide) => SlideshowSlide): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    commit({
      ...current,
      slides: current.slides.map((slide) => slide.id === selectedSlideId ? patcher(structuredClone(slide)) : slide),
    });
  }, [commit, selectedSlideId]);

  const moveSelected = useCallback((direction: -1 | 1): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    const index = current.slides.findIndex((slide) => slide.id === selectedSlideId);
    commit({ ...current, slides: reorderSlide(current.slides, selectedSlideId, index + direction) });
  }, [commit, selectedSlideId]);

  const duplicateSelected = useCallback((): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    const id = crypto.randomUUID();
    commit({ ...current, slides: duplicateSlide(current.slides, selectedSlideId, id) });
    setSelectedSlideId(id);
  }, [commit, selectedSlideId]);

  const removeSelected = useCallback((): void => {
    const current = projectRef.current;
    if (!current || !selectedSlideId) return;
    const index = current.slides.findIndex((slide) => slide.id === selectedSlideId);
    const slides = current.slides.filter((slide) => slide.id !== selectedSlideId);
    commit({ ...current, slides });
    setSelectedSlideId(slides[Math.min(index, slides.length - 1)]?.id ?? null);
  }, [commit, selectedSlideId]);

  if (!project) {
    return (
      <div className="kms-mobile-slideshow" data-component="MobileSlideshowEditor">
        {error && <div className="kmc-inline-error" role="alert">{error}</div>}
        <div className="kms-start-card">
          <strong>Start a mobile slideshow</strong>
          <p>Create a project, then add ordinary photos or videos from your device.</p>
          <div className="kms-start-actions">
            <button type="button" onClick={() => void createProject()} disabled={busy}>New project</button>
            <button type="button" onClick={() => void openProject()} disabled={busy}>Open project</button>
          </div>
          {recent.length > 0 && (
            <div className="kms-recent-list">
              <span>Recent projects</span>
              {recent.slice(0, 5).map((filePath) => (
                <button key={filePath} type="button" onClick={() => void openRecent(filePath)}>{basename(filePath)}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kms-mobile-slideshow" data-component="MobileSlideshowEditor">
      <div className="kms-project-bar">
        <div><strong>{project.name}</strong><span>{project.slides.length} slides · {formatTime(duration)}</span></div>
        <div>
          <button type="button" aria-label="Undo" onClick={undo}><Undo2 size={17} /></button>
          <button type="button" aria-label="Redo" onClick={redo}><Redo2 size={17} /></button>
          <button type="button" aria-label="Save" onClick={() => void save()} disabled={busy}><Save size={17} /></button>
        </div>
      </div>

      {error && <div className="kmc-inline-error" role="alert">{error}</div>}
      {notice && <div className="kms-notice" role="status">{notice}</div>}

      <div className="kms-preview-card">
        <div
          className={`kms-preview-stage kms-motion-${activeSlide?.kenBurns ?? 'none'}`}
          style={(() => {
            const size = project ? slideshowOutputSize(project) : { width: 16, height: 9 };
            const ratio = size.height > 0 ? size.width / size.height : 16 / 9;
            return { aspectRatio: `${size.width}/${size.height}`, ['--knoux-slide-ar' as string]: ratio };
          })()}
        >
          {!activeSlide && <span className="kms-empty-preview">Add photos or videos to begin.</span>}
          {activeSlide?.kind === 'image' && activeMediaUrl && (
            <img src={activeMediaUrl} alt={activeSlide.title || 'Slideshow preview'} style={{ objectFit: activeSlide.fit === 'fit' ? 'contain' : 'cover' }} />
          )}
          {activeSlide?.kind === 'video' && activeMediaUrl && (
            <video src={activeMediaUrl} muted={activeSlide.muted} playsInline controls={false} />
          )}
          {(activeSlide?.kind === 'title' || activeSlide?.kind === 'end-card') && (
            <div className="kms-text-card" style={{ background: activeSlide.backgroundColor }}>
              <strong>{activeSlide.title}</strong><span>{activeSlide.caption}</span>
            </div>
          )}
        </div>
        <div className="kms-transport">
          <button type="button" onClick={() => setPlaying((value) => !value)} disabled={duration <= 0}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, duration)}
            step={0.05}
            value={clip(previewTime, 0, Math.max(0.01, duration))}
            onChange={(event) => { setPlaying(false); setPreviewTime(Number(event.target.value)); }}
          />
          <span>{formatTime(previewTime)}</span>
        </div>
      </div>

      <div className="kms-import-row">
        <button type="button" onClick={() => void importSlides()} disabled={busy}><ImagePlus size={18} /> Add media</button>
        <button type="button" onClick={() => void addAudio()} disabled={busy || duration <= 0}><Music size={18} /> Add music</button>
        <button type="button" onClick={() => void renderMp4()} disabled={busy || project.slides.length === 0}>Create MP4</button>
      </div>

      <div className="kms-strip" aria-label="Slideshow timeline">
        {project.slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            className={slide.id === selectedSlideId ? 'active' : ''}
            onClick={() => setSelectedSlideId(slide.id)}
          >
            <span>{index + 1}</span>
            <strong>{slide.title || slide.kind}</strong>
            <small>{slide.duration.toFixed(1)}s</small>
          </button>
        ))}
      </div>

      {selectedSlide && (
        <div className="kms-inspector">
          <div className="kms-inspector-head">
            <strong>Slide {selectedIndex + 1}</strong>
            <div>
              <button type="button" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0}>←</button>
              <button type="button" onClick={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= project.slides.length - 1}>→</button>
              <button type="button" onClick={duplicateSelected} aria-label="Duplicate slide"><Copy size={16} /></button>
              <button type="button" onClick={removeSelected} aria-label="Delete slide"><Trash2 size={16} /></button>
            </div>
          </div>
          <label><span>Duration</span><input type="number" min={0.1} max={86400} step={0.1} value={selectedSlide.duration} onChange={(event) => patchSelected((slide) => ({ ...slide, duration: clip(Number(event.target.value), 0.1, 86400) }))} /></label>
          <div className="kms-inspector-field"><span>Transition</span><NeonSelect aria-label="Transition" value={selectedSlide.transition} options={transitions.map((value) => ({ value, label: value }))} onChange={(value) => patchSelected((slide) => ({ ...slide, transition: value as SlideshowTransition }))} /></div>
          {selectedSlide.kind === 'image' && <div className="kms-inspector-field"><span>Motion</span><NeonSelect aria-label="Motion" value={selectedSlide.kenBurns} options={motions.map((value) => ({ value, label: value }))} onChange={(value) => patchSelected((slide) => ({ ...slide, kenBurns: value as KenBurnsMode }))} /></div>}
          <label><span>Caption</span><input value={selectedSlide.caption} onChange={(event) => patchSelected((slide) => ({ ...slide, caption: event.target.value.slice(0, 1000) }))} /></label>
        </div>
      )}
    </div>
  );
});

MobileSlideshowEditor.displayName = 'MobileSlideshowEditor';
