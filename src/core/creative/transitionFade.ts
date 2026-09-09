/**
 * KNOUX-X — TRANSITION FADE (shared timeline fade semantic)
 *
 * A single honest semantic for item transitions across every surface:
 * a transition with a positive duration fades the item in (transitionIn)
 * or out (transitionOut) over its duration. The mobile timeline renderer
 * bakes this into exported frames; the desktop program monitor applies it
 * to the preview element. One function, one behavior, unit-tested.
 */

import type { TimelineTransition } from './multitrackProject';

export function transitionFadeOpacity(
  baseOpacity: number,
  transitionIn: TimelineTransition | null | undefined,
  transitionOut: TimelineTransition | null | undefined,
  localTime: number,
  duration: number,
): number {
  const base = Number.isFinite(baseOpacity) ? baseOpacity : 1;
  let opacity = base;
  if (transitionIn && transitionIn.duration > 0) {
    opacity *= Math.min(1, Math.max(0, localTime) / transitionIn.duration);
  }
  if (transitionOut && transitionOut.duration > 0) {
    const remaining = duration - localTime;
    opacity *= Math.min(1, Math.max(0, remaining) / transitionOut.duration);
  }
  return Math.max(0, Math.min(1, opacity));
}
