import { createTimelineItem, insertItem } from '../../core/creative/multitrackProject';

export const RECORDING_EDITOR_HANDOFF_KEY = 'knoux:android:recording-editor-handoff';

/** Save the actual recorded URI as a normal editable project before navigating. */
export async function prepareRecordingEditor(uri: string): Promise<string> {
  const info = await window.knouxAPI.file.getMediaInfo(uri);
  if (!info.duration || info.duration <= 0 || !String(info.format).startsWith('video/')) {
    throw new Error('The recording has no playable video duration. Open it in Player to inspect it.');
  }
  const project = await window.knouxMultitrackAPI.create(info.name || 'Screen recording');
  const track = project.tracks.find((entry) => entry.kind === 'video');
  if (!track) throw new Error('The video editor has no video track.');
  const item = createTimelineItem({ id: crypto.randomUUID(), trackId: track.id, kind: 'video', name: info.name || 'Screen recording', sourcePath: uri, sourceIn: 0, sourceOut: info.duration, timelineStart: 0, duration: info.duration });
  const filePath = await window.knouxMultitrackAPI.save(insertItem(project, item));
  if (!filePath) throw new Error('The recording project could not be saved.');
  localStorage.setItem(RECORDING_EDITOR_HANDOFF_KEY, filePath);
  return filePath;
}
