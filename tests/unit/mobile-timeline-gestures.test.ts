import { draggedTimelineStart, changeClipSpeed } from '../../src/features/video-studio/mobileTimelineGestures';
import { createTimelineItem } from '../../src/core/creative/multitrackProject';

test('touch movement maps lane pixels to frame-aligned time and clamps at zero', () => {
  expect(draggedTimelineStart(2, 100, 400, 8, 24)).toBe(4);
  expect(draggedTimelineStart(2, -200, 400, 8, 24)).toBe(0);
  expect(draggedTimelineStart(2, 100, 800, 8, 24)).toBe(3);
  expect(draggedTimelineStart(2, 100, 0, 8, 24)).toBe(2);
});
test('speed changes preserve source trim boundaries and update timeline duration', () => {
  const item = createTimelineItem({ id: 'clip', trackId: 'video', kind: 'video', name: 'clip', duration: 6, sourceIn: 2, sourceOut: 8, timelineStart: 0 });
  const faster = changeClipSpeed(item, 2);
  expect(faster).toMatchObject({ duration: 3, sourceIn: 2, sourceOut: 8, playbackRate: 2 });
  expect(changeClipSpeed(faster, 0.5).duration).toBe(12);
});
