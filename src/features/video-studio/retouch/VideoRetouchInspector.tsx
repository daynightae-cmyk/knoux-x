import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ScanFace, Sparkles, X } from 'lucide-react';

import type { TimelineItem } from '../../../core/creative/multitrackProject';
import { retouchTemplateRegistry } from '../../image-editor/retouch/RetouchModule/Templates/TemplateRegistry';
import type { RetouchTemplate } from '../../image-editor/retouch/RetouchModule/Templates/TemplateTypes';

import { VideoRetouchAnalyzer } from './VideoRetouchAnalyzer';
import {
  addVideoRetouchLayer,
  ensureVideoRetouchState,
  removeVideoRetouchLayer,
  resetVideoRetouch,
  updateVideoRetouchLayer,
  type VideoRetouchCategory,
  type VideoRetouchClipState,
  type VideoRetouchRegion,
} from './videoRetouchProject';
import './videoRetouch.css';

export interface VideoRetouchInspectorProps {
  item: TimelineItem;
  sourceUrl: string | null;
  fps: number;
  onChange(state: VideoRetouchClipState): void;
  mode?: import('../../../core/creative/videoRetouchTemporal').VideoRetouchAnalysisMode;
  playheadTime?: number | null;
  priorityWindowSeconds?: number;
  maxAnalysisSamples?: number;
  enableBodyTracking?: boolean;
  bodyModelReader?: () => Promise<{ status: string; modelId: string; reason?: string; buffer?: Uint8Array }> | null;
  sharedCache?: { has(timestamp: number): boolean; get(timestamp: number): unknown; nearest?(timestamp: number, maxDistance: number): unknown; stats?(): unknown; set?(timestamp: number, faces: unknown, meta?: { elapsedMs?: number; modelId?: string }): void; dispose?(): void };
}

type SupportedCategory = 'lipstick' | 'blush';

const SUPPORTED_CATEGORIES: readonly SupportedCategory[] = ['lipstick', 'blush'];

function isArabic(): boolean {
  return document.documentElement.dir === 'rtl' || document.documentElement.lang.toLowerCase().startsWith('ar');
}

function displayName(template: RetouchTemplate): string {
  return isArabic() ? template.localizedName.ar : template.localizedName.en;
}

function stateOf(item: TimelineItem): VideoRetouchClipState {
  return ensureVideoRetouchState(item);
}

function supportedTemplate(template: RetouchTemplate): template is RetouchTemplate & { category: SupportedCategory } {
  return SUPPORTED_CATEGORIES.includes(template.category as SupportedCategory);
}

/**
 * Clip-scoped Retouch inspector. Analysis runs automatically once per source
 * revision, while project persistence receives only accepted/final analysis
 * state rather than hundreds of transient progress snapshots.
 */
