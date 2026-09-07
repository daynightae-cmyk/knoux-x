import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BodyAnalysisClient } from '../../bodyAnalysisClient';
import { FaceAnalysisClient } from '../../faceAnalysisClient';
import { BodyDetector, type BodyControlPoint, type BodyZone } from '../Engine/BodyDetector';
import { FaceDetector, type FaceZone } from '../Engine/FaceDetector';
import { LayerManager, type RetouchLayer } from '../Engine/LayerManager';
import { MeshWarper } from '../Engine/MeshWarper';
import { applyMakeupBlend, parseHexColor } from '../Pipeline/BlendModes';
import { captureZoneSnapshot, HistoryStack, type HistoryEntry } from '../Pipeline/HistoryStack';
import { ColorPicker, type MakeupSelection } from './ColorPicker';
import { ToolPanel, type ActiveRetouchZone } from './ToolPanel';
import { ZoneHandles } from './ZoneHandles';
import './retouchModule.css';

export interface RetouchCanvasProps {
  imageUri: string;
  imageName?: string;
  className?: string;
  onCommittedChange?(imageData: ImageData, layers: readonly RetouchLayer[]): void;
}

/** Imperative surface used by export/persistence without exposing mutable refs. */
export interface RetouchCanvasHandle {
  getCommittedImageData(): ImageData | null;
  getLayers(): RetouchLayer[];
  reset(): void;
}

type DetectionStatus = 'loading' | 'ready' | 'partial' | 'unavailable' | 'failed';

const DEFAULT_MAKEUP: MakeupSelection = {
  color: '#A13B5A',
  intensity: 42,
  blendMode: 'soft-light',
};

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function polygonPoints(points: readonly { x: number; y: number }[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

function isFaceZone(zone: ActiveRetouchZone | null): zone is FaceZone {
  return Boolean(zone && 'faceId' in zone);
}

function isBodyZone(zone: ActiveRetouchZone | null): zone is BodyZone {
  return Boolean(zone && 'bodyId' in zone);
}

function imageFromUri(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('The selected image could not be decoded.')), { once: true });
    image.src = uri;
  });
}

/**
 * Dedicated mobile Retouch canvas. Detection, zone masks, body mesh preview,
 * full-resolution commits, localized makeup, and region-only history are wired
 * to the same local MediaPipe and ImageData infrastructure already used by
 * KNOUX. The source ImageData is cloned once and never mutated.
 */
