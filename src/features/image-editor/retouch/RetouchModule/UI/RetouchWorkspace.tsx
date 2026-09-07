import React, { useCallback, useRef, useState } from 'react';

import { LayerWarpExecutor } from '../Engine/LayerWarpExecutor';
import { ImageProcessor, type ExportStep } from '../Pipeline/ImageProcessor';
import { RetouchCanvas, type RetouchCanvasHandle } from './RetouchCanvas';

export interface RetouchWorkspaceProps {
  imageUri: string;
  imageName?: string;
  /** Explicit entitlement. Defaults to Free so watermark removal is never granted accidentally. */
  isPro?: boolean;
  onSaved?(fileUri: string, previewBase64: string): void;
}

function loadOriginalImageData(uri: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      try {
        const width = Math.max(1, image.naturalWidth || image.width);
        const height = Math.max(1, image.naturalHeight || image.height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
        if (!context) throw new Error('The export source canvas is unavailable.');
        context.drawImage(image, 0, 0, width, height);
        resolve(context.getImageData(0, 0, width, height));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, { once: true });
    image.addEventListener('error', () => reject(new Error('The full-resolution Retouch source could not be decoded.')), { once: true });
    image.src = uri;
  });
}

function progressLabel(step: ExportStep, percent: number): string {
  const labels: Record<ExportStep, string> = {
    body_warp: 'Body reshape',
    face_warp: 'Face reshape',
    makeup: 'Makeup',
    encode: 'JPEG export',
    done: 'Saved',
  };
  return `${labels[step]} · ${Math.round(percent)}%`;
}

/**
 * End-to-end consumer Retouch surface: interactive editing plus deterministic
 * replay from the immutable source, JPEG 0.95 persistence and Free/Pro
 * watermark policy. No unsupported control is exposed by this wrapper.
 */
export const RetouchWorkspace: React.FC<RetouchWorkspaceProps> = ({
  imageUri,
  imageName = 'KNOUX-Retouch',
  isPro = false,
  onSaved,
}) => {
  const retouchRef = useRef<RetouchCanvasHandle | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [savedUri, setSavedUri] = useState<string | null>(null);

  const reset = useCallback((): void => {
    if (exporting) return;
    retouchRef.current?.reset();
    setSavedUri(null);
    setError(null);
    setProgress('Reset to source');
  }, [exporting]);

  const exportImage = useCallback(async (): Promise<void> => {
    if (exporting || !retouchRef.current) return;
    setExporting(true);
    setError(null);
    setSavedUri(null);
    let executor: LayerWarpExecutor | null = null;
    try {
      const original = await loadOriginalImageData(imageUri);
      executor = new LayerWarpExecutor();
      const processor = new ImageProcessor({
        original,
        getLayers: () => retouchRef.current?.getLayers() ?? [],
        warpExecutor: executor,
        mediaName: imageName,
        onProgress: (step, percent) => setProgress(progressLabel(step, percent)),
      });
      const outputUri = await processor.exportImage(isPro);
      const preview = processor.getPreview();
      setSavedUri(outputUri);
      setProgress('Saved · 100%');
      onSaved?.(outputUri, preview);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setProgress('Export failed');
    } finally {
      executor?.dispose();
      setExporting(false);
    }
  }, [exporting, imageName, imageUri, isPro, onSaved]);

  return (
    <section className="knoux-retouch-workspace" data-component="RetouchWorkspace">
      <div className="knoux-retouch-workspace-actions">
        <div>
          <small>{isPro ? 'PRO EXPORT' : 'FREE EXPORT · WATERMARKED'}</small>
          <strong>{progress}</strong>
        </div>
        <button type="button" className="secondary" disabled={exporting} onClick={reset}>Reset</button>
        <button type="button" className="primary" disabled={exporting} aria-busy={exporting} onClick={() => void exportImage()}>
          {exporting ? 'Exporting…' : 'Save JPEG'}
        </button>
      </div>

      {error && <div className="knoux-retouch-export-error" role="alert">{error}</div>}
      {savedUri && <div className="knoux-retouch-export-success" role="status" dir="auto">Saved: {savedUri}</div>}

      <RetouchCanvas ref={retouchRef} imageUri={imageUri} imageName={imageName} />
    </section>
  );
};