export const VideoRetouchInspector: React.FC<VideoRetouchInspectorProps> = ({
  item, sourceUrl, fps, onChange,
  mode, playheadTime, priorityWindowSeconds, maxAnalysisSamples,
  enableBodyTracking, bodyModelReader, sharedCache,
}) => {
  const [category, setCategory] = useState<SupportedCategory>('lipstick');
  const [workingAnalysis, setWorkingAnalysis] = useState<VideoRetouchClipState>(() => stateOf(item));
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const analyzerRef = useRef(new VideoRetouchAnalyzer());
  const abortRef = useRef<AbortController | null>(null);
  const automaticKeyRef = useRef<string | null>(null);

  const persisted = useMemo(() => stateOf(item), [item]);
  const displayState = analysisBusy ? workingAnalysis : persisted;
  const templates = useMemo(
    () => retouchTemplateRegistry.byCategory(category, 'video').filter(supportedTemplate),
    [category],
  );
  const activeLayers = displayState.layers.filter((layer) => layer.active);

  const analyze = useCallback(async (automatic = false): Promise<void> => {
    if (!sourceUrl || item.kind !== 'video' || analysisBusy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAnalysisBusy(true);
    setWorkingAnalysis(persisted);
    const result = await analyzerRef.current.analyze({
      sourceUrl,
      sourceIn: item.sourceIn,
      duration: item.duration,
      playbackRate: item.playbackRate,
      fps,
      state: persisted,
      signal: controller.signal,
      onProgress: setWorkingAnalysis,
      ...(mode !== undefined ? { mode } : {}),
      ...(playheadTime !== undefined && playheadTime !== null ? { playheadTime: Number(playheadTime) } : {}),
      ...(priorityWindowSeconds !== undefined ? { priorityWindowSeconds: Number(priorityWindowSeconds) } : {}),
      ...(maxAnalysisSamples !== undefined ? { maxAnalysisSamples: Number(maxAnalysisSamples) } : {}),
      ...(enableBodyTracking !== undefined ? { enableBodyTracking: Boolean(enableBodyTracking) } : {}),
      ...(bodyModelReader !== undefined ? { bodyModelReader: bodyModelReader ?? null } : {}),
      ...(sharedCache !== undefined ? { cache: sharedCache } : {}),
    });
    if (!controller.signal.aborted) {
      setWorkingAnalysis(result);
      onChange(result);
    }
    if (!automatic || !controller.signal.aborted) setAnalysisBusy(false);
  }, [analysisBusy, fps, item.duration, item.kind, item.playbackRate, item.sourceIn, onChange, persisted, sourceUrl, bodyModelReader, sharedCache, mode, playheadTime, priorityWindowSeconds, maxAnalysisSamples, enableBodyTracking]);

  useEffect(() => {
    if (!sourceUrl || item.kind !== 'video') return;
    const revisionKey = `${item.id}:${item.sourcePath ?? ''}:${item.sourceIn}:${item.sourceOut}:${item.playbackRate}`;
    const needsAnalysis = persisted.faceTracks.length === 0
      && ['idle', 'failed', 'no-face', 'cancelled'].includes(persisted.analysis.status);
    if (!needsAnalysis || automaticKeyRef.current === revisionKey) return;
    automaticKeyRef.current = revisionKey;
    void analyze(true);
  }, [analyze, item.id, item.kind, item.playbackRate, item.sourceIn, item.sourceOut, item.sourcePath, persisted.analysis.status, persisted.faceTracks.length, sourceUrl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const applyTemplate = useCallback((template: RetouchTemplate & { category: SupportedCategory }): void => {
    const current = stateOf(item);
    const next = addVideoRetouchLayer(current, {
      templateId: template.id,
      category: template.category as VideoRetouchCategory,
      targetRegion: template.targetRegion as VideoRetouchRegion,
      parameters: { ...template.parameters },
      strength: template.defaultIntensity,
      trackingRequired: template.trackingRequired,
      faceId: current.applyAllFaces ? null : current.selectedFaceId,
      applyScope: 'clip',
      maskStrategy: template.maskStrategy,
      blendMode: template.blendMode,
    });
    onChange(next);
  }, [item, onChange]);

  const toggleEnabled = useCallback((): void => {
    const next = stateOf(item);
    next.enabled = !next.enabled;
    next.updatedAt = new Date().toISOString();
    onChange(next);
  }, [item, onChange]);

  const toggleBeforeAfter = useCallback((): void => {
    const next = stateOf(item);
    next.beforeAfter = next.beforeAfter === 'after' ? 'before' : 'after';
    next.updatedAt = new Date().toISOString();
    onChange(next);
  }, [item, onChange]);

  const toggleAllFaces = useCallback((): void => {
    const next = stateOf(item);
    next.applyAllFaces = !next.applyAllFaces;
    next.updatedAt = new Date().toISOString();
    onChange(next);
  }, [item, onChange]);

  const selectFace = useCallback((faceId: string): void => {
    const next = stateOf(item);
    next.selectedFaceId = faceId;
    next.applyAllFaces = false;
    next.updatedAt = new Date().toISOString();
    onChange(next);
  }, [item, onChange]);

  const resetAll = useCallback((): void => {
    abortRef.current?.abort();
    setAnalysisBusy(false);
    const next = resetVideoRetouch(stateOf(item));
    onChange(next);
    automaticKeyRef.current = null;
  }, [item, onChange]);

  if (item.kind !== 'video') return null;

  return (
    <section className="video-retouch-inspector" data-component="VideoRetouchInspector">
      <div className="video-retouch-inspector__heading">
        <div><Sparkles size={17} /><strong>Retouch</strong></div>
        <div className="video-retouch-heading-actions">
          <button type="button" onClick={toggleBeforeAfter} title="Before / After">
            {displayState.beforeAfter === 'after' ? <Eye size={15} /> : <EyeOff size={15} />}
            {displayState.beforeAfter === 'after' ? 'After' : 'Before'}
          </button>
          <button type="button" onClick={toggleEnabled}>{displayState.enabled ? 'On' : 'Off'}</button>
        </div>
      </div>

      <div className="video-retouch-analysis" data-status={displayState.analysis.status}>
        <div>
          <ScanFace size={18} />
          <span>
            <strong>{displayState.analysis.status}</strong>
            <small>{displayState.analysis.message ?? 'Local face tracking is ready to start.'}</small>
          </span>
        </div>
        <progress max={100} value={displayState.analysis.progress} />
        <div className="video-retouch-analysis-actions">
          <button type="button" disabled={analysisBusy || !sourceUrl} onClick={() => void analyze(false)}><RefreshCw size={14} /> Analyze</button>
          {analysisBusy && <button type="button" onClick={() => { abortRef.current?.abort(); setAnalysisBusy(false); }}><X size={14} /> Cancel</button>}
        </div>
      </div>

      {displayState.faceTracks.length > 0 && (
        <div className="video-retouch-face-selector">
          <button type="button" className={displayState.applyAllFaces ? 'active' : ''} onClick={toggleAllFaces}>All faces</button>
          {displayState.faceTracks.map((track, index) => (
            <button
              type="button"
              key={track.faceId}
              className={!displayState.applyAllFaces && displayState.selectedFaceId === track.faceId ? 'active' : ''}
              onClick={() => selectFace(track.faceId)}
            >
              Face {index + 1}
            </button>
          ))}
        </div>
      )}

      <div className="video-retouch-categories">
        {SUPPORTED_CATEGORIES.map((entry) => (
          <button type="button" key={entry} className={category === entry ? 'active' : ''} onClick={() => setCategory(entry)}>
            {entry === 'lipstick' ? 'Lips' : 'Cheeks'}
          </button>
        ))}
      </div>

      <div className="video-retouch-template-grid">
        {templates.map((template) => (
          <button type="button" key={template.id} className="video-retouch-template" onClick={() => applyTemplate(template)} disabled={displayState.faceTracks.length === 0}>
            <i style={{ background: template.defaultColor ?? '#8B3DFF' }} />
            <span>{displayName(template)}</span>
            <small>{template.isPro ? 'Pro' : 'Free'}</small>
          </button>
        ))}
      </div>

      {activeLayers.length > 0 && (
        <div className="video-retouch-layer-list">
          <strong>Applied layers</strong>
          {activeLayers.map((layer) => (
            <div key={layer.id} className="video-retouch-layer-row">
              <span>{retouchTemplateRegistry.get(layer.templateId)?.name ?? layer.templateId}</span>
              <input
                aria-label={`${layer.templateId} strength`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={layer.strength}
                onChange={(event) => onChange(updateVideoRetouchLayer(stateOf(item), layer.id, { strength: Number(event.target.value) }))}
              />
              <em>{Math.round(layer.strength)}%</em>
              <button type="button" aria-label={`Remove ${layer.templateId}`} onClick={() => onChange(removeVideoRetouchLayer(stateOf(item), layer.id))}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="video-retouch-reset" onClick={resetAll}>Reset Retouch</button>
    </section>
  );
};