export const RetouchCanvas = forwardRef<RetouchCanvasHandle, RetouchCanvasProps>(function RetouchCanvas(
  { imageUri, imageName = 'Portrait', className = '', onCommittedChange },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalRef = useRef<ImageData | null>(null);
  const committedRef = useRef<ImageData | null>(null);
  const meshWarperRef = useRef<MeshWarper | null>(null);
  const faceClientRef = useRef<FaceAnalysisClient | null>(null);
  const bodyClientRef = useRef<BodyAnalysisClient | null>(null);
  const historyRef = useRef(new HistoryStack(20));
  const layersRef = useRef(new LayerManager());
  const activeMeshesRef = useRef(new Map<string, readonly BodyControlPoint[]>());
  const historyToLayerRef = useRef(new Map<string, string>());
  const previewSequenceRef = useRef(0);
  const lastTapRef = useRef<{ zoneId: string; at: number } | null>(null);

  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [faceZones, setFaceZones] = useState<FaceZone[]>([]);
  const [bodyZones, setBodyZones] = useState<BodyZone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('loading');
  const [detectionMessage, setDetectionMessage] = useState('Preparing local face and body analysis…');
  const [busy, setBusy] = useState(false);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [makeupSelection, setMakeupSelection] = useState<MakeupSelection>(DEFAULT_MAKEUP);

  const allZones = useMemo<ActiveRetouchZone[]>(() => [...faceZones, ...bodyZones], [bodyZones, faceZones]);
  const activeZone = useMemo(
    () => allZones.find((zone) => zone.id === activeZoneId) ?? null,
    [activeZoneId, allZones],
  );

  const emitCommittedChange = useCallback((): void => {
    if (!onCommittedChange || !committedRef.current) return;
    onCommittedChange(cloneImageData(committedRef.current), layersRef.current.getOrderedLayers());
  }, [onCommittedChange]);

  const drawFull = useCallback((imageData: ImageData): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== imageData.width) canvas.width = imageData.width;
    if (canvas.height !== imageData.height) canvas.height = imageData.height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) throw new Error('The Retouch 2D canvas is unavailable.');
    context.putImageData(imageData, 0, 0);
  }, []);

  const drawPreview = useCallback((imageData: ImageData): void => {
    const canvas = canvasRef.current;
    const committed = committedRef.current;
    if (!canvas || !committed) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    const proxy = document.createElement('canvas');
    proxy.width = imageData.width;
    proxy.height = imageData.height;
    const proxyContext = proxy.getContext('2d', { alpha: true });
    if (!proxyContext) return;
    proxyContext.putImageData(imageData, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(proxy, 0, 0, canvas.width, canvas.height);
  }, []);

  const refreshHistoryDepth = useCallback((): void => {
    setHistoryDepth(historyRef.current.getDepth());
  }, []);

  const resetDocument = useCallback((): void => {
    const original = originalRef.current;
    if (!original) return;
    committedRef.current = cloneImageData(original);
    historyRef.current.clear();
    layersRef.current.clear();
    historyToLayerRef.current.clear();
    activeMeshesRef.current.clear();
    previewSequenceRef.current += 1;
    drawFull(committedRef.current);
    refreshHistoryDepth();
    setMakeupOpen(false);
    emitCommittedChange();
  }, [drawFull, emitCommittedChange, refreshHistoryDepth]);

  useImperativeHandle(forwardedRef, () => ({
    getCommittedImageData: () => committedRef.current ? cloneImageData(committedRef.current) : null,
    getLayers: () => layersRef.current.getOrderedLayers(),
    reset: resetDocument,
  }), [resetDocument]);

  useEffect(() => {
    const controller = new AbortController();
    const api = typeof window === 'undefined' ? undefined : window.knouxImageStudioAPI;
    let disposed = false;

    const cleanupClients = (): void => {
      faceClientRef.current?.dispose();
      bodyClientRef.current?.dispose();
      meshWarperRef.current?.dispose();
      faceClientRef.current = null;
      bodyClientRef.current = null;
      meshWarperRef.current = null;
    };

    const initialize = async (): Promise<void> => {
      setDetectionStatus('loading');
      setDetectionMessage('Preparing local face and body analysis…');
      setFaceZones([]);
      setBodyZones([]);
      setActiveZoneId(null);
      historyRef.current.clear();
      layersRef.current.clear();
      historyToLayerRef.current.clear();
      activeMeshesRef.current.clear();
      refreshHistoryDepth();

      try {
        const image = await imageFromUri(imageUri);
        if (disposed || controller.signal.aborted) return;
        const width = Math.max(1, image.naturalWidth || image.width);
        const height = Math.max(1, image.naturalHeight || image.height);
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Retouch canvas was unmounted before the image loaded.');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
        if (!context) throw new Error('The Retouch 2D canvas is unavailable.');
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const original = context.getImageData(0, 0, width, height);
        originalRef.current = cloneImageData(original);
        committedRef.current = cloneImageData(original);
        setDimensions({ width, height });

        if (!api?.getVerifiedFaceModel || !api.getVerifiedPoseModel) {
          setDetectionStatus('unavailable');
          setDetectionMessage('Local Retouch models are unavailable. Pixel editing remains untouched.');
          return;
        }

        const faceClient = new FaceAnalysisClient(() => api.getVerifiedFaceModel());
        const bodyClient = new BodyAnalysisClient(() => api.getVerifiedPoseModel());
        const warper = new MeshWarper();
        faceClientRef.current = faceClient;
        bodyClientRef.current = bodyClient;
        meshWarperRef.current = warper;
        const faceDetector = new FaceDetector(faceClient);
        const bodyDetector = new BodyDetector(bodyClient);

        const [nextFaceZones, nextBodyZones] = await Promise.all([
          faceDetector.detect({ imageDataUrl: imageUri, imageWidth: width, imageHeight: height, maxFaces: 8, signal: controller.signal }),
          bodyDetector.detect({ imageDataUrl: imageUri, imageWidth: width, imageHeight: height, maxBodies: 4, signal: controller.signal }),
        ]);
        if (disposed || controller.signal.aborted) return;
        warper.registerZones(nextBodyZones);
        setFaceZones(nextFaceZones);
        setBodyZones(nextBodyZones);
        const firstZone = nextFaceZones[0] ?? nextBodyZones[0] ?? null;
        setActiveZoneId(firstZone?.id ?? null);
        const faceDiagnostic = faceDetector.getLastDiagnostic();
        const bodyDiagnostic = bodyDetector.getDiagnostic();
        if (nextFaceZones.length > 0 || nextBodyZones.length > 0) {
          const partial = nextFaceZones.length === 0 || nextBodyZones.length === 0;
          setDetectionStatus(partial ? 'partial' : 'ready');
          setDetectionMessage(
            `${nextFaceZones.length} face zones · ${nextBodyZones.length} body zones${partial ? ' · partial detection' : ''}`,
          );
        } else {
          setDetectionStatus('unavailable');
          setDetectionMessage(faceDiagnostic.reason ?? bodyDiagnostic.reason ?? 'No editable face or body zones were detected.');
        }
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        setDetectionStatus('failed');
        setDetectionMessage(error instanceof Error ? error.message : String(error));
      }
    };

    void initialize();
    return () => {
      disposed = true;
      controller.abort();
      previewSequenceRef.current += 1;
      cleanupClients();
    };
  }, [imageUri, refreshHistoryDepth]);

  const scheduleBodyPreview = useCallback((zone: BodyZone, controlPoints: readonly BodyControlPoint[]): void => {
    const warper = meshWarperRef.current;
    const committed = committedRef.current;
    if (!warper || !committed) return;
    const sequence = ++previewSequenceRef.current;
    void warper.previewWarp(zone.id, controlPoints, committed).then((preview) => {
      if (sequence !== previewSequenceRef.current) return;
      drawPreview(preview);
    }).catch(() => {
      if (sequence === previewSequenceRef.current && committedRef.current) drawFull(committedRef.current);
    });
  }, [drawFull, drawPreview]);

  const handleBodyDrag = useCallback((zone: BodyZone, anchor: { x: number; y: number }, delta: { x: number; y: number }): BodyControlPoint[] => {
    const warper = meshWarperRef.current;
    if (!warper) return zone.controlMesh.map((point) => ({ ...point, original: { ...point.original }, current: { ...point.current }, delta: { ...point.delta } }));
    const next = warper.deformControlMesh(zone.type, zone.controlMesh, anchor, delta);
    activeMeshesRef.current.set(zone.id, next);
    scheduleBodyPreview(zone, next);
    return next;
  }, [scheduleBodyPreview]);

  const handleBodyCommit = useCallback((zone: BodyZone, controlPoints: readonly BodyControlPoint[]): void => {
    const warper = meshWarperRef.current;
    const committed = committedRef.current;
    if (!warper || !committed || busy) return;
    const changed = controlPoints.some((point) => Math.abs(point.delta.x) > 0.01 || Math.abs(point.delta.y) > 0.01);
    previewSequenceRef.current += 1;
    if (!changed) {
      drawFull(committed);
      return;
    }

    setBusy(true);
    const snapshot = captureZoneSnapshot(committed, zone.mask);
    void warper.warpZone(zone.id, controlPoints, committed).then((result) => {
      const layer = layersRef.current.addBodyWarp({
        zoneId: zone.id,
        zoneType: zone.type,
        controlPoints,
        mask: zone.mask,
        snapshot,
      });
      historyRef.current.push({
        id: layer.id,
        zoneId: zone.id,
        operation: 'body-warp',
        params: { zoneType: zone.type, controlPoints },
        mask: zone.mask,
        snapshot,
        createdAt: Date.now(),
      });
      historyToLayerRef.current.set(layer.id, layer.id);
      committedRef.current = result;
      activeMeshesRef.current.delete(zone.id);
      drawFull(result);
      refreshHistoryDepth();
      emitCommittedChange();
    }).catch((error) => {
      setDetectionMessage(error instanceof Error ? error.message : String(error));
      if (committedRef.current) drawFull(committedRef.current);
    }).finally(() => setBusy(false));
  }, [busy, drawFull, emitCommittedChange, refreshHistoryDepth]);

  const previewMakeup = useCallback((selection: MakeupSelection): void => {
    if (!isFaceZone(activeZone) || !committedRef.current) return;
    try {
      const preview = applyMakeupBlend(
        committedRef.current,
        activeZone.mask,
        parseHexColor(selection.color),
        selection.intensity,
        selection.blendMode,
      );
      drawFull(preview);
      setMakeupSelection(selection);
    } catch (error) {
      setDetectionMessage(error instanceof Error ? error.message : String(error));
    }
  }, [activeZone, drawFull]);

  const confirmMakeup = useCallback((selection: MakeupSelection): void => {
    if (!isFaceZone(activeZone) || !committedRef.current || busy) return;
    const base = committedRef.current;
    const snapshot = captureZoneSnapshot(base, activeZone.mask);
    const result = applyMakeupBlend(base, activeZone.mask, parseHexColor(selection.color), selection.intensity, selection.blendMode);
    const layer = layersRef.current.addMakeup({
      zoneId: activeZone.id,
      zoneType: activeZone.type,
      color: parseHexColor(selection.color),
      intensity: selection.intensity,
      blendMode: selection.blendMode,
      mask: activeZone.mask,
      snapshot,
    });
    historyRef.current.push({
      id: layer.id,
      zoneId: activeZone.id,
      operation: 'makeup',
      params: {
        color: parseHexColor(selection.color),
        intensity: selection.intensity,
        blendMode: selection.blendMode,
      },
      mask: activeZone.mask,
      snapshot,
      createdAt: Date.now(),
    });
    historyToLayerRef.current.set(layer.id, layer.id);
    committedRef.current = result;
    drawFull(result);
    refreshHistoryDepth();
    setMakeupSelection(selection);
    setMakeupOpen(false);
    emitCommittedChange();
  }, [activeZone, busy, drawFull, emitCommittedChange, refreshHistoryDepth]);

  const cancelPreview = useCallback((): void => {
    previewSequenceRef.current += 1;
    if (committedRef.current) drawFull(committedRef.current);
    setMakeupOpen(false);
  }, [drawFull]);

  const replayHistoryEntry = useCallback(async (imageData: ImageData, entry: HistoryEntry): Promise<ImageData> => {
    if (entry.operation === 'makeup') {
      const result = applyMakeupBlend(imageData, entry.mask, entry.params.color, entry.params.intensity, entry.params.blendMode);
      const layer = layersRef.current.addMakeup({
        zoneId: entry.zoneId,
        zoneType: faceZones.find((zone) => zone.id === entry.zoneId)?.type ?? 'lips',
        color: entry.params.color,
        intensity: entry.params.intensity,
        blendMode: entry.params.blendMode,
        mask: entry.mask,
        snapshot: entry.snapshot,
      });
      historyToLayerRef.current.set(entry.id, layer.id);
      return result;
    }
    if (entry.operation === 'body-warp') {
      const warper = meshWarperRef.current;
      if (!warper) throw new Error('The body mesh worker is unavailable for redo.');
      const result = await warper.warpZone(entry.zoneId, entry.params.controlPoints, imageData);
      const layer = layersRef.current.addBodyWarp({
        zoneId: entry.zoneId,
        zoneType: entry.params.zoneType,
        controlPoints: entry.params.controlPoints,
        mask: entry.mask,
        snapshot: entry.snapshot,
      });
      historyToLayerRef.current.set(entry.id, layer.id);
      return result;
    }
    throw new Error('Face geometry redo is not registered in this Retouch canvas yet.');
  }, [faceZones]);

  const undo = useCallback((): void => {
    const current = committedRef.current;
    if (!current || busy) return;
    const action = historyRef.current.undo(current);
    if (!action) return;
    const actualLayerId = historyToLayerRef.current.get(action.entry.id) ?? action.entry.id;
    layersRef.current.remove(actualLayerId);
    historyToLayerRef.current.delete(action.entry.id);
    committedRef.current = action.imageData;
    previewSequenceRef.current += 1;
    drawFull(action.imageData);
    refreshHistoryDepth();
    emitCommittedChange();
  }, [busy, drawFull, emitCommittedChange, refreshHistoryDepth]);

  const redo = useCallback((): void => {
    const current = committedRef.current;
    if (!current || busy) return;
    setBusy(true);
    void historyRef.current.redo(current, replayHistoryEntry).then((action) => {
      if (!action) return;
      committedRef.current = action.imageData;
      drawFull(action.imageData);
      refreshHistoryDepth();
      emitCommittedChange();
    }).catch((error) => {
      setDetectionMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => setBusy(false));
  }, [busy, drawFull, emitCommittedChange, refreshHistoryDepth, replayHistoryEntry]);

  const selectZone = useCallback((zone: ActiveRetouchZone): void => {
    setActiveZoneId(zone.id);
    setMakeupOpen(false);
    if (committedRef.current) drawFull(committedRef.current);
  }, [drawFull]);

  const handleFaceTap = useCallback((zone: FaceZone): void => {
    const now = performance.now();
    const previous = lastTapRef.current;
    selectZone(zone);
    if (previous?.zoneId === zone.id && now - previous.at <= 340) {
      setMakeupOpen(true);
      lastTapRef.current = null;
      return;
    }
    lastTapRef.current = { zoneId: zone.id, at: now };
  }, [selectZone]);

  const detectionClass = `knoux-retouch-status ${detectionStatus}`;

  return (
    <section className={`knoux-retouch-module ${className}`.trim()} data-component="RetouchCanvas">
      <header className="knoux-retouch-module-header">
        <div><small>KNOUX LOCAL RETOUCH</small><strong>{imageName}</strong></div>
        <span className={detectionClass}>{busy ? 'Processing…' : detectionMessage}</span>
      </header>

      <div className="knoux-retouch-stage" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
        <canvas ref={canvasRef} className="knoux-retouch-canvas" aria-label="Retouch image preview" />
        <svg
          className="knoux-retouch-overlay"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
          aria-label="Detected retouch zones"
        >
          {faceZones.flatMap((zone) => zone.polygons.map((polygon, polygonIndex) => (
            <polygon
              key={`${zone.id}:${polygonIndex}`}
              points={polygonPoints(polygon)}
              fill={zone.color}
              stroke={zone.color}
              className={activeZoneId === zone.id ? 'knoux-retouch-zone active' : 'knoux-retouch-zone'}
              style={{ opacity: activeZoneId === zone.id ? 0.34 : 0.12 }}
              onPointerUp={() => handleFaceTap(zone)}
              onDoubleClick={() => { selectZone(zone); setMakeupOpen(true); }}
            />
          )))}
          {bodyZones.flatMap((zone) => zone.polygons.map((polygon, polygonIndex) => (
            <polygon
              key={`${zone.id}:${polygonIndex}`}
              points={polygonPoints(polygon)}
              fill={zone.color}
              stroke={zone.color}
              className={activeZoneId === zone.id ? 'knoux-retouch-zone active' : 'knoux-retouch-zone'}
              style={{ opacity: activeZoneId === zone.id ? 0.28 : 0.1 }}
              onPointerUp={() => selectZone(zone)}
            />
          )))}
          {bodyZones.map((zone) => (
            <ZoneHandles
              key={`handles:${zone.id}`}
              zone={zone}
              active={activeZoneId === zone.id}
              disabled={busy}
              onActivate={selectZone}
              onDrag={handleBodyDrag}
              onCommit={handleBodyCommit}
            />
          ))}
        </svg>
      </div>

      <ToolPanel
        zone={activeZone}
        busy={busy}
        canUndo={historyDepth.undo > 0}
        canRedo={historyDepth.redo > 0}
        onUndo={undo}
        onRedo={redo}
        onResetPreview={cancelPreview}
        onOpenMakeup={() => { if (isFaceZone(activeZone)) setMakeupOpen(true); }}
      />

      {makeupOpen && isFaceZone(activeZone) && (
        <ColorPicker
          value={makeupSelection}
          disabled={busy}
          onPreview={previewMakeup}
          onConfirm={confirmMakeup}
          onCancel={cancelPreview}
        />
      )}

      {isBodyZone(activeZone) && activeZone.partial && (
        <p className="knoux-retouch-partial-warning" role="status">
          Partial body detected. Only landmarks with sufficient confidence are editable; missing limbs are intentionally ignored.
        </p>
      )}
    </section>
  );
});