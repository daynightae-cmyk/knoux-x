import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FileImage,
  FilePlus2,
  FileVideo,
  FolderOpen,
  GitBranch,
  GitCompare,
  KeyRound,
  Lock,
  LockOpen,
  Maximize,
  MessageSquareText,
  Minimize,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  Subtitles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import {
  addTrack,
  createTimelineItem,
  createTrack,
  deleteItems,
  insertItem,
  interpolateKeyframes,
  mixAudioAtTime,
  moveItem,
  projectDuration,
  reorderTrack,
  splitTimelineItem,
  transitionDuration,
  upsertKeyframe,
} from '../../core/creative/multitrackProject';
import type {
  KeyframeProperty,
  MultitrackProject,
  TimelineItem,
  TimelineTrack,
  TrackKind,
  TransitionKind,
} from '../../core/creative/multitrackProject';
import { setTimelineVideoRetouchTemporal } from '../../core/creative/videoRetouchEffect';
import { transitionFadeOpacity } from '../../core/creative/transitionFade';
import {
  compareBranchMetrics,
  computeBranchMetrics,
} from '../../core/video-studio/ai/branch-metrics';
import type { BranchMetrics, BranchMetricsDelta } from '../../core/video-studio/ai/branch-metrics';
import { useTranslation } from '../../i18n';
import { useMediaViewportFit, type MediaViewportMode } from '../../hooks/useMediaViewportFit';
import { VideoRetouchInspector } from '../video-studio/retouch/VideoRetouchInspector';
import { VideoRetouchPreviewOverlay } from '../video-studio/retouch/VideoRetouchPreviewOverlay';
import {
  attachRetouchAfterTrimIn,
  attachRetouchAfterTrimOut,
  attachRetouchToSplit,
} from '../video-studio/retouch/videoRetouchTimeline';
import type { VideoRetouchClipState } from '../video-studio/retouch/videoRetouchProject';

interface RecentMediaEntry {
  path: string;
  title?: string;
  name?: string;
  type?: string;
  mediaType?: string;
  duration?: number;
}

import {
  buildImportItem,
  classifyMediaExtension,
  ensureImportTrack,
  projectHasItems,
  resolveImportKind,
  type ImportMediaKind,
  type ImportRequest,
} from './videoStudioEntry';

interface ProjectHistory {
  past: MultitrackProject[];
  future: MultitrackProject[];
}

interface RecoveryEntry {
  project: MultitrackProject;
  filePath: string;
  modifiedAt: string;
}

interface BranchSnapshotUI {
  branchId: string;
  label: string;
  createdAt: string;
  metrics: BranchMetrics;
}

type BranchComparisonUI = BranchMetricsDelta;

const trackKinds: TrackKind[] = ['video', 'audio', 'image', 'text', 'subtitle', 'overlay'];
const transitionKinds: Array<TransitionKind | 'none'> = [
  'none',
  'cross-dissolve',
  'fade-black',
  'fade-white',
  'dip-color',
  'wipe',
  'slide',
  'push',
  'zoom',
  'blur',
];
const keyframeProperties: KeyframeProperty[] = [
  'positionX',
  'positionY',
  'scale',
  'rotation',
  'opacity',
  'volume',
];

