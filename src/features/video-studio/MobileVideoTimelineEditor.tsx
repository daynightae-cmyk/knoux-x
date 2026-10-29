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
  addTrack,
  createTimelineItem,
  createTrack,
  deleteItems,
  insertItem,
  moveItem,
  projectDuration,
  splitTimelineItem,
} from '../../core/creative/multitrackProject';
import type {
  MultitrackProject,
  TimelineItem,
  TimelineTrack,
  TrackKind,
} from '../../core/creative/multitrackProject';
import { setTimelineVideoRetouchTemporal } from '../../core/creative/videoRetouchEffect';
import {
  clipPreviewStyle,
  textClipStyle,
  resolveClipVisual,
} from '../../core/creative/timelineRenderState';
import { isAndroidRuntime } from '../../platform/runtime';
import { MobilePromptDialog } from '../../components/mobile/MobilePromptDialog';
import { useAppStore } from '../../store/appStore';
import { RECORDING_EDITOR_HANDOFF_KEY } from '../recording/recordingEditorHandoff';
import { canvasFiltersSupported } from '../export/mobileTimelineRenderer';

import { MobileClipInspector } from './MobileClipInspector';
import { VideoRetouchInspector } from './retouch/VideoRetouchInspector';
import './mobileProgramMonitor.css';
import { VideoRetouchPreviewOverlay } from './retouch/VideoRetouchPreviewOverlay';
import {
  attachRetouchAfterTrimIn,
  attachRetouchAfterTrimOut,
  attachRetouchToSplit,
} from './retouch/videoRetouchTimeline';
import type { VideoRetouchClipState } from './retouch/videoRetouchProject';
import { draggedTimelineStart } from './mobileTimelineGestures';

type SaveResult = {
  ok: boolean;
  filePath?: string;
  projectId?: string;
  error?: string;
};

interface ProjectHistory {
  past: MultitrackProject[];
  future: MultitrackProject[];
}

export interface MobileVideoTimelineEditorHandle {
  save(): Promise<SaveResult>;
  splitSelected(): void;
  trimIn(): void;
  trimOut(): void;
  undo(): void;
  redo(): void;
}

export interface MobileVideoTimelineEditorProps {
  inspectorOpen: boolean;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

const TRACK_KIND_AR: Record<TrackKind, string> = {
  video: 'فيديو',
  audio: 'صوت',
  image: 'صورة',
  text: 'نص',
  subtitle: 'ترجمة',
  overlay: 'طبقة',
};

/** Output formats the on-device encoder can actually produce. */
const PROJECT_FORMATS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: 'landscape-1080', label: '16:9 · 1080p', width: 1920, height: 1080 },
  { id: 'landscape-720', label: '16:9 · 720p', width: 1280, height: 720 },
  { id: 'portrait-1080', label: '9:16 · Reels', width: 1080, height: 1920 },
  { id: 'square-1080', label: '1:1 · Post', width: 1080, height: 1080 },
  { id: 'portrait-4-5', label: '4:5 · Feed', width: 1080, height: 1350 },
  { id: 'cinema-2k', label: '2K · 2560×1440', width: 2560, height: 1440 },
];

const ERROR_COPY_AR: Record<string, string> = {
  'Clip could not be deleted.': 'تعذّر حذف المقطع.',
  'The clip could not be moved.': 'تعذّر نقل المقطع.',
};

function readMediaMetadata(mediaUrl: string, kind: 'video' | 'audio'): Promise<number> {
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
      else reject(new Error('The selected media has no finite duration.'));
    }, { once: true });
    media.addEventListener('error', () => {
      cleanup();
      reject(new Error('The selected media metadata could not be decoded.'));
    }, { once: true });
  });
}

function compatibleTrack(project: MultitrackProject, kind: TrackKind): TimelineTrack | null {
  return project.tracks.find((track) => track.kind === kind)
    ?? (kind === 'image' ? project.tracks.find((track) => track.kind === 'video') : undefined)
    ?? null;
}

function selectedItemOf(project: MultitrackProject | null, itemId: string | null): TimelineItem | null {
  if (!project || !itemId) return null;
  return project.tracks.flatMap((track) => track.items).find((item) => item.id === itemId) ?? null;
}

