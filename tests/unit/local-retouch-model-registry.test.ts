import {
  LOCAL_RETOUCH_MODELS,
  canInstallLocalRetouchModel,
  findLocalRetouchModel,
} from '../../electron/retouch/local-model-registry';

describe('local retouch model registry', () => {
  it('does not permit a model download before license and integrity review', () => {
    const model = findLocalRetouchModel('mediapipe-face-landmarker');

    expect(model).not.toBeNull();
    expect(model?.capability).toBe('face-landmarks');
    expect(canInstallLocalRetouchModel(model!)).toBe(false);
  });

  it('requires an HTTPS source, SHA-256, approved commercial use, and a declared size', () => {
    const reviewed = {
      ...LOCAL_RETOUCH_MODELS[0],
      commercialUse: 'allowed' as const,
      downloadUrl: 'https://models.example.test/face.task',
      sha256: 'a'.repeat(64),
      sizeBytes: 1_000_000,
    };

    expect(canInstallLocalRetouchModel(reviewed)).toBe(true);
  });
});