function itemEnd(item: TimelineItem): number {
  return item.timelineStart + item.duration;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function signedDelta(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

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

function trackIcon(kind: TrackKind): React.ReactNode {
  if (kind === 'video') return <Video size={15} />;
  if (kind === 'audio') return <Music size={15} />;
  if (kind === 'image') return <FileImage size={15} />;
  if (kind === 'text') return <Type size={15} />;
  if (kind === 'subtitle') return <Subtitles size={15} />;
  return <MessageSquareText size={15} />;
}

function compatibleTrack(project: MultitrackProject, kind: TrackKind): TimelineTrack | null {
  return project.tracks.find((track) => track.kind === kind)
    ?? (kind === 'image' ? project.tracks.find((track) => track.kind === 'video') : undefined)
    ?? null;
}

function branchAPI(): Window['knouxVideoStudioAPI'] | null {
  return typeof window.knouxVideoStudioAPI === 'object' && window.knouxVideoStudioAPI !== null
    ? window.knouxVideoStudioAPI
    : null;
}

const MONITOR_MODE_KEY = 'knoux.multitrack.monitorMode';
const TIMELINE_HEIGHT_KEY = 'knoux.multitrack.timelineHeight';
const MONITOR_ZOOM_PRESETS = [25, 50, 75, 100, 150, 200];

function readMonitorMode(): MediaViewportMode {
  try {
    const raw = window.localStorage.getItem(MONITOR_MODE_KEY);
    if (raw === 'fit' || raw === 'fill' || raw === 'actual') return raw;
    const percent = Number(raw);
    if (Number.isFinite(percent) && MONITOR_ZOOM_PRESETS.includes(percent)) return percent;
  } catch {
    // Storage is unavailable; fall back to Fit.
  }
  return 'fit';
}

function readTimelineHeight(): number {
  try {
    const raw = Number(window.localStorage.getItem(TIMELINE_HEIGHT_KEY));
    if (Number.isFinite(raw)) return Math.max(220, Math.min(480, raw));
  } catch {
    // Storage is unavailable; fall back to the default.
  }
  return 280;
}

function monitorModeLabel(mode: MediaViewportMode): string {
  if (mode === 'fit') return 'Fit';
  if (mode === 'fill') return 'Fill';
  if (mode === 'actual') return '100%';
  return `${mode}%`;
}

export const MultitrackEditorView: React.FC = () => {
  const [project, setProject] = useState<MultitrackProject | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [recentMedia, setRecentMedia] = useState<RecentMediaEntry[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('video');
  const [keyframeProperty, setKeyframeProperty] = useState<KeyframeProperty>('opacity');
  const [branches, setBranches] = useState<BranchSnapshotUI[]>([]);
  const [branchLabel, setBranchLabel] = useState('');
  const [branchComparison, setBranchComparison] = useState<BranchComparisonUI | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const historyRef = useRef<ProjectHistory>({ past: [], future: [] });
  const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const { locale, t } = useTranslation();
  // Program-monitor display state only; never mutates the project transform.
  const [monitorMode, setMonitorMode] = useState<MediaViewportMode>(() => readMonitorMode());
  const [monitorNatural, setMonitorNatural] = useState<{ width: number; height: number } | null>(null);
  const [focusPreview, setFocusPreview] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(() => readTimelineHeight());
  const splitterRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const monitorFit = useMediaViewportFit(monitorNatural, monitorMode);

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview'
    && typeof window.knouxMultitrackAPI?.create === 'function';
  const duration = useMemo(() => project ? projectDuration(project) : 0, [project]);
  const orderedTracks = useMemo(() => project
    ? [...project.tracks].sort((left, right) => left.order - right.order)
    : [], [project]);
  const selectedItem = useMemo(() => project?.tracks.flatMap((track) => track.items).find((item) => item.id === selectedItemId) ?? null, [project, selectedItemId]);
  // Program-monitor transition proof: the selected item previews with its
  // keyframed opacity multiplied by the shared transition fade (the exact
  // semantic the mobile timeline renderer bakes into exported frames).
  const previewLocalTime = selectedItem
    ? Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart))
    : 0;
  const previewOpacity = selectedItem
    ? transitionFadeOpacity(
      interpolateKeyframes(selectedItem.keyframes, 'opacity', previewLocalTime, selectedItem.transform.opacity),
      selectedItem.transitionIn,
      selectedItem.transitionOut,
      previewLocalTime,
      selectedItem.duration,
    )
    : 1;
  const anySoloTrack = useMemo(() => project?.tracks.some((track) => track.solo) ?? false, [project]);
  const currentMetrics = useMemo(() => project ? computeBranchMetrics(project) : null, [project]);
  const activeMix = useMemo(() => project ? mixAudioAtTime(project, playhead) : [], [playhead, project]);
  const pixelsPerSecond = useMemo(() => Math.max(24, Math.min(220, 54 * (project?.settings.timelineZoom ?? 1))), [project?.settings.timelineZoom]);
  const timelineWidth = Math.max(900, duration * pixelsPerSecond + 120);

  const commit = useCallback((next: MultitrackProject): void => {
    setProject((current) => {
      if (current) {
        historyRef.current.past.push(structuredClone(current));
        if (historyRef.current.past.length > 100) historyRef.current.past.shift();
      }
      historyRef.current.future = [];
      return { ...structuredClone(next), updatedAt: new Date().toISOString() };
    });
    setDirty(true);
  }, []);

  const activate = useCallback((next: MultitrackProject, filePath?: string, unsaved = false): void => {
    historyRef.current = { past: [], future: [] };
    setProject(structuredClone(next));
    setProjectPath(filePath);
    setSelectedTrackId(next.tracks[0]?.id ?? null);
    setSelectedItemId(next.tracks[0]?.items[0]?.id ?? null);
    setPlayhead(0);
    setDirty(unsaved);
    setError(null);
  }, []);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) return;
    try {
      const [nextRecent, nextRecoveries] = await Promise.all([
        window.knouxMultitrackAPI.recent(),
        window.knouxMultitrackAPI.recoveries(),
      ]);
      setRecent(nextRecent);
      setRecoveries(nextRecoveries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.workspaceFailed'));
    }
    // Recent media is advisory: an empty or unavailable history is an honest
    // empty state, never a workspace error.
    try {
      if (typeof window.knouxAPI?.library?.getHistory === 'function') {
        const history = await window.knouxAPI.library.getHistory(8);
        setRecentMedia(Array.isArray(history) ? history.filter((entry): entry is RecentMediaEntry =>
          Boolean(entry) && typeof (entry as RecentMediaEntry).path === 'string' && (entry as RecentMediaEntry).path.length > 0,
        ) : []);
      }
    } catch {
      setRecentMedia([]);
    }
  }, [desktopRuntime, t]);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);

  useEffect(() => {
    if (!project || !dirty || !desktopRuntime) return undefined;
    const interval = Math.max(5, project.settings.autosaveSeconds) * 1000;
    const timer = window.setTimeout(() => {
      void window.knouxMultitrackAPI.autosave(project).catch(() => undefined);
    }, interval);
    return () => window.clearTimeout(timer);
  }, [desktopRuntime, dirty, project]);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    setPreviewPlaying(false);
    const sourcePath = selectedItem?.sourcePath;
    if (!sourcePath) return () => { active = false; };
    void window.knouxCreativeAPI.media.toUrl(sourcePath)
      .then((url) => { if (active) setPreviewUrl(url); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('multitrack.previewFailed')); });
    return () => { active = false; };
  }, [selectedItem?.sourcePath, t]);

  useEffect(() => {
    const media = previewRef.current;
    if (!media || !selectedItem || !previewUrl || media.readyState === 0) return;
    const local = Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart));
    const sourceTime = selectedItem.sourceIn + local * selectedItem.playbackRate;
    if (Math.abs(media.currentTime - sourceTime) > 0.1) media.currentTime = sourceTime;
    media.playbackRate = Math.max(0.25, Math.min(4, selectedItem.playbackRate));
    const mix = activeMix.find((entry) => entry.itemId === selectedItem.id);
    media.volume = Math.max(0, Math.min(1, mix?.gain ?? selectedItem.audio.volume));
  }, [activeMix, playhead, previewUrl, selectedItem]);

  const createProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    const name = window.prompt(t('multitrack.projectName'), t('multitrack.defaultProject'))?.trim();
    if (!name) return;
    setBusy(true);
    try {
      activate(await window.knouxMultitrackAPI.create(name));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.createFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, t]);

  const openProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setBusy(true);
    try {
      const opened = await window.knouxMultitrackAPI.open();
      if (opened) activate(opened.project, opened.filePath, opened.migrated);
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, refreshWorkspace, t]);

  const openRecent = useCallback(async (filePath: string): Promise<void> => {
    setBusy(true);
    try {
      const opened = await window.knouxMultitrackAPI.openRecent(filePath);
      activate(opened.project, opened.filePath, opened.migrated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, t]);

  const saveProject = useCallback(async (saveAs = false): Promise<{ ok: boolean; filePath?: string; projectId?: string; error?: string }> => {
    if (!project) return { ok: false, error: t('multitrack.saveFailed') };
    if (busy) return { ok: false, projectId: project.id, error: 'Project persistence is already in progress.' };
    if (!desktopRuntime) return { ok: false, projectId: project.id, error: 'Project persistence is unavailable in this runtime.' };
    setBusy(true);
    try {
      const snapshot = structuredClone(project);
      const saved = await window.knouxMultitrackAPI.save(snapshot, projectPath, saveAs);
      if (!saved) return { ok: false, projectId: snapshot.id, error: t('multitrack.saveFailed') };
      setProjectPath(saved);
      setDirty(false);
      await refreshWorkspace();
      return { ok: true, filePath: saved, projectId: snapshot.id };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('multitrack.saveFailed');
      setError(message);
      return { ok: false, projectId: project.id, error: message };
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, project, projectPath, refreshWorkspace, t]);

  const refreshBranches = useCallback(async (projectId: string): Promise<void> => {
    const api = branchAPI();
    if (!api) return;
    try {
      const stored = await api.listBranches(projectId);
      setBranches(stored.map((entry: Record<string, unknown>) => ({
        branchId: entry.branchId as string,
        label: entry.label as string,
        createdAt: entry.createdAt as string,
        metrics: entry.metrics as BranchMetrics,
      })));
    } catch (reason) {
      setBranchError(reason instanceof Error ? reason.message : t('multitrack.branchLoadFailed'));
    }
  }, [t]);

  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    void refreshBranches(projectId);
  }, [projectId, refreshBranches]);

  const snapshotBranch = useCallback(async (): Promise<void> => {
    const api = branchAPI();
    if (!api || !project || branchBusy) return;
    const label = branchLabel.trim() || project.name;
    setBranchBusy(true);
    setBranchError(null);
    setBranchComparison(null);
    try {
      await api.createBranch(project, label.slice(0, 120));
      setBranchLabel('');
      await refreshBranches(project.id);
    } catch (reason) {
      setBranchError(reason instanceof Error ? reason.message : t('multitrack.branchSnapshotFailed'));
    } finally {
      setBranchBusy(false);
    }
  }, [branchBusy, branchLabel, project, refreshBranches, t]);

  const compareBranchWithCurrent = useCallback((branch: BranchSnapshotUI): void => {
    if (!project) return;
    setBranchComparison(compareBranchMetrics(branch.metrics, computeBranchMetrics(project)));
  }, [project]);

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

  const createNewTrack = useCallback((): void => {
    if (!project) return;
    const count = project.tracks.filter((track) => track.kind === newTrackKind).length + 1;
    const label = t(`multitrack.track_${newTrackKind}`);
    const track = createTrack(crypto.randomUUID(), newTrackKind, `${label} ${count}`, project.tracks.length);
    commit(addTrack(project, track));
    setSelectedTrackId(track.id);
    setSelectedItemId(null);
  }, [commit, newTrackKind, project, t]);

  const patchTrack = useCallback((trackId: string, patch: Partial<TimelineTrack>): void => {
    if (!project) return;
    commit({
      ...project,
      tracks: project.tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
    });
  }, [commit, project]);

  const moveTrackOrder = useCallback((trackId: string, direction: -1 | 1): void => {
    if (!project) return;
    const track = project.tracks.find((entry) => entry.id === trackId);
    if (!track) return;
    commit({ ...project, tracks: reorderTrack(project.tracks, trackId, track.order + direction) });
  }, [commit, project]);

  /**
   * Shared production import path: dialog selection AND Explorer drag/drop
   * funnel through here. Resolves the timeline kind from real stream
   * evidence, assures a compatible track (creating one when missing),
   * places the first clip of an empty project at timeline 0, and selects
   * the new item so preview + inspector follow immediately.
   */
  const insertSelectedMedia = useCallback(async (
    base: MultitrackProject,
    selected: { filePath: string; mediaUrl: string },
    requested: ImportRequest,
    options: { fresh?: boolean; preferredTrackId?: string } = {},
  ): Promise<MultitrackProject> => {
    const classified = classifyMediaExtension(selected.filePath);
    let probe: { hasVideo: boolean; hasAudio: boolean } | null = null;
    if (classified !== 'image') {
      const raw = await window.knouxCreativeAPI.export.probe(selected.filePath);
      const streams = raw.streams ?? [];
      probe = {
        hasVideo: streams.some((stream) => stream.codec_type === 'video'),
        hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
      };
    }
    let kind: ImportMediaKind;
    try {
      kind = resolveImportKind(selected.filePath, probe, requested);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'IMPORT_NOT_IMAGE_REQUESTED' || code === 'IMPORT_NOT_IMAGE_FILE') {
        throw new Error(t('multitrack.selectImageFile'));
      }
      if (code === 'IMPORT_NOT_VIDEO') throw new Error(t('multitrack.selectVideoFile'));
      throw new Error(t('multitrack.addMediaFailed'));
    }
    const itemDuration = kind === 'image'
      ? 5
      : await readMediaMetadata(selected.mediaUrl, kind);
    const preferred = options.preferredTrackId
      ? base.tracks.find((track) => track.id === options.preferredTrackId && track.kind === kind)
      : undefined;
    const ensured = preferred
      ? { project: base, track: preferred }
      : ensureImportTrack(base, kind, crypto.randomUUID(), t(`multitrack.track_${kind}`));
    const atZero = !projectHasItems(ensured.project);
    const item = buildImportItem(
      crypto.randomUUID(),
      ensured.track.id,
      kind,
      selected.filePath,
      itemDuration,
      atZero ? 0 : playhead,
    );
    const next = insertItem(ensured.project, item);
    if (options.fresh) {
      historyRef.current = { past: [], future: [] };
      setProject(structuredClone(next));
      setProjectPath(undefined);
      setSelectedTrackId(ensured.track.id);
      setSelectedItemId(item.id);
      setPlayhead(0);
      setDirty(true);
      setError(null);
    } else {
      commit(next);
      setSelectedTrackId(ensured.track.id);
      setSelectedItemId(item.id);
    }
    return next;
  }, [commit, playhead, t]);

  const addMedia = useCallback(async (targetKind: 'video' | 'audio' | 'image'): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = targetKind === 'video' && typeof window.knouxCreativeAPI?.media?.openVideo === 'function'
        ? await window.knouxCreativeAPI.media.openVideo()
        : await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      await insertSelectedMedia(project, selected, targetKind);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, insertSelectedMedia, project, t]);

  /**
   * Zero-project entry: Import Video / Import Media auto-creates an Untitled
   * project when none is open, then follows the same production import path.
   */
  const importEntryMedia = useCallback(async (requested: 'video' | 'auto'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let base = project;
      let fresh = false;
      if (!base) {
        if (!desktopRuntime) return;
        base = await window.knouxMultitrackAPI.create(t('multitrack.untitledProject'));
        fresh = true;
      }
      const opener = requested === 'video' && typeof window.knouxCreativeAPI?.media?.openVideo === 'function'
        ? window.knouxCreativeAPI.media.openVideo()
        : window.knouxCreativeAPI.media.open();
      const selected = await opener;
      if (!selected) {
        if (fresh) activate(base, undefined, true);
        return;
      }
      await insertSelectedMedia(base, selected, requested, { fresh });
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [activate, busy, desktopRuntime, insertSelectedMedia, project, refreshWorkspace, t]);

  /**
   * Explorer drag/drop follows the same production import path: authorize the
   * dropped file, resolve its media URL, then insert it like a dialog import.
   */
  const importDroppedFiles = useCallback(async (files: FileList | File[], preferredTrackId?: string): Promise<void> => {
    const list = Array.from(files);
    if (list.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      let base = project;
      let fresh = false;
      if (!base) {
        if (!desktopRuntime) return;
        base = await window.knouxMultitrackAPI.create(t('multitrack.untitledProject'));
        fresh = true;
      }
      let current = base;
      let firstFresh = fresh;
      for (const file of list) {
        if (classifyMediaExtension(file.name) === 'unknown') continue;
        // eslint-disable-next-line no-await-in-loop
        const filePath = await window.knouxAPI.file.authorizeDroppedFile(file);
        // eslint-disable-next-line no-await-in-loop
        const mediaUrl = await window.knouxCreativeAPI.media.toUrl(filePath);
        // eslint-disable-next-line no-await-in-loop
        current = await insertSelectedMedia(current, { filePath, mediaUrl }, 'auto', { fresh: firstFresh, preferredTrackId });
        firstFresh = false;
      }
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, insertSelectedMedia, project, refreshWorkspace, t]);

  /**
   * Recent-media entry: reopens a library item through the production
   * open-item path (re-authorizes it) and imports it like any other media,
   * auto-creating an Untitled project when none is open.
   */
  const importRecentMediaItem = useCallback(async (mediaPath: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let base = project;
      let fresh = false;
      if (!base) {
        if (!desktopRuntime) return;
        base = await window.knouxMultitrackAPI.create(t('multitrack.untitledProject'));
        fresh = true;
      }
      const selected = await window.knouxCreativeAPI.library.openItem(mediaPath);
      await insertSelectedMedia(base, selected, 'auto', { fresh });
      await refreshWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, insertSelectedMedia, project, refreshWorkspace, t]);

  const addTextItem = useCallback((kind: 'text' | 'subtitle'): void => {
    if (!project) return;
    const track = compatibleTrack(project, kind);
    if (!track) {
      setError(t('multitrack.noCompatibleTrack'));
      return;
    }
    const initial = window.prompt(
      kind === 'subtitle' ? t('multitrack.subtitleText') : t('multitrack.titleText'),
      kind === 'subtitle' ? t('multitrack.defaultSubtitle') : t('multitrack.defaultTitle'),
    )?.trim();
    if (!initial) return;
    const item = createTimelineItem({
      id: crypto.randomUUID(),
      trackId: track.id,
      kind,
      name: initial.slice(0, 80),
      timelineStart: playhead,
      duration: kind === 'subtitle' ? 3 : 5,
    });
    if (item.text) item.text.text = initial;
    commit(insertItem(project, item));
    setSelectedTrackId(track.id);
    setSelectedItemId(item.id);
  }, [commit, playhead, project, t]);

  const patchSelectedItem = useCallback((patcher: (item: TimelineItem) => TimelineItem): void => {
    if (!project || !selectedItem) return;
    commit({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => item.id === selectedItem.id ? patcher(structuredClone(item)) : item),
      })),
    });
  }, [commit, project, selectedItem]);

  const updateSelectedRetouch = useCallback((state: VideoRetouchClipState): void => {
    if (!project || !selectedItem) return;
    commit(setTimelineVideoRetouchTemporal(project, selectedItem.id, state));
  }, [commit, project, selectedItem]);

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
      setError(reason instanceof Error ? reason.message : t('multitrack.splitFailed'));
    }
  }, [commit, playhead, project, selectedItem, t]);

  const trimSelectedIn = useCallback((): void => {
    if (!selectedItem) return;
    const offset = playhead - selectedItem.timelineStart;
    if (offset <= 0 || offset >= selectedItem.duration) return;
    patchSelectedItem((item) => {
      const newDuration = item.duration - offset;
      const trimmed = {
        ...item,
        timelineStart: playhead,
        sourceIn: item.sourceIn + offset * item.playbackRate,
        duration: newDuration,
      };
      return attachRetouchAfterTrimIn(trimmed, offset, newDuration);
    });
  }, [patchSelectedItem, playhead, selectedItem]);

  const trimSelectedOut = useCallback((): void => {
    if (!selectedItem) return;
    const durationValue = playhead - selectedItem.timelineStart;
    if (durationValue <= 0 || durationValue >= selectedItem.duration) return;
    patchSelectedItem((item) => attachRetouchAfterTrimOut({
      ...item,
      sourceOut: item.sourceIn + durationValue * item.playbackRate,
      duration: durationValue,
    }, durationValue));
  }, [patchSelectedItem, playhead, selectedItem]);

  const duplicateSelected = useCallback((): void => {
    if (!project || !selectedItem) return;
    const copy = structuredClone(selectedItem);
    copy.id = crypto.randomUUID();
    copy.timelineStart = itemEnd(selectedItem);
    copy.keyframes = copy.keyframes.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() }));
    commit(insertItem(project, copy));
    setSelectedItemId(copy.id);
  }, [commit, project, selectedItem]);

  const deleteSelected = useCallback((): void => {
    if (!project || !selectedItem) return;
    try {
      commit(deleteItems(project, [selectedItem.id]));
      setSelectedItemId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.deleteFailed'));
    }
  }, [commit, project, selectedItem, t]);

  const addKeyframe = useCallback((): void => {
    if (!selectedItem) return;
    const localTime = Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart));
    const fallback = keyframeProperty === 'opacity'
      ? selectedItem.transform.opacity
      : keyframeProperty === 'scale'
        ? selectedItem.transform.scale
        : keyframeProperty === 'rotation'
          ? selectedItem.transform.rotation
          : keyframeProperty === 'positionX'
            ? selectedItem.transform.positionX
            : keyframeProperty === 'positionY'
              ? selectedItem.transform.positionY
              : selectedItem.audio.volume;
    const raw = window.prompt(t('multitrack.keyframeValue'), String(fallback));
    if (raw === null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    patchSelectedItem((item) => upsertKeyframe(item, {
      id: crypto.randomUUID(),
      property: keyframeProperty,
      time: localTime,
      value,
      easing: 'ease-in-out',
    }));
  }, [keyframeProperty, patchSelectedItem, playhead, selectedItem, t]);

  const setTransition = useCallback((side: 'in' | 'out', kind: TransitionKind | 'none'): void => {
    if (!selectedItem) return;
    patchSelectedItem((item) => {
      const key = side === 'in' ? 'transitionIn' : 'transitionOut';
      if (kind === 'none') return { ...item, [key]: null };
      const requested = Number(window.prompt(t('multitrack.transitionDuration'), '0.5') ?? 0.5);
      const durationValue = transitionDuration(Number.isFinite(requested) ? requested : 0.5, item.duration, item.duration);
      return {
        ...item,
        [key]: {
          id: crypto.randomUUID(),
          kind,
          duration: durationValue,
          direction: 'left',
          color: '#000000',
        },
      };
    });
  }, [patchSelectedItem, selectedItem, t]);

  const handleDrop = useCallback((trackId: string, event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!draggedItemId) {
      // Explorer file drop on a track lane follows the production import path.
      if (files && files.length > 0) void importDroppedFiles(files, trackId);
      return;
    }
    if (!project) return;
    const lane = event.currentTarget.getBoundingClientRect();
    const scrollLeft = event.currentTarget.parentElement?.scrollLeft ?? 0;
    const proposed = Math.max(0, (event.clientX - lane.left + scrollLeft) / pixelsPerSecond);
    try {
      commit(moveItem(project, draggedItemId, trackId, proposed));
      setSelectedTrackId(trackId);
      setSelectedItemId(draggedItemId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('multitrack.moveFailed'));
    } finally {
      setDraggedItemId(null);
    }
  }, [commit, draggedItemId, importDroppedFiles, pixelsPerSecond, project, t]);

  const togglePreview = useCallback(async (): Promise<void> => {
    const media = previewRef.current;
    if (!media || !selectedItem) return;
    if (media.paused) {
      const local = Math.max(0, Math.min(selectedItem.duration, playhead - selectedItem.timelineStart));
      media.currentTime = selectedItem.sourceIn + local * selectedItem.playbackRate;
      await media.play();
      setPreviewPlaying(true);
    } else {
      media.pause();
      setPreviewPlaying(false);
    }
  }, [playhead, selectedItem]);

  // Persist preview-only display preferences without touching the project.
  useEffect(() => {
    try {
      window.localStorage.setItem(MONITOR_MODE_KEY, String(monitorMode));
    } catch {
      // Storage is unavailable; the preference simply does not persist.
    }
  }, [monitorMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight));
    } catch {
      // Storage is unavailable; the preference simply does not persist.
    }
  }, [timelineHeight]);

  // Focus preview is display-only; Escape always returns to the editor.
  useEffect(() => {
    if (!focusPreview) return undefined;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocusPreview(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusPreview]);

  // Reset the fitted frame whenever a different item is previewed.
  useEffect(() => {
    setMonitorNatural(null);
  }, [selectedItemId, previewUrl]);

  const beginTimelineResize = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    splitterRef.current = { startY: event.clientY, startHeight: timelineHeight };
    const handleMove = (moveEvent: PointerEvent): void => {
      const origin = splitterRef.current;
      if (!origin) return;
      setTimelineHeight(Math.max(220, Math.min(480, origin.startHeight + (moveEvent.clientY - origin.startY))));
    };
    const handleUp = (): void => {
      splitterRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }, [timelineHeight]);

  const handleMonitorMode = useCallback((mode: MediaViewportMode): void => {
    setMonitorMode(mode);
  }, []);

  useEffect(() => {
    const handleCommand = (event: Event): void => {
      const detail = (event as CustomEvent<{ command?: string; requestId?: string }>).detail;
      switch (detail?.command) {
        case 'split-clip': splitSelected(); break;
        case 'trim-in': trimSelectedIn(); break;
        case 'trim-out': trimSelectedOut(); break;
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'save':
          void saveProject(false).then((result) => {
            if (!detail.requestId) return;
            window.dispatchEvent(new CustomEvent('knoux:command-result', {
              detail: { command: 'save', requestId: detail.requestId, ...result },
            }));
          });
          break;
        default: break;
      }
    };
    window.addEventListener('knoux:command', handleCommand);
    return () => window.removeEventListener('knoux:command', handleCommand);
  }, [redo, saveProject, splitSelected, trimSelectedIn, trimSelectedOut, undo]);

  if (!project) {
    return (
      <section
        className="creative-view multitrack-editor-view"
        aria-labelledby="multitrack-title"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer?.files?.length) void importDroppedFiles(event.dataTransfer.files);
        }}
      >
        <header className="creative-header">
          <div>
            <span className="creative-eyebrow">{t('multitrack.eyebrow')}</span>
            <h1 id="multitrack-title"><Video size={30} /> {t('multitrack.title')}</h1>
            <p>{t('multitrack.description')}</p>
          </div>
        </header>
        <RuntimeModeNotice feature="Versioned offline multitrack editing" featureAr="تحرير متعدد المسارات محلي وإصداري" />
        {error && <div className="creative-error" role="alert">{error}</div>}
        <div className="multitrack-start-grid">
          <NeonPanel variant="dark" padding="lg" className="multitrack-start-card">
            <FileVideo size={42} />
            <h2>{t('multitrack.importVideo')}</h2>
            <p>{t('multitrack.importDescription')}</p>
            <NeonButton variant="primary" leftIcon={<FileVideo size={16} />} onClick={() => void importEntryMedia('video')} disabled={!desktopRuntime || busy}>{t('multitrack.importVideo')}</NeonButton>
            <NeonButton variant="secondary" leftIcon={<Upload size={16} />} onClick={() => void importEntryMedia('auto')} disabled={!desktopRuntime || busy}>{t('multitrack.importMedia')}</NeonButton>
            <p className="multitrack-drop-hint">{t('multitrack.dropHint')}</p>
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg" className="multitrack-start-card">
            <FilePlus2 size={42} />
            <h2>{t('multitrack.newProject')}</h2>
            <p>{t('multitrack.newDescription')}</p>
            <NeonButton variant="primary" leftIcon={<FilePlus2 size={16} />} onClick={() => void createProject()} disabled={!desktopRuntime || busy}>{t('multitrack.create')}</NeonButton>
            <NeonButton variant="secondary" leftIcon={<FolderOpen size={16} />} onClick={() => void openProject()} disabled={!desktopRuntime || busy}>{t('multitrack.open')}</NeonButton>
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg">
            <h2>{t('multitrack.recoveries')}</h2>
            {recoveries.length === 0 ? <div className="creative-empty">{t('multitrack.noRecoveries')}</div> : recoveries.map((entry) => (
              <button key={entry.filePath} type="button" className="multitrack-project-link" onClick={() => activate(entry.project, undefined, true)}>
                <strong>{entry.project.name}</strong><span>{new Date(entry.modifiedAt).toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-US')}</span>
              </button>
            ))}
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg">
            <h2>{t('multitrack.recent')}</h2>
            {recent.length === 0 ? <div className="creative-empty">{t('multitrack.noRecent')}</div> : recent.map((filePath) => (
              <button key={filePath} type="button" className="multitrack-project-link" onClick={() => void openRecent(filePath)}>
                <strong>{basename(filePath)}</strong><span dir="auto">{filePath}</span>
              </button>
            ))}
          </NeonPanel>
          <NeonPanel variant="dark" padding="lg">
            <h2>{t('multitrack.recentMedia')}</h2>
            {recentMedia.length === 0 ? <div className="creative-empty">{t('multitrack.noRecentMedia')}</div> : recentMedia.map((entry) => (
              <button key={entry.path} type="button" className="multitrack-project-link" onClick={() => void importRecentMediaItem(entry.path)}>
                <strong>{entry.title || entry.name || basename(entry.path)}</strong><span dir="auto">{entry.mediaType ?? entry.type ?? ''}{typeof entry.duration === 'number' && entry.duration > 0 ? ` · ${formatTime(entry.duration)}` : ''}</span>
              </button>
            ))}
          </NeonPanel>
        </div>
      </section>
    );
  }

  return (
    <section className={`creative-view multitrack-editor-view${focusPreview ? ' knoux-workspace-focus' : ''}`} aria-labelledby="multitrack-title">
      <header className="creative-header multitrack-header knoux-focus-collapsible">
        <div>
          <span className="creative-eyebrow">{t('multitrack.eyebrow')}</span>
          <h1 id="multitrack-title"><Video size={30} /> {project.name}</h1>
          <p>{project.settings.width}×{project.settings.height} · {project.settings.fps} FPS · {formatTime(duration)} · {project.tracks.length} {t('multitrack.tracks')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FilePlus2 size={15} />} onClick={() => void createProject()} disabled={busy}>{t('common.new')}</NeonButton>
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={15} />} onClick={() => void openProject()} disabled={busy}>{t('multitrack.open')}</NeonButton>
          <NeonButton variant="secondary" leftIcon={<Save size={15} />} onClick={() => void saveProject(false)} disabled={busy}>{dirty ? t('multitrack.saveChanges') : t('common.save')}</NeonButton>
          <NeonButton variant="ghost" onClick={() => void saveProject(true)} disabled={busy}>{t('common.saveAs')}</NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Versioned offline multitrack editing" featureAr="تحرير متعدد المسارات محلي وإصداري" />
      <StudioPresetBar
        kind="video-editing"
        values={{ timelineZoom: project.settings.timelineZoom, snapEnabled: project.settings.snapEnabled, snapThreshold: project.settings.snapThreshold, autosaveSeconds: project.settings.autosaveSeconds }}
        onApply={(values) => {
          commit({
            ...project,
            settings: {
              ...project.settings,
              timelineZoom: typeof values.timelineZoom === 'number' ? Math.max(0.25, Math.min(4, values.timelineZoom)) : project.settings.timelineZoom,
              snapEnabled: typeof values.snapEnabled === 'boolean' ? values.snapEnabled : project.settings.snapEnabled,
              snapThreshold: typeof values.snapThreshold === 'number' ? Math.max(0, values.snapThreshold) : project.settings.snapThreshold,
              autosaveSeconds: typeof values.autosaveSeconds === 'number' ? Math.max(5, values.autosaveSeconds) : project.settings.autosaveSeconds,
            },
          });
        }}
      />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="multitrack-toolbar">
        <button type="button" onClick={undo} disabled={historyRef.current.past.length === 0} title={t('editor.undo')}><Undo2 size={16} /></button>
        <button type="button" onClick={redo} disabled={historyRef.current.future.length === 0} title={t('editor.redo')}><Redo2 size={16} /></button>
        <span className="multitrack-divider" />
        <NeonButton variant="ghost" size="sm" leftIcon={<Video size={14} />} onClick={() => void addMedia('video')}>{t('multitrack.addVideo')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<Music size={14} />} onClick={() => void addMedia('audio')}>{t('multitrack.addAudio')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<FileImage size={14} />} onClick={() => void addMedia('image')}>{t('multitrack.addImage')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<Type size={14} />} onClick={() => addTextItem('text')}>{t('multitrack.addTitle')}</NeonButton>
        <NeonButton variant="ghost" size="sm" leftIcon={<Subtitles size={14} />} onClick={() => addTextItem('subtitle')}>{t('multitrack.addSubtitle')}</NeonButton>
        <span className="multitrack-divider" />
        <button type="button" onClick={splitSelected} disabled={!selectedItem} title={t('editor.split')}><Scissors size={16} /></button>
        <button type="button" onClick={duplicateSelected} disabled={!selectedItem} title={t('editor.duplicate')}><Copy size={16} /></button>
        <button type="button" onClick={deleteSelected} disabled={!selectedItem} title={t('common.cancel')}><Trash2 size={16} /></button>
      </div>

      <div className={`multitrack-main-grid knoux-workspace-grid${inspectorCollapsed ? ' knoux-inspector-hidden' : ''}`}>
        <NeonPanel variant="dark" padding="none" className="multitrack-preview-panel">
          <div className="knoux-monitor-bar" role="toolbar" aria-label={t('multitrack.monitorBar')}>
            <div className="knoux-monitor-group" role="group" aria-label={t('multitrack.monitorZoom')}>
              <button type="button" aria-pressed={monitorMode === 'fit'} title={t('multitrack.monitorFit')} onClick={() => handleMonitorMode('fit')}>{t('multitrack.monitorFit')}</button>
              <button type="button" aria-pressed={monitorMode === 'fill'} title={t('multitrack.monitorFill')} onClick={() => handleMonitorMode('fill')}>{t('multitrack.monitorFill')}</button>
              <button type="button" aria-pressed={monitorMode === 'actual'} title={t('multitrack.monitorActual')} onClick={() => handleMonitorMode('actual')}>{t('multitrack.monitorActual')}</button>
              <NeonSelect
                value={typeof monitorMode === 'number' ? String(monitorMode) : 'fit'}
                onChange={(value) => handleMonitorMode(value === 'fit' ? 'fit' : Number(value) as MediaViewportMode)}
                options={[{ value: 'fit', label: monitorModeLabel(monitorMode) }, ...MONITOR_ZOOM_PRESETS.map((preset) => ({ value: String(preset), label: `${preset}%` }))]}
                label={t('multitrack.monitorZoom')}
              />
            </div>
            <span className="knoux-monitor-separator" />
            <div className="knoux-monitor-group">
              <button
                type="button"
                aria-pressed={focusPreview}
                title={focusPreview ? t('multitrack.monitorExitFocus') : t('multitrack.monitorFocus')}
                onClick={() => setFocusPreview((value) => !value)}
              >
                {focusPreview ? <Minimize size={15} /> : <Maximize size={15} />}
              </button>
              <button
                type="button"
                aria-pressed={inspectorCollapsed}
                title={inspectorCollapsed ? t('multitrack.monitorExpandInspector') : t('multitrack.monitorCollapseInspector')}
                onClick={() => setInspectorCollapsed((value) => !value)}
              >
                {inspectorCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
              </button>
            </div>
          </div>
          <div ref={monitorFit.stageRef} className={`multitrack-preview-stage knoux-media-stage${monitorFit.overflows ? ' knoux-media-stage--overflow' : ''}`}>
            {selectedItem?.sourcePath && previewUrl ? (
              selectedItem.kind === 'audio' ? (
                <div className="multitrack-audio-preview"><AudioLines size={58} /><strong>{selectedItem.name}</strong><audio ref={(node) => { previewRef.current = node; }} src={previewUrl} onEnded={() => setPreviewPlaying(false)} /></div>
              ) : selectedItem.kind === 'image' ? (
                <div className="knoux-media-frame" style={{ width: monitorFit.frame.width || undefined, height: monitorFit.frame.height || undefined }}>
                  <img
                    src={previewUrl}
                    alt={selectedItem.name}
                    style={{ width: '100%', height: '100%', objectFit: monitorFit.objectFit, opacity: previewOpacity }}
                    onLoad={(event) => {
                      const target = event.currentTarget;
                      if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                        setMonitorNatural({ width: target.naturalWidth, height: target.naturalHeight });
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="knoux-media-frame" style={{ width: monitorFit.frame.width || undefined, height: monitorFit.frame.height || undefined }}>
                  <video
                    ref={(node) => { previewRef.current = node; }}
                    src={previewUrl}
                    style={{ width: '100%', height: '100%', objectFit: monitorFit.objectFit, opacity: previewOpacity }}
                    onEnded={() => setPreviewPlaying(false)}
                    onLoadedMetadata={(event) => {
                      const target = event.currentTarget;
                      if (target.videoWidth > 0 && target.videoHeight > 0) {
                        setMonitorNatural({ width: target.videoWidth, height: target.videoHeight });
                      }
                    }}
                  />
                  <VideoRetouchPreviewOverlay item={selectedItem} mediaRef={previewRef} playhead={playhead} />
                </div>
              )
            ) : selectedItem?.text ? (
              <div className="multitrack-text-preview" dir={selectedItem.text.direction} style={{
                color: selectedItem.text.color,
                background: selectedItem.text.backgroundColor,
                fontFamily: selectedItem.text.fontFamily,
                fontSize: `${Math.max(16, selectedItem.text.fontSize / 2)}px`,
                fontWeight: selectedItem.text.fontWeight,
                opacity: interpolateKeyframes(selectedItem.keyframes, 'opacity', Math.max(0, playhead - selectedItem.timelineStart), selectedItem.transform.opacity),
                transform: `translate(${selectedItem.transform.positionX}px, ${selectedItem.transform.positionY}px) scale(${selectedItem.transform.scale}) rotate(${selectedItem.transform.rotation}deg)`,
              }}>{selectedItem.text.text}</div>
            ) : (
              <div className="creative-empty">{t('multitrack.selectItem')}</div>
            )}
            {selectedItem?.sourcePath && selectedItem.kind !== 'image' && (
              <button type="button" className="multitrack-preview-play" onClick={() => void togglePreview()}>{previewPlaying ? <Pause size={22} /> : <Play size={22} />}</button>
            )}
          </div>
          <div className="multitrack-playhead-controls">
            <input type="range" min="0" max={Math.max(0.001, duration)} step={1 / project.settings.fps} value={Math.min(playhead, duration)} onChange={(event) => setPlayhead(Number(event.target.value))} />
            <strong dir="ltr">{formatTime(playhead)}</strong>
          </div>
        </NeonPanel>

        <NeonPanel variant="dark" padding="md" className={`multitrack-inspector knoux-inspector-collapsible${inspectorCollapsed ? ' knoux-inspector-hidden' : ''}`}>
          <h2>{t('multitrack.inspector')}</h2>
          {!selectedItem ? <div className="creative-empty">{t('multitrack.selectItem')}</div> : (
            <div className="multitrack-inspector-fields">
              <label><span>{t('multitrack.name')}</span><input value={selectedItem.name} onChange={(event) => patchSelectedItem((item) => ({ ...item, name: event.target.value.slice(0, 240) }))} /></label>
              <div className="multitrack-two-columns">
                <label><span>{t('multitrack.start')}</span><input type="number" min="0" step="0.001" value={selectedItem.timelineStart} onChange={(event) => patchSelectedItem((item) => ({ ...item, timelineStart: Math.max(0, Number(event.target.value)) }))} /></label>
                <label><span>{t('multitrack.duration')}</span><input type="number" min="0.04" step="0.001" value={selectedItem.duration} onChange={(event) => patchSelectedItem((item) => ({ ...item, duration: Math.max(0.04, Number(event.target.value)) }))} /></label>
              </div>
              {(selectedItem.kind === 'video' || selectedItem.kind === 'audio') && (
                <label><span>Speed · {selectedItem.playbackRate.toFixed(2)}×</span><input type="range" min="0.25" max="4" step="0.05" value={selectedItem.playbackRate} onChange={(event) => patchSelectedItem((item) => {
                  const playbackRate = Math.max(0.25, Math.min(4, Number(event.target.value)));
                  const sourceDuration = Math.max(0.001, item.sourceOut - item.sourceIn);
                  return { ...item, playbackRate, duration: sourceDuration / playbackRate };
                })} /></label>
              )}
              {selectedItem.text && <label><span>{t('multitrack.text')}</span><textarea value={selectedItem.text.text} dir="auto" onChange={(event) => patchSelectedItem((item) => ({ ...item, text: item.text ? { ...item.text, text: event.target.value } : null }))} /></label>}
              <div className="multitrack-two-columns">
                <label><span>X</span><input type="number" value={selectedItem.transform.positionX} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, positionX: Number(event.target.value) } }))} /></label>
                <label><span>Y</span><input type="number" value={selectedItem.transform.positionY} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, positionY: Number(event.target.value) } }))} /></label>
                <label><span>{t('multitrack.scale')}</span><input type="number" min="0.01" max="100" step="0.01" value={selectedItem.transform.scale} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, scale: Math.max(0.01, Number(event.target.value)) } }))} /></label>
                <label><span>{t('multitrack.rotation')}</span><input type="number" step="0.1" value={selectedItem.transform.rotation} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, rotation: Number(event.target.value) } }))} /></label>
              </div>
              {(selectedItem.kind === 'video' || selectedItem.kind === 'image') && (
                <div className="multitrack-two-columns">
                  <label><span>Crop L</span><input type="number" min="0" max="0.95" step="0.01" value={selectedItem.transform.cropLeft} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, cropLeft: Math.max(0, Math.min(0.95, Number(event.target.value))) } }))} /></label>
                  <label><span>Crop R</span><input type="number" min="0" max="0.95" step="0.01" value={selectedItem.transform.cropRight} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, cropRight: Math.max(0, Math.min(0.95, Number(event.target.value))) } }))} /></label>
                  <label><span>Crop T</span><input type="number" min="0" max="0.95" step="0.01" value={selectedItem.transform.cropTop} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, cropTop: Math.max(0, Math.min(0.95, Number(event.target.value))) } }))} /></label>
                  <label><span>Crop B</span><input type="number" min="0" max="0.95" step="0.01" value={selectedItem.transform.cropBottom} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, cropBottom: Math.max(0, Math.min(0.95, Number(event.target.value))) } }))} /></label>
                </div>
              )}
              <label><span>{t('multitrack.opacity')} · {Math.round(selectedItem.transform.opacity * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={selectedItem.transform.opacity} onChange={(event) => patchSelectedItem((item) => ({ ...item, transform: { ...item.transform, opacity: Number(event.target.value) } }))} /></label>
              <label><span>{t('multitrack.volume')} · {Math.round(selectedItem.audio.volume * 100)}%</span><input type="range" min="0" max="4" step="0.01" value={selectedItem.audio.volume} onChange={(event) => patchSelectedItem((item) => ({ ...item, audio: { ...item.audio, volume: Number(event.target.value) } }))} /></label>
              <label><span>{t('multitrack.pan')} · {selectedItem.audio.pan.toFixed(2)}</span><input type="range" min="-1" max="1" step="0.01" value={selectedItem.audio.pan} onChange={(event) => patchSelectedItem((item) => ({ ...item, audio: { ...item.audio, pan: Number(event.target.value) } }))} /></label>
              {(selectedItem.kind === 'video' || selectedItem.kind === 'audio') && (
                <div className="multitrack-two-columns">
                  <label><span>Fade In</span><input type="number" min="0" max={selectedItem.duration} step="0.05" value={selectedItem.audio.fadeIn} onChange={(event) => patchSelectedItem((item) => ({ ...item, audio: { ...item.audio, fadeIn: Math.max(0, Math.min(item.duration, Number(event.target.value))) } }))} /></label>
                  <label><span>Fade Out</span><input type="number" min="0" max={selectedItem.duration} step="0.05" value={selectedItem.audio.fadeOut} onChange={(event) => patchSelectedItem((item) => ({ ...item, audio: { ...item.audio, fadeOut: Math.max(0, Math.min(item.duration, Number(event.target.value))) } }))} /></label>
                </div>
              )}
              <div className="multitrack-transition-grid">
                <label><span>{t('multitrack.transitionIn')}</span><NeonSelect value={selectedItem.transitionIn?.kind ?? 'none'} onChange={(value) => setTransition('in', value as TransitionKind | 'none')} options={transitionKinds.map((kind) => ({ value: kind, label: kind }))} /></label>
                <label><span>{t('multitrack.transitionOut')}</span><NeonSelect value={selectedItem.transitionOut?.kind ?? 'none'} onChange={(value) => setTransition('out', value as TransitionKind | 'none')} options={transitionKinds.map((kind) => ({ value: kind, label: kind }))} /></label>
                <p className="video-studio-muted">{t('multitrack.transitionPreviewNote')}</p>
              </div>
              <div className="multitrack-keyframe-row">
                <NeonSelect value={keyframeProperty} onChange={(value) => setKeyframeProperty(value as KeyframeProperty)} options={keyframeProperties.map((property) => ({ value: property, label: property }))} />
                <NeonButton variant="secondary" size="sm" leftIcon={<KeyRound size={14} />} onClick={addKeyframe}>{t('multitrack.addKeyframe')}</NeonButton>
              </div>
              <div className="multitrack-keyframe-list">{selectedItem.keyframes.map((keyframe) => <span key={keyframe.id}>{keyframe.property} · {formatTime(keyframe.time)} · {keyframe.value}</span>)}</div>
              {selectedItem.kind === 'video' && (
                <VideoRetouchInspector item={selectedItem} sourceUrl={previewUrl} fps={project.settings.fps} onChange={updateSelectedRetouch} />
              )}
            </div>
          )}
        </NeonPanel>
      </div>

      <NeonPanel variant="dark" padding="md" className="multitrack-branches knoux-focus-collapsible">
        <h2><GitBranch size={16} /> {t('multitrack.branchStudio')}</h2>
        <p className="creative-muted">{t('multitrack.branchStudioDescription')}</p>
        {branchError && <div className="creative-error" role="alert">{branchError}</div>}
        <div className="multitrack-branch-create">
          <input
            type="text"
            value={branchLabel}
            placeholder={t('multitrack.branchLabelPlaceholder')}
            maxLength={120}
            onChange={(event) => setBranchLabel(event.target.value)}
          />
          <NeonButton
            variant="primary"
            size="sm"
            leftIcon={<GitBranch size={14} />}
            onClick={() => void snapshotBranch()}
            disabled={!project || branchBusy}
          >
            {t('multitrack.snapshotBranch')}
          </NeonButton>
        </div>
        <div className="multitrack-branch-list">
          {branches.length === 0 ? (
            <div className="creative-empty">{t('multitrack.noBranches')}</div>
          ) : branches.map((branch) => (
            <div key={branch.branchId} className="multitrack-branch-row">
              <button type="button" onClick={() => compareBranchWithCurrent(branch)}>
                <GitCompare size={14} />
                <strong>{branch.label}</strong>
                <span title={branch.createdAt}>{new Date(branch.createdAt).toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-US')}</span>
              </button>
            </div>
          ))}
        </div>
        {branchComparison && project && currentMetrics && (
          <div className="multitrack-branch-comparison">
            <h3>{t('multitrack.branchComparison')} · {t('multitrack.currentProject')}</h3>
            <table>
              <tbody>
                <tr><td>{t('multitrack.branchMetricDuration')}</td><td>{formatTime(projectDuration(project))}</td><td>{signedDelta(branchComparison.durationMsDelta / 1000)}s</td></tr>
                <tr><td>{t('multitrack.branchMetricShots')}</td><td>{currentMetrics.shotCount}</td><td>{signedDelta(branchComparison.shotCountDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricCutDensity')}</td><td>{currentMetrics.cutDensityPerMinute.toFixed(3)}</td><td>{signedDelta(branchComparison.cutDensityPerMinuteDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricAudioDensity')}</td><td>{currentMetrics.audioDensity.toFixed(3)}</td><td>{signedDelta(branchComparison.audioDensityDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricCaptionDensity')}</td><td>{currentMetrics.captionDensity.toFixed(3)}</td><td>{signedDelta(branchComparison.captionDensityDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricTransitions')}</td><td>{currentMetrics.transitionCount}</td><td>{signedDelta(branchComparison.transitionCountDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricMotion')}</td><td>{currentMetrics.motionIntensityPerMinute.toFixed(3)}</td><td>{signedDelta(branchComparison.motionIntensityPerMinuteDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricEffects')}</td><td>{currentMetrics.effectsCount}</td><td>{signedDelta(branchComparison.effectsCountDelta)}</td></tr>
                <tr><td>{t('multitrack.branchMetricRenderCost')}</td><td>{currentMetrics.renderCostMs === null ? t('multitrack.branchRenderCostUnknown') : `${currentMetrics.renderCostMs} ms`}</td><td>{branchComparison.renderCostMsDelta === null ? t('multitrack.branchDeltaNone') : signedDelta(branchComparison.renderCostMsDelta)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </NeonPanel>

      <NeonPanel variant="dark" padding="none" className="multitrack-timeline-panel knoux-focus-collapsible" style={{ height: timelineHeight }}>
        <div
          className="knoux-timeline-splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('multitrack.monitorTimelineHeight')}
          title={t('multitrack.monitorTimelineHeight')}
          onPointerDown={beginTimelineResize}
        />
        <div className="multitrack-timeline-header">
          <div className="multitrack-track-add">
            <NeonSelect value={newTrackKind} onChange={(value) => setNewTrackKind(value as TrackKind)} options={trackKinds.map((kind) => ({ value: kind, label: t(`multitrack.track_${kind}`) }))} />
            <NeonButton variant="ghost" size="sm" onClick={createNewTrack}>{t('multitrack.addTrack')}</NeonButton>
          </div>
          <label><span>{t('multitrack.zoom')}</span><input type="range" min="0.25" max="4" step="0.25" value={project.settings.timelineZoom} onChange={(event) => commit({ ...project, settings: { ...project.settings, timelineZoom: Number(event.target.value) } })} /></label>
          <strong dir="ltr">{formatTime(playhead)} / {formatTime(duration)}</strong>
        </div>
        <div className="multitrack-timeline-scroll">
          <div className="multitrack-ruler" style={{ width: timelineWidth }}>
            {Array.from({ length: Math.ceil(duration) + 2 }, (_, second) => (
              <span key={second} style={{ left: second * pixelsPerSecond }}>{second}s</span>
            ))}
            <i style={{ left: playhead * pixelsPerSecond }} />
          </div>
          <div className="multitrack-track-stack" style={{ width: timelineWidth }}>
            {orderedTracks.map((track) => (
              <div key={track.id} className={`multitrack-track-row ${selectedTrackId === track.id ? 'selected' : ''}`} data-kind={track.kind}>
                <div className="multitrack-track-controls">
                  <button type="button" onClick={() => { setSelectedTrackId(track.id); setSelectedItemId(null); }}>{trackIcon(track.kind)}<strong>{track.name}</strong></button>
                  <div>
                    <button type="button" onClick={() => patchTrack(track.id, { locked: !track.locked })} title={track.locked ? t('multitrack.unlock') : t('multitrack.lock')}>{track.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
                    <button type="button" onClick={() => patchTrack(track.id, { hidden: !track.hidden })} title={track.hidden ? t('multitrack.show') : t('multitrack.hide')}>{track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    <button type="button" onClick={() => patchTrack(track.id, { muted: !track.muted })} title={track.muted ? t('multitrack.unmute') : t('multitrack.mute')}>{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
                    <button type="button" className={track.solo ? 'active' : ''} onClick={() => patchTrack(track.id, { solo: !track.solo })}>S</button>
                    <button type="button" onClick={() => moveTrackOrder(track.id, -1)} disabled={track.order === 0}><ChevronUp size={13} /></button>
                    <button type="button" onClick={() => moveTrackOrder(track.id, 1)} disabled={track.order === project.tracks.length - 1}><ChevronDown size={13} /></button>
                  </div>
                  {(track.kind === 'audio' || track.kind === 'video') && (
                    <div className="multitrack-track-mixer">
                      <label>V<input type="range" min="0" max="4" step="0.01" value={track.volume} onChange={(event) => patchTrack(track.id, { volume: Number(event.target.value) })} /></label>
                      <label>P<input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => patchTrack(track.id, { pan: Number(event.target.value) })} /></label>
                      <small>{anySoloTrack && !track.solo ? t('multitrack.silencedBySolo') : activeMix.filter((entry) => entry.trackId === track.id).length ? t('multitrack.active') : t('multitrack.inactive')}</small>
                    </div>
                  )}
                </div>
                <div className="multitrack-track-lane" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(track.id, event)} onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const scrollLeft = event.currentTarget.parentElement?.scrollLeft ?? 0;
                  setPlayhead(Math.max(0, Math.min(duration, (event.clientX - bounds.left + scrollLeft) / pixelsPerSecond)));
                }}>
                  {track.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      draggable={!track.locked && !item.locked}
                      onDragStart={() => setDraggedItemId(item.id)}
                      onDragEnd={() => setDraggedItemId(null)}
                      className={`multitrack-item ${selectedItemId === item.id ? 'selected' : ''}`}
                      data-kind={item.kind}
                      style={{ left: item.timelineStart * pixelsPerSecond, width: Math.max(30, item.duration * pixelsPerSecond) }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTrackId(track.id);
                        setSelectedItemId(item.id);
                        setPlayhead(Math.max(item.timelineStart, Math.min(playhead, itemEnd(item))));
                      }}
                    >
                      <strong>{item.name}</strong>
                      <span>{formatTime(item.duration)}</span>
                      {item.transitionIn && <i className="transition-in" title={item.transitionIn.kind} />}
                      {item.transitionOut && <i className="transition-out" title={item.transitionOut.kind} />}
                      {item.keyframes.length > 0 && <em><KeyRound size={11} /> {item.keyframes.length}</em>}
                    </button>
                  ))}
                  <i className="multitrack-playhead" style={{ left: playhead * pixelsPerSecond }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </NeonPanel>
    </section>
  );
};