export const MobileVideoTimelineEditor = forwardRef<MobileVideoTimelineEditorHandle, MobileVideoTimelineEditorProps>(
  ({ inspectorOpen }, ref) => {
    const ar = useAppStore((state) => state.locale) === 'ar';
    const [project, setProject] = useState<MultitrackProject | null>(null);
    const [projectPath, setProjectPath] = useState<string | undefined>();
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [playhead, setPlayhead] = useState(0);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recent, setRecent] = useState<string[]>([]);
    const [prompt, setPrompt] = useState<{ open: boolean; title: string; label: string; value: string; confirmLabel: string; submit: (value: string) => void } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [playing, setPlaying] = useState(false);
    const [loopPreview, setLoopPreview] = useState(false);
    const [showGuides, setShowGuides] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);
    const dragRef = useRef<{ id: string; x: number; start: number; laneWidth: number; moved: boolean } | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const canvasDragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
    const suppressClickRef = useRef(false);
    const historyRef = useRef<ProjectHistory>({ past: [], future: [] });
    const gestureRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
    const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

    const duration = useMemo(() => project ? projectDuration(project) : 0, [project]);
    const selectedItem = useMemo(() => selectedItemOf(project, selectedItemId), [project, selectedItemId]);
    /* Asked once per session: the inspector must say whether a colour grade will
     * survive the encode on this WebView instead of promising it silently. */
    const canvasFiltersAvailable = useMemo(() => canvasFiltersSupported(), []);
    const orderedTracks = useMemo(
      () => project ? [...project.tracks].sort((left, right) => left.order - right.order) : [],
      [project],
    );
    const timelineSpan = Math.max(5, duration);

    useEffect(() => {
      if (inspectorOpen) requestAnimationFrame(() => document.querySelector('.kmc-mobile-inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }, [inspectorOpen]);

    const activate = useCallback((next: MultitrackProject, filePath?: string, unsaved = false): void => {
      historyRef.current = { past: [], future: [] };
      setProject(structuredClone(next));
      setProjectPath(filePath);
      setSelectedItemId(next.tracks.flatMap((track) => track.items)[0]?.id ?? null);
      setPlayhead(0);
      setDirty(unsaved);
      setError(null);
    }, []);

    useEffect(() => {
      const path = localStorage.getItem(RECORDING_EDITOR_HANDOFF_KEY);
      if (!path) return;
      let active = true;
      void window.knouxMultitrackAPI.openRecent(path).then((opened) => {
        if (!active) return;
        activate(opened.project, opened.filePath);
        localStorage.removeItem(RECORDING_EDITOR_HANDOFF_KEY);
      }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Recording project could not be reopened.'); });
      return () => { active = false; };
    }, [activate]);

    const commit = useCallback((next: MultitrackProject): void => {
      setProject((current) => {
        if (current) {
          historyRef.current.past.push(structuredClone(current));
          if (historyRef.current.past.length > 60) historyRef.current.past.shift();
        }
        historyRef.current.future = [];
        return { ...structuredClone(next), updatedAt: new Date().toISOString() };
      });
      setDirty(true);
    }, []);

    /**
     * A slider drag fires dozens of times per second. Pushing a history entry
     * for each one would make undo useless on a phone, so consecutive edits that
     * share a gesture key inside the gesture window collapse into the single
     * entry the first change already recorded.
     */
    const commitLive = useCallback((next: MultitrackProject, gesture?: string): void => {
      const now = Date.now();
      const sameGesture = Boolean(gesture) && gestureRef.current.key === gesture && now - gestureRef.current.at < 700;
      gestureRef.current = { key: gesture ?? '', at: now };
      if (sameGesture) {
        setProject((current) => (current
          ? { ...structuredClone(next), updatedAt: new Date().toISOString() }
          : current));
        setDirty(true);
        return;
      }
      commit(next);
    }, [commit]);

    const refreshRecent = useCallback(async (): Promise<void> => {
      try {
        setRecent(await window.knouxMultitrackAPI.recent());
      } catch {
        setRecent([]);
      }
    }, []);

    useEffect(() => {
      void refreshRecent();
    }, [refreshRecent]);

    useEffect(() => {
      if (!project || !dirty) return undefined;
      const timer = window.setTimeout(() => {
        void window.knouxMultitrackAPI.autosave(structuredClone(project)).catch(() => undefined);
      }, Math.max(5, project.settings.autosaveSeconds) * 1000);
      return () => window.clearTimeout(timer);
    }, [dirty, project]);

    useEffect(() => {
      let active = true;
      setPreviewUrl(null);
      setSourceDimensions(null);
      setPlaying(false);
      const sourcePath = selectedItem?.sourcePath;
      if (!sourcePath) return () => { active = false; };
      void window.knouxCreativeAPI.media.toUrl(sourcePath)
        .then((url) => { if (active) setPreviewUrl(url); })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Preview could not be opened.');
        });
      return () => { active = false; };
    }, [selectedItem?.sourcePath]);

    useEffect(() => {
      const media = previewRef.current;
      if (!media || !selectedItem || !previewUrl || media.readyState === 0) return;
      const local = Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart));
      const sourceTime = selectedItem.sourceIn + local * selectedItem.playbackRate;
      if (Math.abs(media.currentTime - sourceTime) > 0.12) media.currentTime = sourceTime;
      media.playbackRate = Math.max(0.25, Math.min(4, selectedItem.playbackRate));
      media.volume = Math.max(0, Math.min(1, selectedItem.audio.volume));
    }, [playhead, previewUrl, selectedItem]);

    const createProjectWithName = useCallback(async (name: string): Promise<void> => {
      if (!name) return;
      setBusy(true);
      setError(null);
      try {
        activate(await window.knouxMultitrackAPI.create(name), undefined, true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Project could not be created.');
      } finally {
        setBusy(false);
      }
    }, [activate]);

    const createProject = useCallback((): void => {
      if (busy) return;
      setPrompt({
        open: true,
        title: ar ? 'اسم المشروع' : 'Project name',
        label: ar ? 'اسم المشروع' : 'Project name',
        value: 'Knoux X Mobile Project',
        confirmLabel: ar ? 'إنشاء' : 'Create',
        submit: (name) => { void createProjectWithName(name); },
      });
    }, [ar, busy, createProjectWithName]);

    const openProject = useCallback(async (): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const opened = await window.knouxMultitrackAPI.open();
        if (opened) activate(opened.project, opened.filePath, opened.migrated);
        await refreshRecent();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Project could not be opened.');
      } finally {
        setBusy(false);
      }
    }, [activate, busy, refreshRecent]);

    const openRecent = useCallback(async (filePath: string): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const opened = await window.knouxMultitrackAPI.openRecent(filePath);
        activate(opened.project, opened.filePath, opened.migrated);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Recent project could not be opened.');
      } finally {
        setBusy(false);
      }
    }, [activate, busy]);

    const save = useCallback(async (): Promise<SaveResult> => {
      if (!project) return { ok: false, error: 'Create or open a project before export.' };
      if (busy) return { ok: false, projectId: project.id, error: 'Project persistence is already in progress.' };
      setBusy(true);
      setError(null);
      const snapshot = structuredClone(project);
      try {
        const saved = await window.knouxMultitrackAPI.save(snapshot, projectPath);
        if (!saved) return { ok: false, projectId: snapshot.id, error: 'Project save failed.' };
        setProjectPath(saved);
        setDirty(false);
        await refreshRecent();
        return { ok: true, filePath: saved, projectId: snapshot.id };
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Project save failed.';
        setError(message);
        return { ok: false, projectId: snapshot.id, error: message };
      } finally {
        setBusy(false);
      }
    }, [busy, project, projectPath, refreshRecent]);

    const undo = useCallback((): void => {
      if (!project) return;
      const previous = historyRef.current.past.pop();
      if (!previous) return;
      historyRef.current.future.push(structuredClone(project));
      setProject(previous);
      setDirty(true);
    }, [project]);

    const redo = useCallback((): void => {
      if (!project) return;
      const next = historyRef.current.future.pop();
      if (!next) return;
      historyRef.current.past.push(structuredClone(project));
      setProject(next);
      setDirty(true);
    }, [project]);

    const patchSelectedItem = useCallback((patcher: (item: TimelineItem) => TimelineItem, gesture?: string): void => {
      if (!project || !selectedItem) return;
      const next: MultitrackProject = {
        ...project,
        tracks: project.tracks.map((track) => ({
          ...track,
          items: track.items.map((item) => item.id === selectedItem.id ? patcher(structuredClone(item)) : item),
        })),
      };
      if (gesture) commitLive(next, gesture);
      else commit(next);
    }, [commit, commitLive, project, selectedItem]);

    const splitSelected = useCallback((): void => {
      if (!project || !selectedItem) return;
      try {
        const splitLocalTime = playhead - selectedItem.timelineStart;
        const [rawLeft, rawRight] = splitTimelineItem(selectedItem, playhead, crypto.randomUUID());
        const [left, right] = attachRetouchToSplit(selectedItem, rawLeft, rawRight, splitLocalTime);
        commit({
          ...project,
          tracks: project.tracks.map((track) => track.id === selectedItem.trackId
            ? { ...track, items: track.items.flatMap((item) => item.id === selectedItem.id ? [left, right] : [item]) }
            : track),
        });
        setSelectedItemId(right.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Split failed. Move the playhead inside the selected clip.');
      }
    }, [commit, playhead, project, selectedItem]);

    const trimIn = useCallback((): void => {
      if (!selectedItem) return;
      const offset = playhead - selectedItem.timelineStart;
      if (offset <= 0 || offset >= selectedItem.duration) return;
      patchSelectedItem((item) => {
        const nextDuration = item.duration - offset;
        return attachRetouchAfterTrimIn({
          ...item,
          timelineStart: playhead,
          sourceIn: item.sourceIn + offset * item.playbackRate,
          duration: nextDuration,
        }, offset, nextDuration);
      });
    }, [patchSelectedItem, playhead, selectedItem]);

    const trimOut = useCallback((): void => {
      if (!selectedItem) return;
      const nextDuration = playhead - selectedItem.timelineStart;
      if (nextDuration <= 0 || nextDuration >= selectedItem.duration) return;
      patchSelectedItem((item) => attachRetouchAfterTrimOut({
        ...item,
        sourceOut: item.sourceIn + nextDuration * item.playbackRate,
        duration: nextDuration,
      }, nextDuration));
    }, [patchSelectedItem, playhead, selectedItem]);

    useImperativeHandle(ref, () => ({ save, splitSelected, trimIn, trimOut, undo, redo }), [redo, save, splitSelected, trimIn, trimOut, undo]);

    const addMedia = useCallback(async (requestedKind: 'video' | 'audio' | 'image'): Promise<void> => {
      if (!project || busy) return;
      setBusy(true);
      setError(null);
      try {
        const android = isAndroidRuntime();
        let selected: { filePath: string; mediaUrl: string } | null;
        if (android && requestedKind === 'image') {
          const imagePath = await window.knouxAPI.file.openFile({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
          });
          selected = imagePath
            ? { filePath: imagePath, mediaUrl: await window.knouxCreativeAPI.media.toUrl(imagePath) }
            : null;
        } else {
          selected = await window.knouxCreativeAPI.media.open();
        }
        if (!selected) return;
        const extension = selected.filePath.split('.').pop()?.toLowerCase() ?? '';
        const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
        const androidMime = android
          ? String((await window.knouxAPI.file.getMediaInfo(selected.filePath)).format ?? '').toLowerCase()
          : '';
        const isImage = androidMime.startsWith('image/')
          || (imageExtensions.has(extension) && (!android || !androidMime || androidMime === 'application/octet-stream'));
        let actualKind: 'video' | 'audio' | 'image';

        if (isImage) {
          if (requestedKind !== 'image') throw new Error(`Choose a ${requestedKind} file.`);
          actualKind = 'image';
        } else {
          if (requestedKind === 'image') throw new Error('Choose an image file.');
          if (android) {
            const hasVideo = androidMime.startsWith('video/');
            const hasAudio = androidMime.startsWith('audio/');
            if (requestedKind === 'video' && !hasVideo) throw new Error('Choose a video file.');
            if (requestedKind === 'audio' && !hasAudio) throw new Error('Choose an audio file.');
          } else {
            const probe = await window.knouxCreativeAPI.export.probe(selected.filePath);
            const hasVideo = probe.streams?.some((stream) => stream.codec_type === 'video') ?? false;
            const hasAudio = probe.streams?.some((stream) => stream.codec_type === 'audio') ?? false;
            if (requestedKind === 'video' && !hasVideo) throw new Error('Choose a video file.');
            if (requestedKind === 'audio' && !hasAudio) throw new Error('Choose an audio file.');
          }
          actualKind = requestedKind;
        }

        let workingProject = project;
        let track = compatibleTrack(workingProject, actualKind);
        if (!track) {
          track = createTrack(crypto.randomUUID(), actualKind, `${actualKind[0].toUpperCase()}${actualKind.slice(1)} 1`, workingProject.tracks.length);
          workingProject = addTrack(workingProject, track);
        }
        const itemDuration = actualKind === 'image' ? 5 : await readMediaMetadata(selected.mediaUrl, actualKind);
        const item = createTimelineItem({
          id: crypto.randomUUID(),
          trackId: track.id,
          kind: actualKind,
          name: basename(selected.filePath),
          sourcePath: selected.filePath,
          timelineStart: playhead,
          duration: itemDuration,
          sourceIn: 0,
          sourceOut: itemDuration,
        });
        commit(insertItem(workingProject, item));
        setSelectedItemId(item.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Media could not be added.');
      } finally {
        setBusy(false);
      }
    }, [busy, commit, playhead, project]);

    const addTextWithValue = useCallback((value: string, kind: 'text' | 'subtitle' = 'text'): void => {
      if (!project || !value) return;
      let workingProject = project;
      let track = compatibleTrack(workingProject, kind);
      if (!track) {
        track = createTrack(crypto.randomUUID(), kind, kind === 'subtitle' ? 'Subtitles' : 'Titles', workingProject.tracks.length);
        workingProject = addTrack(workingProject, track);
      }
      const item = createTimelineItem({
        id: crypto.randomUUID(),
        trackId: track.id,
        kind,
        name: value.slice(0, 80),
        timelineStart: playhead,
        duration: 5,
      });
      if (item.text) {
        item.text.text = value;
        /* Arabic captions default to RTL so the first render is already right. */
        if (kind === 'subtitle') item.text.direction = 'auto';
      }
      commit(insertItem(workingProject, item));
      setSelectedItemId(item.id);
    }, [commit, playhead, project]);

    const addText = useCallback((): void => {
      if (!project) return;
      setPrompt({
        open: true,
        title: ar ? 'نص العنوان' : 'Title text',
        label: ar ? 'نص العنوان' : 'Title text',
        value: 'Knoux X',
        confirmLabel: ar ? 'إضافة' : 'Add',
        submit: (value) => { addTextWithValue(value, 'text'); },
      });
    }, [addTextWithValue, ar, project]);

    const addSubtitle = useCallback((): void => {
      if (!project) return;
      setPrompt({
        open: true,
        title: ar ? 'نص الترجمة' : 'Subtitle text',
        label: ar ? 'نص الترجمة' : 'Subtitle text',
        value: ar ? 'ترجمة' : 'Subtitle',
        confirmLabel: ar ? 'إضافة' : 'Add',
        submit: (value) => { addTextWithValue(value, 'subtitle'); },
      });
    }, [addTextWithValue, ar, project]);

    const deleteSelected = useCallback((): void => {
      if (!project || !selectedItem) return;
      try {
        commit(deleteItems(project, [selectedItem.id]));
        setSelectedItemId(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Clip could not be deleted.');
      }
    }, [commit, project, selectedItem]);

    const updateRetouch = useCallback((state: VideoRetouchClipState): void => {
      if (!project || !selectedItem) return;
      commit(setTimelineVideoRetouchTemporal(project, selectedItem.id, state));
    }, [commit, project, selectedItem]);

    /* ------------------------------------------------------------------
     * Program monitor: the stage is the project aspect, the clip is placed with
     * the shared render-state maths, so what the phone draws is what the encoder
     * writes. No second copy of that geometry lives in this file.
     * ------------------------------------------------------------------ */

    useEffect(() => {
      const node = stageRef.current;
      if (!node) return undefined;
      const measure = (): void => setStageSize({ width: node.clientWidth, height: node.clientHeight });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, [project?.id]);

    const stageFit = useMemo(() => {
      const ratio = project ? project.settings.width / Math.max(1, project.settings.height) : 16 / 9;
      const availableWidth = stageSize.width || 320;
      const availableHeight = stageSize.height || Math.round(availableWidth / ratio);
      return ratio >= availableWidth / Math.max(1, availableHeight)
        ? { width: availableWidth, height: Math.max(1, Math.round(availableWidth / ratio)) }
        : { width: Math.max(1, Math.round(availableHeight * ratio)), height: availableHeight };
    }, [project, stageSize.height, stageSize.width]);

    const selectedItemTrack = useMemo(() => (project && selectedItem
      ? project.tracks.find((track) => track.id === selectedItem.trackId) ?? null
      : null), [project, selectedItem]);

    /** Neighbours on the same lane, which bound how long a transition can be. */
    const neighbourDuration = useMemo(() => {
      if (!project || !selectedItem || !selectedItemTrack) return { before: null, after: null };
      const sorted = [...selectedItemTrack.items].sort((left, right) => left.timelineStart - right.timelineStart);
      const index = sorted.findIndex((entry) => entry.id === selectedItem.id);
      return {
        before: index > 0 ? sorted[index - 1].duration : null,
        after: index >= 0 && index < sorted.length - 1 ? sorted[index + 1].duration : null,
      };
    }, [project, selectedItem, selectedItemTrack]);

    const monitorVisual = useMemo(
      () => (selectedItem ? resolveClipVisual(selectedItem, Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart))) : null),
      [playhead, selectedItem],
    );

    const monitorStyle = useMemo(() => {
      if (!selectedItem || !monitorVisual || !sourceDimensions || !project) return undefined;
      const positionScale = stageFit.width / Math.max(1, project.settings.width);
      return clipPreviewStyle({
        stageWidth: stageFit.width,
        stageHeight: stageFit.height,
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
        visual: monitorVisual,
        positionScale,
      });
    }, [monitorVisual, project, selectedItem, sourceDimensions, stageFit.height, stageFit.width]);

    const monitorTextBox = useMemo(() => {
      if (!selectedItem || !monitorVisual || !project) return null;
      const stageScale = stageFit.width / Math.max(1, project.settings.width);
      return { stageScale, visual: monitorVisual, text: selectedItem.text };
    }, [monitorVisual, project, selectedItem, stageFit.width]);

    /* Dragging the picture moves the clip, in output pixels like the exporter. */
    const beginCanvasDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
      if (!selectedItem || !project || selectedItem.kind === 'audio') return;
      if (!event.isPrimary) return;
      const positionScale = stageFit.width / Math.max(1, project.settings.width) || 1;
      canvasDragRef.current = {
        x: event.clientX,
        y: event.clientY,
        originX: selectedItem.transform.positionX,
        originY: selectedItem.transform.positionY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      const move = (moveEvent: PointerEvent): void => {
        const origin = canvasDragRef.current;
        if (!origin) return;
        const deltaX = Math.round((moveEvent.clientX - origin.x) / positionScale);
        const deltaY = Math.round((moveEvent.clientY - origin.y) / positionScale);
        const limit = Math.max(project.settings.width, project.settings.height);
        patchSelectedItem((item) => ({
          ...item,
          transform: {
            ...item.transform,
            positionX: Math.max(-limit, Math.min(limit, origin.originX + deltaX)),
            positionY: Math.max(-limit, Math.min(limit, origin.originY + deltaY)),
          },
        }), 'canvas-drag');
      };
      const finish = (): void => {
        canvasDragRef.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    }, [patchSelectedItem, project, selectedItem, stageFit.width]);

    const togglePlayback = useCallback((): void => {
      const media = previewRef.current;
      if (!media) return;
      if (playing) {
        media.pause();
        setPlaying(false);
        return;
      }
      void media.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }, [playing]);

    const stepFrame = useCallback((direction: -1 | 1): void => {
      if (!project || !selectedItem) return;
      const frame = 1 / Math.max(1, project.settings.fps);
      setPlayhead((current) => Math.max(selectedItem.timelineStart, Math.min(selectedItem.timelineStart + selectedItem.duration, current + direction * frame)));
    }, [project, selectedItem]);

    const jumpClipEdge = useCallback((edge: 'start' | 'end'): void => {
      if (!project || !selectedItem) return;
      const lane = selectedItemTrack ? [...selectedItemTrack.items].sort((left, right) => left.timelineStart - right.timelineStart) : [];
      const index = lane.findIndex((entry) => entry.id === selectedItem.id);
      if (edge === 'start') {
        setPlayhead(selectedItem.timelineStart);
        if (previewRef.current) previewRef.current.currentTime = selectedItem.sourceIn;
        return;
      }
      const next = index >= 0 && index + 1 < lane.length ? lane[index + 1] : null;
      setPlayhead(next ? next.timelineStart : selectedItem.timelineStart + selectedItem.duration);
    }, [previewRef, project, selectedItem, selectedItemTrack]);

    const duplicateSelected = useCallback((): void => {
      if (!project || !selectedItem || !selectedItemTrack) return;
      const copy = structuredClone(selectedItem);
      copy.id = crypto.randomUUID();
      copy.trackId = selectedItemTrack.id;
      copy.timelineStart = selectedItem.timelineStart + selectedItem.duration;
      copy.name = `${selectedItem.name} copy`.slice(0, 240);
      copy.keyframes = copy.keyframes.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() }));
      commit(insertItem(project, copy));
      setSelectedItemId(copy.id);
    }, [commit, project, selectedItem, selectedItemTrack]);

    const patchTrack = useCallback((trackId: string, patcher: (track: TimelineTrack) => TimelineTrack): void => {
      if (!project) return;
      commit({ ...project, tracks: project.tracks.map((track) => (track.id === trackId ? patcher(structuredClone(track)) : track)) });
    }, [commit, project]);

    const patchSettings = useCallback((patcher: (settings: MultitrackProject['settings']) => MultitrackProject['settings']): void => {
      if (!project) return;
      commit({ ...project, settings: patcher(structuredClone(project.settings)) });
    }, [commit, project]);

    const updatePlayheadFromMedia = useCallback((): void => {
      const media = previewRef.current;
      if (!media || !selectedItem) return;
      const local = Math.max(0, (media.currentTime - selectedItem.sourceIn) / Math.max(0.25, selectedItem.playbackRate));
      setPlayhead(Math.max(selectedItem.timelineStart, Math.min(selectedItem.timelineStart + selectedItem.duration, selectedItem.timelineStart + local)));
    }, [selectedItem]);

    const promptDialog = (
      <MobilePromptDialog
        open={Boolean(prompt?.open)}
        title={prompt?.title ?? ''}
        label={prompt?.label ?? ''}
        defaultValue={prompt?.value ?? ''}
        confirmLabel={prompt?.confirmLabel ?? (ar ? 'إضافة' : 'Add')}
        cancelLabel={ar ? 'إلغاء' : 'Cancel'}
        onConfirm={(value) => {
          const submit = prompt?.submit;
          setPrompt(null);
          submit?.(value);
        }}
        onCancel={() => setPrompt(null)}
      />
    );

    if (!project) {
      return (
        <section className="kmc-mobile-timeline kmc-mobile-timeline--empty" data-component="MobileVideoTimelineEditor">
          <div className="kmc-mobile-start-card">
            <strong>{ar ? 'قصّتك القادمة' : 'Your next great story'}</strong>
            <span>{ar ? 'كل قصة كبيرة تبدأ بقصّة أولى. أنشئ مشروعًا أو عُد إلى مشروع حفظته.' : 'Every great story starts with a first cut. Create a project or return to one you have saved.'}</span>
            <div className="kmc-mobile-start-actions">
              <button type="button" onClick={createProject} disabled={busy}>{ar ? 'مشروع جديد' : 'New project'}</button>
              <button type="button" onClick={() => void openProject()} disabled={busy}>{ar ? 'فتح مشروع' : 'Open project'}</button>
            </div>
            {recent.slice(0, 4).map((entry) => (
              <button key={entry} type="button" className="kmc-mobile-recent" onClick={() => void openRecent(entry)} disabled={busy}>
                <bdi>{basename(entry)}</bdi>
              </button>
            ))}
            {error && <p className="kmc-mobile-video-error" role="alert">{ar ? ERROR_COPY_AR[error] ?? error : error}</p>}
          </div>
          {promptDialog}
        </section>
      );
    }

    return (
      <section className="kmc-mobile-timeline" data-component="MobileVideoTimelineEditor" data-dirty={dirty ? 'true' : 'false'} dir={ar ? 'rtl' : 'ltr'}>
        <div className="kmc-mobile-projectbar">
          <div className="kmc-mobile-project-name">
            <strong><bdi>{project.name}</bdi></strong>
            <span>{dirty ? (ar ? 'تغييرات غير محفوظة' : 'Unsaved changes') : projectPath ? (ar ? 'محفوظ' : 'Saved') : (ar ? 'مشروع محلي' : 'Local project')} · <bdi>{formatTime(duration)}</bdi> · <bdi>{project.settings.width}×{project.settings.height}</bdi></span>
          </div>
          <div className="kmc-mobile-project-actions">
            <button type="button" onClick={undo} disabled={historyRef.current.past.length === 0} aria-label={ar ? 'تراجع' : 'Undo'}>{ar ? 'تراجع' : 'Undo'}</button>
            <button type="button" onClick={redo} disabled={historyRef.current.future.length === 0} aria-label={ar ? 'إعادة' : 'Redo'}>{ar ? 'إعادة' : 'Redo'}</button>
            <button type="button" className="is-quiet" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label={ar ? 'إعدادات المشروع' : 'Project settings'}>{ar ? 'الصيغة' : 'Format'}</button>
            <button type="button" onClick={() => void save()} disabled={busy} aria-label={ar ? 'حفظ' : 'Save'}>{ar ? 'حفظ' : 'Save'}</button>
          </div>
        </div>

        {settingsOpen && (
          <div className="kmc-mobile-formats" role="group" aria-label={ar ? 'إعدادات المشروع' : 'Project settings'}>
            <div className="kmc-mobile-format-chips">
              {PROJECT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  className="kmc-mobile-format"
                  data-active={project.settings.width === format.width && project.settings.height === format.height ? 'true' : 'false'}
                  onClick={() => patchSettings((settings) => ({ ...settings, width: format.width, height: format.height }))}
                >
                  <strong><bdi>{format.label}</bdi></strong>
                  <small><bdi>{format.width}×{format.height}</bdi></small>
                </button>
              ))}
            </div>
            <label className="kmc-mobile-format-field">
              {ar ? 'معدل الإطارات' : 'Frame rate'}
              <select
                value={project.settings.fps}
                onChange={(event) => patchSettings((settings) => ({ ...settings, fps: Number(event.target.value) }))}
              >
                {[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps}</option>)}
              </select>
            </label>
            <label className="kmc-mobile-format-field">
              {ar ? 'جذب المقاطع' : 'Snap'}
              <input type="checkbox" checked={project.settings.snapEnabled} onChange={(event) => patchSettings((settings) => ({ ...settings, snapEnabled: event.target.checked }))} />
            </label>
          </div>
        )}

        <div className="kmc-mobile-media-row" aria-label={ar ? 'إضافة وسائط' : 'Add media'}>
          <button type="button" onClick={() => void addMedia('video')} disabled={busy}>{ar ? '+ فيديو' : '+ Video'}</button>
          <button type="button" onClick={() => void addMedia('audio')} disabled={busy}>{ar ? '+ صوت' : '+ Audio'}</button>
          <button type="button" onClick={() => void addMedia('image')} disabled={busy}>{ar ? '+ صورة' : '+ Photo'}</button>
          <button type="button" onClick={addText} disabled={busy}>{ar ? '+ نص' : '+ Text'}</button>
          <button type="button" onClick={addSubtitle} disabled={busy}>{ar ? '+ ترجمة' : '+ Subtitle'}</button>
          <button type="button" onClick={duplicateSelected} disabled={!selectedItem || busy}>{ar ? 'نسخ' : 'Duplicate'}</button>
          <button type="button" className="is-danger" onClick={deleteSelected} disabled={!selectedItem || busy}>{ar ? 'حذف' : 'Delete'}</button>
        </div>

        <div className="kmc-mobile-monitor" data-kind={selectedItem?.kind ?? 'none'}>
          <div
            ref={stageRef}
            className="kmc-mobile-stage"
            style={{ aspectRatio: `${project.settings.width} / ${project.settings.height}` }}
            onPointerDown={beginCanvasDrag}
          >
            <div className="kmc-mobile-frame" style={{ width: stageFit.width, height: stageFit.height }}>
              {selectedItem && previewUrl && selectedItem.kind === 'video' && (
                <video
                  ref={(node) => { previewRef.current = node; }}
                  className="kmc-mobile-layer"
                  src={previewUrl}
                  playsInline
                  style={monitorStyle}
                  onLoadedMetadata={(event) => setSourceDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
                  onTimeUpdate={updatePlayheadFromMedia}
                  onEnded={() => { if (loopPreview) { void previewRef.current?.play(); return; } setPlaying(false); }}
                />
              )}
              {selectedItem && previewUrl && selectedItem.kind === 'image' && (
                <img
                  className="kmc-mobile-layer"
                  src={previewUrl}
                  alt={selectedItem.name}
                  style={monitorStyle}
                  onLoad={(event) => setSourceDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                />
              )}
              {monitorTextBox?.text && (
                <div className="kmc-mobile-text-layer" dir={monitorTextBox.text.direction} style={textClipStyle({ visual: monitorTextBox.visual, text: monitorTextBox.text, stageScale: monitorTextBox.stageScale })}>
                  {monitorTextBox.text.text}
                </div>
              )}
              {selectedItem && previewUrl && selectedItem.kind === 'audio' && (
                <audio
                  ref={(node) => { previewRef.current = node; }}
                  src={previewUrl}
                  className="kmc-mobile-audio"
                  onTimeUpdate={updatePlayheadFromMedia}
                  onEnded={() => { if (loopPreview) { void previewRef.current?.play(); return; } setPlaying(false); }}
                />
              )}
              {showGuides && <div className="kmc-mobile-guides" aria-hidden="true"><i /><i /><i /><i /></div>}
              {!selectedItem && <div className="kmc-mobile-preview-empty">{ar ? 'اختر مقطعًا أو أضف وسائط.' : 'Select a clip or add media.'}</div>}
              {selectedItem?.kind === 'video' && (
                <VideoRetouchPreviewOverlay item={selectedItem} mediaRef={previewRef} playhead={playhead} />
              )}
            </div>
          </div>

          <div className="kmc-mobile-transport" role="toolbar" aria-label={ar ? 'أدوات التشغيل' : 'Playback'}>
            <button type="button" onClick={() => jumpClipEdge('start')} disabled={!selectedItem} aria-label={ar ? 'انتقل إلى بداية المقطع' : 'Jump to clip start'}>⇤</button>
            <button type="button" onClick={() => stepFrame(-1)} disabled={!selectedItem} aria-label={ar ? 'إطار للخلف' : 'Back one frame'}>«</button>
            <button type="button" className="is-play" onClick={togglePlayback} disabled={!previewUrl} aria-label={playing ? (ar ? 'إيقاف مؤقت' : 'Pause') : (ar ? 'تشغيل' : 'Play')}>{playing ? '❚❚' : '▶'}</button>
            <button type="button" onClick={() => stepFrame(1)} disabled={!selectedItem} aria-label={ar ? 'إطار للأمام' : 'Forward one frame'}>»</button>
            <button type="button" onClick={() => jumpClipEdge('end')} disabled={!selectedItem} aria-label={ar ? 'انتقل إلى نهاية المقطع' : 'Jump to clip end'}>⇥</button>
            <button type="button" className={loopPreview ? 'is-on' : ''} onClick={() => setLoopPreview((value) => !value)} aria-pressed={loopPreview} aria-label={ar ? 'تكرار' : 'Loop'}>⟲</button>
            <button type="button" className={showGuides ? 'is-on' : ''} onClick={() => setShowGuides((value) => !value)} aria-pressed={showGuides} aria-label={ar ? 'أدلة الأمان' : 'Safe guides'}>▦</button>
            <span className="kmc-mobile-timecode"><bdi>{formatTime(playhead)}</bdi></span>
          </div>
        </div>

        <div className="kmc-mobile-playhead">
          <span><bdi>{formatTime(playhead)}</bdi></span>
          <input
            type="range"
            min={0}
            max={timelineSpan}
            step={0.01}
            value={Math.min(playhead, timelineSpan)}
            onChange={(event) => setPlayhead(Number(event.target.value))}
            aria-label={ar ? 'مؤشر المخطط الزمني' : 'Timeline playhead'}
          />
          <span><bdi>{formatTime(duration)}</bdi></span>
        </div>

        <div className="kmc-mobile-timeline-scroll" aria-label={ar ? 'المخطط الزمني متعدد المسارات' : 'Mobile multitrack timeline'}>
          <div className="kmc-mobile-ruler" />
          {orderedTracks.map((track) => (
            <div key={track.id} className="kmc-mobile-track" data-kind={track.kind} style={{ gridTemplateColumns: `72px minmax(${420 * zoom}px, 1fr)` }}>
              <div className="kmc-mobile-track-label">
                <strong><bdi>{track.name}</bdi></strong>
                <span>{ar ? TRACK_KIND_AR[track.kind] : track.kind}</span>
                <div className="kmc-mobile-track-tools" role="group" aria-label={ar ? 'أدوات المسار' : 'Track controls'}>
                  <button
                    type="button"
                    className={track.locked ? 'is-on' : ''}
                    aria-pressed={track.locked}
                    aria-label={ar ? 'قفل المسار' : 'Lock track'}
                    title={ar ? 'قفل' : 'Lock'}
                    onClick={() => patchTrack(track.id, (entry) => ({ ...entry, locked: !entry.locked }))}
                  >🔒</button>
                  <button
                    type="button"
                    className={track.hidden ? 'is-off' : ''}
                    aria-pressed={!track.hidden}
                    aria-label={ar ? 'إظهار المسار' : 'Show track'}
                    title={ar ? 'إظهار' : 'Show'}
                    onClick={() => patchTrack(track.id, (entry) => ({ ...entry, hidden: !entry.hidden }))}
                  >👁</button>
                  {track.kind !== 'text' && track.kind !== 'subtitle' && (
                    <>
                      <button
                        type="button"
                        className={track.muted ? 'is-off' : ''}
                        aria-pressed={!track.muted}
                        aria-label={ar ? 'كتم المسار' : 'Mute track'}
                        title={ar ? 'كتم' : 'Mute'}
                        onClick={() => patchTrack(track.id, (entry) => ({ ...entry, muted: !entry.muted }))}
                      >🔇</button>
                      <button
                        type="button"
                        className={track.solo ? 'is-on' : ''}
                        aria-pressed={track.solo}
                        aria-label={ar ? 'عزل المسار' : 'Solo track'}
                        title={ar ? 'عزل' : 'Solo'}
                        onClick={() => patchTrack(track.id, (entry) => ({ ...entry, solo: !entry.solo }))}
                      >S</button>
                    </>
                  )}
                </div>
              </div>
              <div className="kmc-mobile-track-lane" data-track-id={track.id}>
                {track.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === selectedItemId ? 'kmc-mobile-clip is-selected' : 'kmc-mobile-clip'}
                    style={{
                      left: `${Math.max(0, item.timelineStart / timelineSpan) * 100}%`,
                      width: `${Math.max(0.02, item.duration / timelineSpan) * 100}%`,
                    }}
                    onPointerDown={(event) => {
                      if (track.locked || item.locked || !event.isPrimary) return;
                      const laneWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
                      dragRef.current = { id: item.id, x: event.clientX, start: item.timelineStart, laneWidth, moved: false };
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setSelectedItemId(item.id);
                    }}
                    onPointerMove={(event) => {
                      const drag = dragRef.current;
                      if (!drag || drag.id !== item.id) return;
                      const delta = event.clientX - drag.x;
                      if (Math.abs(delta) < 6 && !drag.moved) return;
                      drag.moved = true;
                      event.currentTarget.style.transform = `translateX(${delta}px)`;
                    }}
                    onPointerUp={(event) => {
                      const drag = dragRef.current;
                      dragRef.current = null;
                      event.currentTarget.style.transform = '';
                      if (!drag?.moved || !project) return;
                      suppressClickRef.current = true;
                      const targetTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId || track.id;
                      try {
                        const nextStart = draggedTimelineStart(drag.start, event.clientX - drag.x, drag.laneWidth, timelineSpan, project.settings.fps);
                        commit(moveItem(project, item.id, targetTrack, nextStart));
                        setPlayhead(nextStart);
                      } catch (reason) { setError(reason instanceof Error ? reason.message : 'The clip could not be moved.'); }
                    }}
                    onPointerCancel={(event) => { dragRef.current = null; event.currentTarget.style.transform = ''; }}
                    onClick={() => {
                      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                      setSelectedItemId(item.id);
                      setPlayhead(item.timelineStart);
                    }}
                    aria-label={`${item.name}, ${formatTime(item.duration)}`}
                  >
                    <strong><bdi>{item.name}</bdi></strong>
                    <span><bdi>{formatTime(item.duration)}</bdi></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="kmc-mobile-playhead-line" style={{ left: `${Math.max(0, playhead / timelineSpan) * 100}%` }} />
        </div>

        <label className="kmc-mobile-playhead">{ar ? 'تكبير المخطط الزمني' : 'Timeline zoom'} <input aria-label={ar ? 'تكبير المخطط الزمني' : 'Timeline zoom'} type="range" min={1} max={4} step={0.5} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span><bdi>{zoom}×</bdi></span></label>

        {inspectorOpen && selectedItem && (
          <aside className="kmc-mobile-inspector" aria-label={ar ? 'خصائص المقطع' : 'Clip inspector'}>
            <MobileClipInspector
              item={selectedItem}
              settings={project.settings}
              playhead={playhead}
              neighbourDuration={neighbourDuration}
              sourceDimensions={sourceDimensions}
              canvasFiltersAvailable={canvasFiltersAvailable}
              onPatch={patchSelectedItem}
            />
            {selectedItem.kind === 'video' && (
              <div className="kmc-mobile-retouch-block">
                <VideoRetouchInspector
                  item={selectedItem}
                  sourceUrl={previewUrl}
                  fps={project.settings.fps}
                  onChange={updateRetouch}
                />
              </div>
            )}
          </aside>
        )}

        {error && <p className="kmc-mobile-video-error" role="alert">{ar ? ERROR_COPY_AR[error] ?? error : error}</p>}
        {promptDialog}
      </section>
    );
  },
);

MobileVideoTimelineEditor.displayName = 'MobileVideoTimelineEditor';
