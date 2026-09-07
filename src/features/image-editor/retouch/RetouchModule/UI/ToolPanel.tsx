import React from 'react';

import type { BodyZone } from '../Engine/BodyDetector';
import type { FaceZone } from '../Engine/FaceDetector';

export type ActiveRetouchZone = BodyZone | FaceZone;

export interface ToolPanelProps {
  zone: ActiveRetouchZone | null;
  busy?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onResetPreview(): void;
  onOpenMakeup(): void;
}

function zoneLabel(zone: ActiveRetouchZone | null): string {
  if (!zone) return 'Select a zone';
  const labels: Record<string, string> = {
    lips: 'Lips',
    cheeks: 'Cheeks',
    eyebrows: 'Eyebrows',
    eyes: 'Eyes',
    nose: 'Nose',
    jawline: 'Jawline',
    chest: 'Chest',
    waist: 'Waist',
    hips: 'Hips',
    thighs: 'Thighs',
    arms: 'Arms',
  };
  return labels[zone.type] ?? zone.type;
}

/**
 * Compact mobile inspector for the active semantic region. Every visible action
 * maps to an implemented callback; unsupported tools are intentionally absent.
 */
export const ToolPanel: React.FC<ToolPanelProps> = ({
  zone,
  busy = false,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetPreview,
  onOpenMakeup,
}) => {
  const isFace = zone ? 'faceId' in zone : false;
  const isBody = zone ? 'bodyId' in zone : false;

  return (
    <section className="knoux-retouch-tool-panel" aria-label="Retouch tools">
      <div className="knoux-retouch-panel-title">
        <div>
          <small>{isFace ? 'FACE ZONE' : isBody ? 'BODY ZONE' : 'RETOUCH'}</small>
          <strong>{zoneLabel(zone)}</strong>
        </div>
        {zone && <span className="knoux-retouch-zone-dot" style={{ backgroundColor: zone.color }} />}
      </div>

      <div className="knoux-retouch-tool-actions">
        <button type="button" disabled={!canUndo || busy} onClick={onUndo}>Undo</button>
        <button type="button" disabled={!canRedo || busy} onClick={onRedo}>Redo</button>
        <button type="button" disabled={!zone || busy} onClick={onResetPreview}>Reset preview</button>
        {isFace && (
          <button type="button" className="primary" disabled={busy} onClick={onOpenMakeup}>
            Color &amp; Makeup
          </button>
        )}
      </div>

      {isBody && (
        <p className="knoux-retouch-tool-help">
          Drag any of the four corner handles. KNOUX applies a protected 8×8 mesh warp inside the detected body silhouette.
        </p>
      )}
      {isFace && (
        <p className="knoux-retouch-tool-help">
          Double-tap a face zone to edit localized color. Pixels outside the detected mask remain untouched.
        </p>
      )}
    </section>
  );
};
