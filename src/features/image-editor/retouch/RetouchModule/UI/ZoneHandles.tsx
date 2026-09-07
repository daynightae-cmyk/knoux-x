import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import type { BodyControlPoint, BodyZone } from '../Engine/BodyDetector';
import type { Point } from '../Engine/FaceDetector';

/** Four corner-handle positions used for one body zone. */
export interface ZoneHandlePosition {
  id: string;
  point: Point;
}

export interface ZoneHandlesProps {
  zone: BodyZone;
  active: boolean;
  disabled?: boolean;
  /** Called on animation frames while the pointer moves; no React state is required. */
  onDrag(zone: BodyZone, anchor: Point, delta: Point): BodyControlPoint[];
  /** Called after the pointer is released with the last accepted control mesh. */
  onCommit(zone: BodyZone, controlPoints: readonly BodyControlPoint[]): void;
  /** Called when the zone becomes the active editing target. */
  onActivate(zone: BodyZone): void;
}

const CORNER_KEYS = ['0:0', '0:7', '7:7', '7:0'] as const;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function cornerPositions(points: readonly BodyControlPoint[]): ZoneHandlePosition[] {
  const byKey = new Map(points.map((point) => [`${point.row}:${point.column}`, point]));
  return CORNER_KEYS.flatMap((key) => {
    const point = byKey.get(key);
    return point ? [{ id: key, point: { ...point.current } }] : [];
  });
}

function pointerToImage(svg: SVGSVGElement, event: PointerEvent | React.PointerEvent<SVGCircleElement>): Point {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  return {
    x: clamp(viewBox.x + ((event.clientX - rect.left) / width) * viewBox.width, viewBox.x, viewBox.x + viewBox.width),
    y: clamp(viewBox.y + ((event.clientY - rect.top) / height) * viewBox.height, viewBox.y, viewBox.y + viewBox.height),
  };
}

/**
 * SVG corner handles with imperative pointer movement. The visual handle and
 * intensity ring are updated directly during drag; React re-renders only when
 * the editing zone itself changes or a drag is committed.
 */
export const ZoneHandles: React.FC<ZoneHandlesProps> = ({
  zone,
  active,
  disabled = false,
  onDrag,
  onCommit,
  onActivate,
}) => {
  const groupRef = useRef<SVGGElement | null>(null);
  const meshRef = useRef<readonly BodyControlPoint[]>(zone.controlMesh);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ anchor: Point; delta: Point; handleId: string; current: Point } | null>(null);

  useEffect(() => {
    meshRef.current = zone.controlMesh;
  }, [zone]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handles = useMemo(() => cornerPositions(zone.controlMesh), [zone.controlMesh]);

  const updateHandleVisual = useCallback((handleId: string, point: Point, intensity: number): void => {
    const group = groupRef.current;
    if (!group) return;
    const handle = group.querySelector<SVGCircleElement>(`[data-handle-id="${CSS.escape(handleId)}"]`);
    const ring = group.querySelector<SVGCircleElement>(`[data-ring-id="${CSS.escape(handleId)}"]`);
    if (handle) {
      handle.setAttribute('cx', point.x.toFixed(2));
      handle.setAttribute('cy', point.y.toFixed(2));
    }
    if (ring) {
      ring.setAttribute('cx', point.x.toFixed(2));
      ring.setAttribute('cy', point.y.toFixed(2));
      ring.style.opacity = intensity > 0 ? '1' : '0';
      const circumference = 2 * Math.PI * 15;
      ring.style.strokeDasharray = `${circumference}`;
      ring.style.strokeDashoffset = `${circumference * (1 - clamp(intensity, 0, 1))}`;
    }
  }, []);

  const scheduleDrag = useCallback((): void => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingRef.current;
      if (!pending) return;
      meshRef.current = onDrag(zone, pending.anchor, pending.delta);
      const distance = Math.hypot(pending.delta.x, pending.delta.y);
      const maxAxis = Math.max(1, zone.boundingBox.width, zone.boundingBox.height);
      updateHandleVisual(pending.handleId, pending.current, clamp(distance / (maxAxis * 0.18), 0, 1));
    });
  }, [onDrag, updateHandleVisual, zone]);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGCircleElement>, handle: ZoneHandlePosition): void => {
    if (disabled) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    event.preventDefault();
    event.stopPropagation();
    onActivate(zone);
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointerToImage(svg, event);
    const anchor = { ...handle.point };
    meshRef.current = zone.controlMesh;

    const move = (moveEvent: PointerEvent): void => {
      const current = pointerToImage(svg, moveEvent);
      pendingRef.current = {
        anchor,
        delta: { x: current.x - start.x, y: current.y - start.y },
        handleId: handle.id,
        current,
      };
      scheduleDrag();
    };

    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) {
        meshRef.current = onDrag(zone, pending.anchor, pending.delta);
        updateHandleVisual(pending.handleId, pending.current, 0);
      }
      pendingRef.current = null;
      onCommit(zone, meshRef.current);
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }, [disabled, onActivate, onCommit, onDrag, scheduleDrag, updateHandleVisual, zone]);

  if (!active) return null;

  return (
    <g ref={groupRef} className="knoux-retouch-zone-handles" aria-label={`${zone.type} reshape handles`}>
      {handles.map((handle) => (
        <g key={handle.id}>
          <circle
            data-ring-id={handle.id}
            cx={handle.point.x}
            cy={handle.point.y}
            r={15}
            className="knoux-retouch-handle-ring"
            pathLength={100}
          />
          <circle
            data-handle-id={handle.id}
            cx={handle.point.x}
            cy={handle.point.y}
            r={8}
            className="knoux-retouch-handle"
            fill={zone.color}
            tabIndex={0}
            role="slider"
            aria-label={`${zone.type} control handle`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            onPointerDown={(event) => handlePointerDown(event, handle)}
          />
        </g>
      ))}
    </g>
  );
};
