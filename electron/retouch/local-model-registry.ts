export type RetouchModelCapability = 'face-landmarks' | 'portrait-segmentation' | 'super-resolution';

export interface LocalRetouchModelManifest {
  id: string;
  displayName: string;
  version: string;
  capability: RetouchModelCapability;
  runtime: 'mediapipe' | 'onnxruntime';
  license: string;
  commercialUse: 'allowed' | 'review-required' | 'not-allowed';
  sizeBytes: number;
  downloadUrl: string | null;
  sha256: string | null;
}

/**
 * Models are deliberately disabled until a reviewed manifest includes both a
 * license decision and SHA-256. This prevents background downloads or executing
 * unverified model files from the renderer.
 */
export const LOCAL_RETOUCH_MODELS: readonly LocalRetouchModelManifest[] = Object.freeze([
  {
    id: 'mediapipe-face-landmarker',
    displayName: 'MediaPipe Face Landmarker',
    version: 'pending-review',
    capability: 'face-landmarks',
    runtime: 'mediapipe',
    license: 'Model asset requires registry review before distribution.',
    commercialUse: 'review-required',
    sizeBytes: 0,
    downloadUrl: null,
    sha256: null,
  },
]);

export function canInstallLocalRetouchModel(model: LocalRetouchModelManifest): boolean {
  return model.commercialUse === 'allowed'
    && typeof model.downloadUrl === 'string'
    && /^https:\/\//.test(model.downloadUrl)
    && typeof model.sha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(model.sha256)
    && model.sizeBytes > 0;
}

export function findLocalRetouchModel(modelId: string): LocalRetouchModelManifest | null {
  return LOCAL_RETOUCH_MODELS.find((model) => model.id === modelId) ?? null;
}
