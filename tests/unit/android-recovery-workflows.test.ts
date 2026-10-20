/** @jest-environment jsdom */
import { mediaTitle } from '../../src/features/player/mobilePlayerSession';
import { withDeadline } from '../../src/platform/withDeadline';
import { prepareRecordingEditor, RECORDING_EDITOR_HANDOFF_KEY } from '../../src/features/recording/recordingEditorHandoff';
import { createMultitrackProject } from '../../src/core/creative/multitrackProject';

test('provider titles decode paths and hide opaque Android document IDs', () => {
  expect(mediaTitle('content://provider/document/primary%3ADCIM%2F%D8%B1%D8%AD%D9%84%D8%A9.mp4')).toBe('رحلة.mp4');
  expect(mediaTitle('content://media/external/video/media/25405')).toBe('Local media');
  expect(mediaTitle('content://provider/document/video%3A25405')).toBe('Local media');
  expect(mediaTitle('/video/bad%escape.mp4')).toBe('bad%escape.mp4');
});

test('optional work times out, and timely completions clear their timer', async () => {
  jest.useFakeTimers();
  const failed = withDeadline(new Promise(() => undefined), 100, 'unavailable');
  const assertion = expect(failed).rejects.toThrow('unavailable');
  jest.advanceTimersByTime(100);
  await assertion;
  await expect(withDeadline(Promise.resolve('ready'), 100, 'unavailable')).resolves.toBe('ready');
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('recording handoff saves a real editable clip before publishing navigation state', async () => {
  globalThis.structuredClone ??= <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  localStorage.clear();
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'qa-clip' });
  const save = jest.fn().mockResolvedValue('knoux-android://multitrack/qa');
  window.knouxAPI = { file: { getMediaInfo: async () => ({ name: 'screen.mp4', duration: 4, format: 'video/mp4' }) } } as unknown as Window['knouxAPI'];
  window.knouxMultitrackAPI = { create: async () => createMultitrackProject('qa', 'Screen recording'), save } as unknown as Window['knouxMultitrackAPI'];
  await expect(prepareRecordingEditor('content://qa/recording')).resolves.toBe('knoux-android://multitrack/qa');
  expect(save.mock.calls[0][0].tracks[0].items[0]).toMatchObject({ sourcePath: 'content://qa/recording', duration: 4, kind: 'video' });
  expect(localStorage.getItem(RECORDING_EDITOR_HANDOFF_KEY)).toBe('knoux-android://multitrack/qa');
  localStorage.clear();
  save.mockRejectedValueOnce(new Error('Disk full'));
  await expect(prepareRecordingEditor('content://qa/recording')).rejects.toThrow('Disk full');
  expect(localStorage.getItem(RECORDING_EDITOR_HANDOFF_KEY)).toBeNull();
});
