import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * KNOUX X shared responsive media-fit geometry.
 *
 * Measures the real available stage box (after sidebars, inspector, timeline
 * and padding are laid out) with a ResizeObserver and sizes the media frame
 * so the image/video dominates the preview area while preserving aspect
 * ratio. Display zoom never mutates the project transform.
 */

export type MediaViewportMode = 'fit' | 'fill' | 'actual' | number;

export interface MediaViewportSource {
  width: number;
  height: number;
}

export interface MediaViewportBox {
  width: number;
  height: number;
}

export interface MediaViewportFit {
  /** Ref to attach to the stage container element. */
  stageRef: React.RefObject<HTMLDivElement>;
  /** Measured available stage size in CSS pixels. */
  stage: MediaViewportBox;
  /** Display size of the media frame in CSS pixels. */
  frame: MediaViewportBox;
  /** object-fit value matching the active mode. */
  objectFit: 'contain' | 'cover';
  /** True when the fitted frame overflows the stage (zoomed). */
  overflows: boolean;
  /**
   * Map a point in stage client pixels to media source pixels.
   * Returns null when the point falls outside the media frame.
   */
  stageToSource(clientX: number, clientY: number, stageRect: DOMRect): { x: number; y: number } | null;
  /**
   * Map media source pixels to project coordinates for a project frame of
   * the given size. Pure math: screen -> preview -> project -> source.
   */
  sourceToProject(
    source: { x: number; y: number },
    projectSize: MediaViewportSource,
  ): { x: number; y: number };
}

export function resolveMediaFrame(
  stage: MediaViewportBox,
  media: MediaViewportSource,
  mode: MediaViewportMode,
): MediaViewportBox {
  if (stage.width <= 0 || stage.height <= 0 || media.width <= 0 || media.height <= 0) {
    return { width: 0, height: 0 };
  }
  const fitScale = Math.min(stage.width / media.width, stage.height / media.height);
  if (mode === 'fill') {
    const coverScale = Math.max(stage.width / media.width, stage.height / media.height);
    return { width: media.width * coverScale, height: media.height * coverScale };
  }
  if (mode === 'fit') {
    return { width: media.width * fitScale, height: media.height * fitScale };
  }
  if (mode === 'actual') {
    // One source pixel maps to one preview pixel; overflows scroll.
    return { width: media.width, height: media.height };
  }
  const percent = Math.max(5, Math.min(800, mode)) / 100;
  // Percent zoom is relative to the fitted size so 100% means "as large as
  // the stage allows", and larger values intentionally overflow with scroll.
  return { width: media.width * fitScale * percent, height: media.height * fitScale * percent };
}

export function resolveObjectFit(mode: MediaViewportMode): 'contain' | 'cover' {
  return mode === 'fill' ? 'cover' : 'contain';
}

export function useMediaViewportFit(
  media: MediaViewportSource | null,
  mode: MediaViewportMode,
  stagePadding = 0,
): MediaViewportFit {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<MediaViewportBox>({ width: 0, height: 0 });

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      setStage((current) => {
        const next = {
          width: Math.max(0, rect.width - stagePadding * 2),
          height: Math.max(0, rect.height - stagePadding * 2),
        };
        if (Math.abs(next.width - current.width) < 1 && Math.abs(next.height - current.height) < 1) {
          return current;
        }
        return next;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stagePadding]);

  const frame = media ? resolveMediaFrame(stage, media, mode) : { width: 0, height: 0 };
  const objectFit = resolveObjectFit(mode);
  const overflows = frame.width > stage.width + 1 || frame.height > stage.height + 1;

  const stageToSource = useCallback(
    (clientX: number, clientY: number, stageRect: DOMRect): { x: number; y: number } | null => {
      if (!media || frame.width <= 0 || frame.height <= 0) return null;
      const frameLeft = stageRect.left + (stageRect.width - frame.width) / 2;
      const frameTop = stageRect.top + (stageRect.height - frame.height) / 2;
      const localX = clientX - frameLeft;
      const localY = clientY - frameTop;
      if (localX < 0 || localY < 0 || localX > frame.width || localY > frame.height) return null;
      return { x: (localX / frame.width) * media.width, y: (localY / frame.height) * media.height };
    },
    [media, frame.width, frame.height],
  );

  const sourceToProject = useCallback(
    (source: { x: number; y: number }, projectSize: MediaViewportSource): { x: number; y: number } => {
      if (!media || media.width <= 0 || media.height <= 0) return { x: 0, y: 0 };
      return {
        x: (source.x / media.width) * projectSize.width,
        y: (source.y / media.height) * projectSize.height,
      };
    },
    [media],
  );

  return { stageRef, stage, frame, objectFit, overflows, stageToSource, sourceToProject };
}
