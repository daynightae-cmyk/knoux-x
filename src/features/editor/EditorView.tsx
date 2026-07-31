import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Edit3,
  FilePlus2,
  FolderOpen,
  History,
  Link,
  MapPin,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Video,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import {
  clipDuration,
  clampTimelineZoom,
  EditClip,
  EditHistory,
  EditProject,
  moveClip,
  reflowTimeline,
  removeMarker,
  sourceTimeToTimelineTime,
  splitClip,
  timelineTimeToSourceTime,
  trimClip,
  upsertMarker,
} from '../../core/creative/editProject';
import { useTranslation } from '../../i18n';

interface RecoverableProject {
  project: EditProject;
  filePath: string;
}

function projectDuration(project: EditProject | null): number {
  if (!project || project.clips.length === 0) return 0;
  return Math.max(...project.clips.map((clip) => clip.timelineStart + clipDuration(clip)));
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00.000';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
}

async function readMediaDuration(mediaUrl: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const media = document.createElement('video');
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

export const EditorView: React.FC = () => {
  const [project, setProject] = useState<EditProject | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [recoverableProjects, setRecoverableProjects] = useState<RecoverableProject[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const historyRef = useRef<EditHistory<EditProject> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const { t } = useTranslation();

  const totalDuration = useMemo(() => projectDuration(project), [project]);
  const selectedClip = useMemo(
    () => project?.clips.find((clip) => clip.id === selectedClipId) ?? null,
    [project, selectedClipId],
  );
  const selectedClipIndex = useMemo(
    () => project?.clips.findIndex((clip) => clip.id === selectedClipId) ?? -1,
    [project, selectedClipId],
  );
  const selectedMarker = useMemo(
    () => project?.markers.find((marker) => marker.id === selectedMarkerId) ?? null,
    [project, selectedMarkerId],
  );
  const selectedSourcePath = selectedClip?.sourcePath ?? null;

  const replaceProject = useCallback((next: EditProject, recordHistory = true): void => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    if (recordHistory && historyRef.current) historyRef.current.apply(stamped);
    else historyRef.current = new EditHistory(stamped);
    setProject(stamped);
    setDirty(true);
  }, []);

  const activateProject = useCallback((
    next: EditProject,
    filePath: string | undefined,
    hasUnsavedRecovery = false,
  ): void => {
    historyRef.current = new EditHistory(next);
    setProject(next);
    setProjectPath(filePath);
    setSelectedClipId(next.clips[0]?.id ?? null);
    setSelectedMarkerId(null);
    setPlayhead(0);
    setTimelineZoom(next.settings.timelineZoom);
    setDirty(hasUnsavedRecovery);
  }, []);

  const refreshStartWorkspace = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true);
    try {
      const [recent, recoverable] = await Promise.all([
        window.knouxCreativeAPI.editor.recentProjects(),
        window.knouxCreativeAPI.editor.recoverAutosaves(),
      ]);
      setRecentProjects(recent);
      setRecoverableProjects(recoverable);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.workspaceLoadFailed'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [t]);

  useEffect(() => { void refreshStartWorkspace(); }, [refreshStartWorkspace]);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    setPreviewError(null);
    setIsPreviewPlaying(false);
    if (!selectedSourcePath) return () => { active = false; };
    void window.knouxCreativeAPI.media.toUrl(selectedSourcePath)
      .then((mediaUrl) => {
        if (active) setPreviewUrl(mediaUrl);
      })
      .catch((reason: unknown) => {
        if (active) setPreviewError(reason instanceof Error ? reason.message : t('editor.previewLoadFailed'));
      });
    return () => { active = false; };
  }, [selectedSourcePath, t]);

  useEffect(() => {
    const media = previewRef.current;
    if (!media || !selectedClip || !previewUrl || media.readyState === 0) return;
    const sourceTime = timelineTimeToSourceTime(selectedClip, playhead);
    if (Math.abs(media.currentTime - sourceTime) > 0.12) media.currentTime = sourceTime;
    media.playbackRate = selectedClip.playbackRate;
    media.volume = Math.min(1, Math.max(0, selectedClip.volume));
  }, [playhead, previewUrl, selectedClip]);

  const createNewProject = useCallback(async (): Promise<void> => {
    setError(null);
    const name = window.prompt(t('editor.projectNamePrompt'), t('editor.defaultProject'))?.trim();
    if (!name) return;
    const next = await window.knouxCreativeAPI.editor.createProject(name);
    activateProject(next, undefined);
  }, [activateProject, t]);

  const openProject = useCallback(async (): Promise<void> => {
    setError(null);
    const opened = await window.knouxCreativeAPI.editor.openProject();
    if (!opened) return;
    activateProject(opened.project, opened.filePath);
    await refreshStartWorkspace();
  }, [activateProject, refreshStartWorkspace]);

  const openRecentProject = useCallback(async (filePath: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const opened = await window.knouxCreativeAPI.editor.openRecent(filePath);
      activateProject(opened.project, opened.filePath);
      await refreshStartWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.openRecentFailed'));
    } finally {
      setBusy(false);
    }
  }, [activateProject, refreshStartWorkspace, t]);

  const recoverProject = useCallback((recovery: RecoverableProject): void => {
    activateProject(recovery.project, undefined, true);
  }, [activateProject]);

  const clearRecentProjects = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await window.knouxCreativeAPI.editor.clearRecentProjects();
      setRecentProjects([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.clearRecentFailed'));
    }
  }, [t]);

  const saveProject = useCallback(async (saveAs = false): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    try {
      const savedPath = await window.knouxCreativeAPI.editor.saveProject(project, projectPath, saveAs);
      if (savedPath) {
        setProjectPath(savedPath);
        setDirty(false);
        await refreshStartWorkspace();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, project, projectPath, refreshStartWorkspace, t]);

  useEffect(() => {
    if (!project || !dirty) return undefined;
    const timer = window.setTimeout(() => {
      void window.knouxCreativeAPI.editor.autosave(project).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, project]);

  const addMedia = useCallback(async (): Promise<void> => {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      const duration = await readMediaDuration(selected.mediaUrl);
      const clip: EditClip = {
        id: crypto.randomUUID(),
        sourcePath: selected.filePath,
        sourceIn: 0,
        sourceOut: duration,
        timelineStart: projectDuration(project),
        playbackRate: 1,
        volume: 1,
      };
      replaceProject({ ...project, clips: [...project.clips, clip] });
      setSelectedClipId(clip.id);
      setSelectedMarkerId(null);
      setPlayhead(clip.timelineStart);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.addMediaFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, project, replaceProject, t]);

  const splitSelected = useCallback((): void => {
    if (!project || !selectedClip) return;
    try {
      const [left, right] = splitClip(selectedClip, playhead, crypto.randomUUID());
      const index = project.clips.findIndex((clip) => clip.id === selectedClip.id);
      const clips = [...project.clips];
      clips.splice(index, 1, left, right);
      replaceProject({ ...project, clips });
      setSelectedClipId(right.id);
      setSelectedMarkerId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.splitFailed'));
    }
  }, [playhead, project, replaceProject, selectedClip, t]);

  const updateSelectedRange = useCallback((sourceIn: number, sourceOut: number): void => {
    if (!project || !selectedClip) return;
    try {
      const updated = trimClip(selectedClip, sourceIn, sourceOut);
      replaceProject({
        ...project,
        clips: project.clips.map((clip) => clip.id === updated.id ? updated : clip),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.trimFailed'));
    }
  }, [project, replaceProject, selectedClip, t]);

  const duplicateSelected = useCallback((): void => {
    if (!project || !selectedClip) return;
    const copy: EditClip = {
      ...selectedClip,
      id: crypto.randomUUID(),
      timelineStart: totalDuration,
    };
    replaceProject({ ...project, clips: [...project.clips, copy] });
    setSelectedClipId(copy.id);
    setSelectedMarkerId(null);
  }, [project, replaceProject, selectedClip, totalDuration]);

  const deleteSelected = useCallback((): void => {
    if (!project || !selectedClip) return;
    const ripple = reflowTimeline(project.clips.filter((clip) => clip.id !== selectedClip.id));
    const duration = projectDuration({ ...project, clips: ripple });
    const markers = project.markers.filter((marker) => marker.time <= duration);
    replaceProject({ ...project, clips: ripple, markers });
    setSelectedClipId(ripple[0]?.id ?? null);
    if (selectedMarkerId && !markers.some((marker) => marker.id === selectedMarkerId)) {
      setSelectedMarkerId(null);
    }
    setPlayhead(Math.min(playhead, duration));
  }, [playhead, project, replaceProject, selectedClip, selectedMarkerId]);

  const moveSelected = useCallback((offset: -1 | 1): void => {
    if (!project || !selectedClip) return;
    try {
      replaceProject({ ...project, clips: moveClip(project.clips, selectedClip.id, offset) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.reorderFailed'));
    }
  }, [project, replaceProject, selectedClip, t]);

  const relinkSelected = useCallback(async (): Promise<void> => {
    if (!project || !selectedClip || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      const duration = await readMediaDuration(selected.mediaUrl);
      const sourceIn = Math.min(selectedClip.sourceIn, Math.max(0, duration - 0.001));
      const sourceOut = Math.min(selectedClip.sourceOut, duration);
      const safeRange = sourceOut > sourceIn
        ? { sourceIn, sourceOut }
        : { sourceIn: 0, sourceOut: duration };
      replaceProject({
        ...project,
        clips: project.clips.map((clip) => clip.id === selectedClip.id
          ? { ...clip, sourcePath: selected.filePath, ...safeRange }
          : clip),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.relinkFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, project, replaceProject, selectedClip, t]);

  const addMarkerAtPlayhead = useCallback((): void => {
    if (!project) return;
    const defaultLabel = `${t('editor.markerDefault')} ${project.markers.length + 1}`;
    const label = window.prompt(t('editor.markerNamePrompt'), defaultLabel)?.trim();
    if (!label) return;
    try {
      const marker = { id: crypto.randomUUID(), time: Math.min(playhead, totalDuration), label };
      replaceProject({
        ...project,
        markers: upsertMarker(project.markers, marker, totalDuration),
      });
      setSelectedMarkerId(marker.id);
      setSelectedClipId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.markerFailed'));
    }
  }, [playhead, project, replaceProject, t, totalDuration]);

  const renameSelectedMarker = useCallback((): void => {
    if (!project || !selectedMarker) return;
    const label = window.prompt(t('editor.markerNamePrompt'), selectedMarker.label)?.trim();
    if (!label) return;
    try {
      replaceProject({
        ...project,
        markers: upsertMarker(project.markers, { ...selectedMarker, label }, totalDuration),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.markerFailed'));
    }
  }, [project, replaceProject, selectedMarker, t, totalDuration]);

  const deleteSelectedMarker = useCallback((): void => {
    if (!project || !selectedMarker) return;
    try {
      replaceProject({
        ...project,
        markers: removeMarker(project.markers, selectedMarker.id),
      });
      setSelectedMarkerId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('editor.markerFailed'));
    }
  }, [project, replaceProject, selectedMarker, t]);

  const changeTimelineZoom = useCallback((next: number): void => {
    const zoom = clampTimelineZoom(next);
    setTimelineZoom(zoom);
    if (project && project.settings.timelineZoom !== zoom) {
      replaceProject({ ...project, settings: { ...project.settings, timelineZoom: zoom } });
    }
  }, [project, replaceProject]);

  const togglePreview = useCallback(async (): Promise<void> => {
    const media = previewRef.current;
    if (!media || !selectedClip) return;
    try {
      if (!media.paused) {
        media.pause();
        return;
      }
      if (media.currentTime >= selectedClip.sourceOut - 0.01) {
        media.currentTime = selectedClip.sourceIn;
        setPlayhead(selectedClip.timelineStart);
      }
      await media.play();
    } catch (reason) {
      setPreviewError(reason instanceof Error ? reason.message : t('editor.previewPlayFailed'));
    }
  }, [selectedClip, t]);

  const nudgePreview = useCallback((seconds: number): void => {
    if (!selectedClip) return;
    const start = selectedClip.timelineStart;
    const end = start + clipDuration(selectedClip);
    setPlayhead((current) => Math.min(end, Math.max(start, current + seconds)));
  }, [selectedClip]);

  const handlePreviewTimeUpdate = useCallback((): void => {
    const media = previewRef.current;
    if (!media || !selectedClip) return;
    if (media.currentTime >= selectedClip.sourceOut - 0.01) {
      media.pause();
      media.currentTime = selectedClip.sourceOut;
      setPlayhead(selectedClip.timelineStart + clipDuration(selectedClip));
      setIsPreviewPlaying(false);
      return;
    }
    setPlayhead(sourceTimeToTimelineTime(selectedClip, media.currentTime));
  }, [selectedClip]);

  const undo = useCallback((): void => {
    if (!historyRef.current?.canUndo) return;
    const previous = historyRef.current.undo();
    setProject(previous);
    setDirty(true);
  }, []);

  const redo = useCallback((): void => {
    if (!historyRef.current?.canRedo) return;
    const next = historyRef.current.redo();
    setProject(next);
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(
        target?.isContentEditable
        || target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT',
      );
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && key === 's') {
        event.preventDefault();
        void saveProject(event.shiftKey);
        return;
      }
      if (isEditing) return;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (!modifier && key === 'm') {
        event.preventDefault();
        if (event.shiftKey) renameSelectedMarker();
        else addMarkerAtPlayhead();
        return;
      }
      if (!modifier && key === 's') {
        event.preventDefault();
        splitSelected();
        return;
      }
      if (!modifier && event.code === 'Space') {
        event.preventDefault();
        void togglePreview();
        return;
      }
      if (!modifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (selectedMarker) deleteSelectedMarker();
        else deleteSelected();
        return;
      }
      if (!modifier && (event.code === 'Equal' || event.code === 'NumpadAdd')) {
        event.preventDefault();
        changeTimelineZoom(timelineZoom + 0.25);
        return;
      }
      if (!modifier && (event.code === 'Minus' || event.code === 'NumpadSubtract')) {
        event.preventDefault();
        changeTimelineZoom(timelineZoom - 0.25);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    addMarkerAtPlayhead,
    changeTimelineZoom,
    deleteSelected,
    deleteSelectedMarker,
    project,
    redo,
    renameSelectedMarker,
    saveProject,
    selectedMarker,
    splitSelected,
    timelineZoom,
    togglePreview,
    undo,
  ]);

  return (
    <section className="creative-view editor-view" aria-labelledby="editor-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('editor.eyebrow')}</span>
          <h1 id="editor-title"><Scissors size={30} /> {t('editor.title')}</h1>
          <p>{t('editor.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FilePlus2 size={16} />} onClick={() => void createNewProject()}>{t('common.new')}</NeonButton>
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openProject()}>{t('common.open')}</NeonButton>
          <NeonButton variant="secondary" leftIcon={<Save size={16} />} onClick={() => void saveProject(false)} disabled={!project || !dirty || busy}>{t('common.save')}</NeonButton>
          <NeonButton variant="primary" onClick={() => void saveProject(true)} disabled={!project || busy}>{t('common.saveAs')}</NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Persistent .knouxedit projects" featureAr="مشروعات .knouxedit الدائمة" />

      {error && <div className="creative-error" role="alert">{error}</div>}

      {!project ? (
        <div className="editor-start-workspace">
          <NeonPanel variant="dark" padding="lg">
            <div className="creative-empty-hint">
              <Scissors size={42} />
              <div><strong>{t('editor.emptyTitle')}</strong><span>{t('editor.emptyDescription')}</span></div>
            </div>
          </NeonPanel>

          {workspaceLoading ? (
            <div className="creative-loading">{t('editor.workspaceLoading')}</div>
          ) : (
            <div className="editor-start-grid">
              <NeonPanel variant="dark" padding="md">
                <div className="editor-start-heading">
                  <div>
                    <h2><History size={18} /> {t('editor.recoveries')}</h2>
                    <span>{t('editor.recoveriesDescription')}</span>
                  </div>
                  <strong>{recoverableProjects.length}</strong>
                </div>
                {recoverableProjects.length === 0 ? (
                  <div className="creative-empty">{t('editor.noRecoveries')}</div>
                ) : (
                  <div className="editor-start-list">
                    {recoverableProjects.map((recovery) => (
                      <button
                        key={recovery.filePath}
                        type="button"
                        className="editor-start-card"
                        onClick={() => recoverProject(recovery)}
                        disabled={busy}
                      >
                        <strong>{recovery.project.name}</strong>
                        <span dir="auto">{recovery.filePath}</span>
                        <small>{new Date(recovery.project.updatedAt).toLocaleString()}</small>
                      </button>
                    ))}
                  </div>
                )}
              </NeonPanel>

              <NeonPanel variant="dark" padding="md">
                <div className="editor-start-heading">
                  <div>
                    <h2><FolderOpen size={18} /> {t('editor.recentProjects')}</h2>
                    <span>{t('editor.recentProjectsDescription')}</span>
                  </div>
                  {recentProjects.length > 0 && (
                    <NeonButton variant="ghost" size="sm" onClick={() => void clearRecentProjects()}>
                      {t('editor.clearRecent')}
                    </NeonButton>
                  )}
                </div>
                {recentProjects.length === 0 ? (
                  <div className="creative-empty">{t('editor.noRecentProjects')}</div>
                ) : (
                  <div className="editor-start-list">
                    {recentProjects.map((filePath) => (
                      <button
                        key={filePath}
                        type="button"
                        className="editor-start-card"
                        onClick={() => void openRecentProject(filePath)}
                        disabled={busy}
                      >
                        <strong dir="auto">{filePath.split(/[\\/]/).pop()}</strong>
                        <span dir="auto">{filePath}</span>
                      </button>
                    ))}
                  </div>
                )}
              </NeonPanel>
            </div>
          )}
        </div>
      ) : (
        <>
          <NeonPanel variant="dark" padding="md">
            <div className="editor-project-bar">
              <label>
                <span>{t('editor.project')}</span>
                <input value={project.name} onChange={(event) => replaceProject({ ...project, name: event.target.value })} />
              </label>
              <div><strong>{project.clips.length}</strong><span> {t('editor.clips')}</span></div>
              <div><strong>{formatSeconds(totalDuration)}</strong><span> {t('editor.duration')}</span></div>
              <div className={dirty ? 'dirty-status active' : 'dirty-status'}>{dirty ? t('editor.unsaved') : t('editor.saved')}</div>
            </div>
          </NeonPanel>

          <div className="editor-toolbar">
            <NeonButton variant="primary" leftIcon={<Video size={16} />} onClick={() => void addMedia()} disabled={busy}>{t('editor.addMedia')}</NeonButton>
            <NeonButton variant="secondary" leftIcon={<Scissors size={16} />} onClick={splitSelected} disabled={!selectedClip}>{t('editor.split')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Copy size={16} />} onClick={duplicateSelected} disabled={!selectedClip}>{t('editor.duplicate')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Trash2 size={16} />} onClick={deleteSelected} disabled={!selectedClip}>{t('editor.rippleDelete')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => moveSelected(-1)} disabled={selectedClipIndex <= 0}>{t('editor.moveEarlier')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<ArrowRight size={16} />} onClick={() => moveSelected(1)} disabled={selectedClipIndex < 0 || selectedClipIndex >= project.clips.length - 1}>{t('editor.moveLater')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Link size={16} />} onClick={() => void relinkSelected()} disabled={!selectedClip || busy}>{t('editor.relink')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<MapPin size={16} />} onClick={addMarkerAtPlayhead}>{t('editor.addMarker')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Edit3 size={16} />} onClick={renameSelectedMarker} disabled={!selectedMarker}>{t('editor.renameMarker')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Trash2 size={16} />} onClick={deleteSelectedMarker} disabled={!selectedMarker}>{t('editor.deleteMarker')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Undo2 size={16} />} onClick={undo} disabled={!historyRef.current?.canUndo}>{t('editor.undo')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Redo2 size={16} />} onClick={redo} disabled={!historyRef.current?.canRedo}>{t('editor.redo')}</NeonButton>
          </div>

          <div className="editor-workspace">
            <NeonPanel variant="dark" padding="md" className="editor-preview">
              <div className="editor-preview-heading">
                <div>
                  <h2><Play size={18} /> {t('editor.preview')}</h2>
                  <span>{t('editor.previewDescription')}</span>
                </div>
                {selectedClip && <strong dir="auto">{selectedClip.sourcePath.split(/[\\/]/).pop()}</strong>}
              </div>
              {selectedClip ? (
                <div className="editor-preview-stage">
                  {previewUrl ? (
                    <video
                      ref={previewRef}
                      src={previewUrl}
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(event) => {
                        event.currentTarget.currentTime = timelineTimeToSourceTime(selectedClip, playhead);
                        event.currentTarget.playbackRate = selectedClip.playbackRate;
                        event.currentTarget.volume = Math.min(1, Math.max(0, selectedClip.volume));
                      }}
                      onTimeUpdate={handlePreviewTimeUpdate}
                      onPlay={() => setIsPreviewPlaying(true)}
                      onPause={() => setIsPreviewPlaying(false)}
                      onError={() => setPreviewError(t('editor.previewDecodeFailed'))}
                    />
                  ) : (
                    <div className="editor-preview-loading">{previewError ?? t('editor.previewLoading')}</div>
                  )}
                  <div className="editor-preview-controls">
                    <button type="button" onClick={() => nudgePreview(-1)} aria-label={t('editor.previewBack')} title={t('editor.previewBack')}>
                      <SkipBack size={17} />
                    </button>
                    <button type="button" className="primary" onClick={() => void togglePreview()} disabled={!previewUrl} aria-label={isPreviewPlaying ? t('editor.previewPause') : t('editor.previewPlay')}>
                      {isPreviewPlaying ? <Pause size={19} /> : <Play size={19} />}
                    </button>
                    <button type="button" onClick={() => nudgePreview(1)} aria-label={t('editor.previewForward')} title={t('editor.previewForward')}>
                      <SkipForward size={17} />
                    </button>
                    <span dir="ltr">{formatSeconds(playhead)} / {formatSeconds(totalDuration)}</span>
                  </div>
                  {previewError && <div className="editor-preview-error" role="alert">{previewError}</div>}
                </div>
              ) : (
                <div className="creative-empty">{t('editor.previewSelectClip')}</div>
              )}
            </NeonPanel>

            <NeonPanel variant="dark" padding="md" className="editor-inspector">
              <h2>{t('editor.inspector')}</h2>
              {selectedClip ? (
                <div className="creative-form-grid">
                  <label><span>{t('editor.sourceIn')}</span><input type="number" step="0.001" min={0} value={selectedClip.sourceIn} onChange={(event) => updateSelectedRange(Number(event.target.value), selectedClip.sourceOut)} /></label>
                  <label><span>{t('editor.sourceOut')}</span><input type="number" step="0.001" min={selectedClip.sourceIn} value={selectedClip.sourceOut} onChange={(event) => updateSelectedRange(selectedClip.sourceIn, Number(event.target.value))} /></label>
                  <label><span>{t('editor.playbackRate')}</span><input type="number" step="0.05" min={0.1} max={8} value={selectedClip.playbackRate} onChange={(event) => replaceProject({ ...project, clips: project.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, playbackRate: Number(event.target.value) } : clip) })} /></label>
                  <label><span>{t('editor.volume')}</span><input type="number" step="0.05" min={0} max={2} value={selectedClip.volume} onChange={(event) => replaceProject({ ...project, clips: project.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, volume: Number(event.target.value) } : clip) })} /></label>
                  <div className="inspector-path" title={selectedClip.sourcePath} dir="auto">{selectedClip.sourcePath}</div>
                </div>
              ) : <div className="creative-empty">{t('editor.selectClip')}</div>}
            </NeonPanel>

            <div className="editor-timeline-panel">
              <div className="timeline-ruler">
                <label>{t('editor.playhead')} <input type="number" min={0} max={totalDuration} step="0.001" value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} /></label>
                <div className="timeline-ruler-controls">
                  <span dir="ltr">{formatSeconds(playhead)} / {formatSeconds(totalDuration)}</span>
                  <button type="button" onClick={() => changeTimelineZoom(timelineZoom - 0.25)} disabled={timelineZoom <= 1} aria-label={t('editor.zoomOut')} title={t('editor.zoomOut')}>
                    <ZoomOut size={16} />
                  </button>
                  <output aria-label={t('editor.timelineZoom')}>{Math.round(timelineZoom * 100)}%</output>
                  <button type="button" onClick={() => changeTimelineZoom(timelineZoom + 0.25)} disabled={timelineZoom >= 8} aria-label={t('editor.zoomIn')} title={t('editor.zoomIn')}>
                    <ZoomIn size={16} />
                  </button>
                </div>
              </div>
              <div className="editor-timeline-scroll">
                <div
                  className="editor-timeline"
                  dir="ltr"
                  style={{
                    '--timeline-duration': Math.max(totalDuration, 1),
                    width: `${timelineZoom * 100}%`,
                  } as React.CSSProperties}
                >
                  <div className="timeline-playhead" style={{ left: `${totalDuration > 0 ? (playhead / totalDuration) * 100 : 0}%` }} />
                  {project.markers.map((marker) => (
                    <button
                      key={marker.id}
                      type="button"
                      className={`timeline-marker ${marker.id === selectedMarkerId ? 'selected' : ''}`}
                      style={{ left: `${totalDuration > 0 ? (marker.time / totalDuration) * 100 : 0}%` }}
                      onClick={() => {
                        setSelectedMarkerId(marker.id);
                        setSelectedClipId(null);
                        setPlayhead(marker.time);
                      }}
                      aria-label={t('editor.markerAt', { label: marker.label, time: formatSeconds(marker.time) })}
                      title={`${marker.label} — ${formatSeconds(marker.time)}`}
                    >
                      <MapPin size={15} />
                      <span>{marker.label}</span>
                    </button>
                  ))}
                  {project.clips.map((clip, index) => (
                    <button
                      key={clip.id}
                      type="button"
                      className={`timeline-clip ${clip.id === selectedClipId ? 'selected' : ''}`}
                      style={{
                        left: `${totalDuration > 0 ? (clip.timelineStart / totalDuration) * 100 : 0}%`,
                        width: `${totalDuration > 0 ? (clipDuration(clip) / totalDuration) * 100 : 100}%`,
                      }}
                      onClick={() => {
                        setSelectedClipId(clip.id);
                        setSelectedMarkerId(null);
                        setPlayhead(clip.timelineStart + clipDuration(clip) / 2);
                      }}
                      title={clip.sourcePath}
                    >
                      <strong>{index + 1}</strong>
                      <span>{clip.sourcePath.split(/[\\/]/).pop()}</span>
                      <small>{formatSeconds(clipDuration(clip))}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="editor-timeline-footer">
                <span>{t('editor.markersCount', { count: project.markers.length })}</span>
                <span>{selectedMarker ? `${selectedMarker.label} — ${formatSeconds(selectedMarker.time)}` : t('editor.noMarkerSelected')}</span>
                <small>{t('editor.shortcutsHint')}</small>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
