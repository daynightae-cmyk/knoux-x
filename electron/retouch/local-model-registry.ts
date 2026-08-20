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
    version: 'latest-float16',
    capability: 'face-landmarks',
    runtime: 'mediapipe',
    license: 'Apache-2.0 (MediaPipe model distribution).',
    commercialUse: 'allowed',
    sizeBytes: 3758596,
    downloadUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
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
