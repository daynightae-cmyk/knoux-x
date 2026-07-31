import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FilePlus2,
  FolderOpen,
  History,
  Link,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import {
  clipDuration,
  EditClip,
  EditHistory,
  EditProject,
  moveClip,
  reflowTimeline,
  splitClip,
  trimClip,
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
  const [playhead, setPlayhead] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [recoverableProjects, setRecoverableProjects] = useState<RecoverableProject[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const historyRef = useRef<EditHistory<EditProject> | null>(null);
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
    setPlayhead(0);
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
  }, [project, replaceProject, selectedClip, totalDuration]);

  const deleteSelected = useCallback((): void => {
    if (!project || !selectedClip) return;
    const ripple = reflowTimeline(project.clips.filter((clip) => clip.id !== selectedClip.id));
    replaceProject({ ...project, clips: ripple });
    setSelectedClipId(ripple[0]?.id ?? null);
    setPlayhead(Math.min(playhead, projectDuration({ ...project, clips: ripple })));
  }, [playhead, project, replaceProject, selectedClip]);

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
            <NeonButton variant="ghost" leftIcon={<Undo2 size={16} />} onClick={undo} disabled={!historyRef.current?.canUndo}>{t('editor.undo')}</NeonButton>
            <NeonButton variant="ghost" leftIcon={<Redo2 size={16} />} onClick={redo} disabled={!historyRef.current?.canRedo}>{t('editor.redo')}</NeonButton>
          </div>

          <div className="editor-workspace">
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
                <span dir="ltr">{formatSeconds(playhead)} / {formatSeconds(totalDuration)}</span>
              </div>
              <div className="editor-timeline" dir="ltr" style={{ '--timeline-duration': Math.max(totalDuration, 1) } as React.CSSProperties}>
                <div className="timeline-playhead" style={{ left: `${totalDuration > 0 ? (playhead / totalDuration) * 100 : 0}%` }} />
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
          </div>
        </>
      )}
    </section>
  );
};
