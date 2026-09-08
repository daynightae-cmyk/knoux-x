import React, {
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

import { VideoRetouchInspector } from './retouch/VideoRetouchInspector';
import { VideoRetouchPreviewOverlay } from './retouch/VideoRetouchPreviewOverlay';
import {
  attachRetouchAfterTrimIn,
  attachRetouchAfterTrimOut,
  attachRetouchToSplit,
} from './retouch/videoRetouchTimeline';
import type { VideoRetouchClipState } from './retouch/videoRetouchProject';

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
    const [project, setProject] = useState<MultitrackProject | null>(null);
    const [projectPath, setProjectPath] = useState<string | undefined>();
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [playhead, setPlayhead] = useState(0);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recent, setRecent] = useState<string[]>([]);
    const historyRef = useRef<ProjectHistory>({ past: [], future: [] });
    const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

    const duration = useMemo(() => project ? projectDuration(project) : 0, [project]);
    const selectedItem = useMemo(() => selectedItemOf(project, selectedItemId), [project, selectedItemId]);
    const orderedTracks = useMemo(
      () => project ? [...project.tracks].sort((left, right) => left.order - right.order) : [],
      [project],
    );
    const timelineSpan = Math.max(5, duration);

    const activate = useCallback((next: MultitrackProject, filePath?: string, unsaved = false): void => {
      historyRef.current = { past: [], future: [] };
      setProject(structuredClone(next));
      setProjectPath(filePath);
      setSelectedItemId(next.tracks.flatMap((track) => track.items)[0]?.id ?? null);
      setPlayhead(0);
      setDirty(unsaved);
      setError(null);
    }, []);

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

    const createProject = useCallback(async (): Promise<void> => {
      if (busy) return;
      const name = window.prompt('Project name', 'Knoux X Mobile Project')?.trim();
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
    }, [activate, busy]);

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
        const selected = await window.knouxCreativeAPI.media.open();
        if (!selected) return;
        const extension = selected.filePath.split('.').pop()?.toLowerCase() ?? '';
        const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
        let actualKind: 'video' | 'audio' | 'image' = imageExtensions.has(extension) ? 'image' : requestedKind;
        if (actualKind !== 'image') {
          const probe = await window.knouxCreativeAPI.export.probe(selected.filePath);
          const hasVideo = probe.streams?.some((stream) => stream.codec_type === 'video') ?? false;
          const hasAudio = probe.streams?.some((stream) => stream.codec_type === 'audio') ?? false;
          if (requestedKind === 'video' && !hasVideo) throw new Error('Choose a video file.');
          if (requestedKind === 'audio' && !hasAudio) throw new Error('Choose an audio file.');
          actualKind = requestedKind;
        }
        if (requestedKind === 'image' && actualKind !== 'image') throw new Error('Choose an image file.');

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

    const addText = useCallback((): void => {
      if (!project) return;
      const value = window.prompt('Title text', 'Knoux X')?.trim();
      if (!value) return;
      let workingProject = project;
      let track = compatibleTrack(workingProject, 'text');
      if (!track) {
        track = createTrack(crypto.randomUUID(), 'text', 'Titles', workingProject.tracks.length);
        workingProject = addTrack(workingProject, track);
      }
      const item = createTimelineItem({
        id: crypto.randomUUID(),
        trackId: track.id,
        kind: 'text',
        name: value.slice(0, 80),
        timelineStart: playhead,
        duration: 5,
      });
      if (item.text) item.text.text = value;
      commit(insertItem(workingProject, item));
      setSelectedItemId(item.id);
    }, [commit, playhead, project]);

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

    const updatePlayheadFromMedia = useCallback((): void => {
      const media = previewRef.current;
      if (!media || !selectedItem) return;
      const local = Math.max(0, (media.currentTime - selectedItem.sourceIn) / Math.max(0.25, selectedItem.playbackRate));
      setPlayhead(Math.max(selectedItem.timelineStart, Math.min(selectedItem.timelineStart + selectedItem.duration, selectedItem.timelineStart + local)));
    }, [selectedItem]);

    if (!project) {
      return (
        <section className="kmc-mobile-timeline kmc-mobile-timeline--empty" data-component="MobileVideoTimelineEditor">
          <div className="kmc-mobile-start-card">
            <strong>Mobile Timeline</strong>
            <span>Open or create a real Knoux X multitrack project. No desktop editor shell is embedded here.</span>
            <div className="kmc-mobile-start-actions">
              <button type="button" onClick={() => void createProject()} disabled={busy}>New project</button>
              <button type="button" onClick={() => void openProject()} disabled={busy}>Open project</button>
            </div>
            {recent.slice(0, 4).map((entry) => (
              <button key={entry} type="button" className="kmc-mobile-recent" onClick={() => void openRecent(entry)} disabled={busy}>
                {basename(entry)}
              </button>
            ))}
            {error && <p className="kmc-mobile-video-error" role="alert">{error}</p>}
          </div>
        </section>
      );
    }

    return (
      <section className="kmc-mobile-timeline" data-component="MobileVideoTimelineEditor" data-dirty={dirty ? 'true' : 'false'}>
        <div className="kmc-mobile-projectbar">
          <div>
            <strong>{project.name}</strong>
            <span>{dirty ? 'Unsaved changes' : projectPath ? 'Saved' : 'Local project'} · {formatTime(duration)}</span>
          </div>
          <div className="kmc-mobile-project-actions">
            <button type="button" onClick={undo} disabled={historyRef.current.past.length === 0}>Undo</button>
            <button type="button" onClick={redo} disabled={historyRef.current.future.length === 0}>Redo</button>
            <button type="button" onClick={() => void save()} disabled={busy}>Save</button>
          </div>
        </div>

        <div className="kmc-mobile-media-row" aria-label="Add media">
          <button type="button" onClick={() => void addMedia('video')} disabled={busy}>+ Video</button>
          <button type="button" onClick={() => void addMedia('audio')} disabled={busy}>+ Audio</button>
          <button type="button" onClick={() => void addMedia('image')} disabled={busy}>+ Photo</button>
          <button type="button" onClick={addText} disabled={busy}>+ Text</button>
          <button type="button" onClick={deleteSelected} disabled={!selectedItem || busy}>Delete</button>
        </div>

        <div className="kmc-mobile-preview" data-kind={selectedItem?.kind ?? 'none'}>
          {selectedItem && previewUrl && selectedItem.kind === 'video' && (
            <div className="kmc-mobile-preview-media">
              <video
                ref={(node) => { previewRef.current = node; }}
                src={previewUrl}
                controls
                playsInline
                onTimeUpdate={updatePlayheadFromMedia}
              />
              <VideoRetouchPreviewOverlay item={selectedItem} mediaRef={previewRef} playhead={playhead} />
            </div>
          )}
          {selectedItem && previewUrl && selectedItem.kind === 'audio' && (
            <audio
              ref={(node) => { previewRef.current = node; }}
              src={previewUrl}
              controls
              onTimeUpdate={updatePlayheadFromMedia}
            />
          )}
          {selectedItem && previewUrl && selectedItem.kind === 'image' && <img src={previewUrl} alt={selectedItem.name} />}
          {selectedItem?.kind === 'text' && <div className="kmc-mobile-title-preview">{selectedItem.text?.text ?? selectedItem.name}</div>}
          {!selectedItem && <div className="kmc-mobile-preview-empty">Select a clip or add media.</div>}
        </div>

        <div className="kmc-mobile-playhead">
          <span>{formatTime(playhead)}</span>
          <input
            type="range"
            min={0}
            max={timelineSpan}
            step={0.01}
            value={Math.min(playhead, timelineSpan)}
            onChange={(event) => setPlayhead(Number(event.target.value))}
            aria-label="Timeline playhead"
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div className="kmc-mobile-timeline-scroll" aria-label="Mobile multitrack timeline">
          <div className="kmc-mobile-ruler" />
          {orderedTracks.map((track) => (
            <div key={track.id} className="kmc-mobile-track" data-kind={track.kind}>
              <div className="kmc-mobile-track-label">
                <strong>{track.name}</strong>
                <span>{track.kind}</span>
              </div>
              <div className="kmc-mobile-track-lane">
                {track.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === selectedItemId ? 'kmc-mobile-clip is-selected' : 'kmc-mobile-clip'}
                    style={{
                      left: `${Math.max(0, item.timelineStart / timelineSpan) * 100}%`,
                      width: `${Math.max(0.02, item.duration / timelineSpan) * 100}%`,
                    }}
                    onClick={() => {
                      setSelectedItemId(item.id);
                      setPlayhead(item.timelineStart);
                    }}
                    aria-label={`${item.name}, ${formatTime(item.duration)}`}
                  >
                    <strong>{item.name}</strong>
                    <span>{formatTime(item.duration)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="kmc-mobile-playhead-line" style={{ left: `${Math.max(0, playhead / timelineSpan) * 100}%` }} />
        </div>

        {inspectorOpen && selectedItem && (
          <aside className="kmc-mobile-inspector" aria-label="Clip inspector">
            <div className="kmc-mobile-inspector-grid">
              <label>
                Speed
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={selectedItem.playbackRate}
                  onChange={(event) => patchSelectedItem((item) => ({ ...item, playbackRate: Number(event.target.value) }))}
                />
                <span>{selectedItem.playbackRate.toFixed(2)}×</span>
              </label>
              <label>
                Opacity
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedItem.transform.opacity}
                  onChange={(event) => patchSelectedItem((item) => ({
                    ...item,
                    transform: { ...item.transform, opacity: Number(event.target.value) },
                  }))}
                />
                <span>{Math.round(selectedItem.transform.opacity * 100)}%</span>
              </label>
              {(selectedItem.kind === 'audio' || selectedItem.kind === 'video') && (
                <label>
                  Volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedItem.audio.volume}
                    onChange={(event) => patchSelectedItem((item) => ({
                      ...item,
                      audio: { ...item.audio, volume: Number(event.target.value) },
                    }))}
                  />
                  <span>{Math.round(selectedItem.audio.volume * 100)}%</span>
                </label>
              )}
            </div>
            {selectedItem.kind === 'video' && (
              <VideoRetouchInspector
                item={selectedItem}
                sourceUrl={previewUrl}
                fps={project.settings.fps}
                onChange={updateRetouch}
              />
            )}
          </aside>
        )}

        {error && <p className="kmc-mobile-video-error" role="alert">{error}</p>}
      </section>
    );
  },
);

MobileVideoTimelineEditor.displayName = 'MobileVideoTimelineEditor';
