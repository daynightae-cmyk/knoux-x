import {
  LOCAL_RETOUCH_MODELS,
  canInstallLocalRetouchModel,
  findLocalRetouchModel,
} from '../../electron/retouch/local-model-registry';

describe('local retouch model registry', () => {
  it('permits reviewed Face and Pose Landmarker models only after license and integrity review', () => {
    const face = findLocalRetouchModel('mediapipe-face-landmarker');
    const pose = findLocalRetouchModel('mediapipe-pose-landmarker-full');

    expect(face?.capability).toBe('face-landmarks');
    expect(pose?.capability).toBe('body-landmarks');
    expect(LOCAL_RETOUCH_MODELS.map(({ capability }) => capability)).toEqual(['face-landmarks', 'body-landmarks']);
    expect(canInstallLocalRetouchModel(face!)).toBe(true);
    expect(canInstallLocalRetouchModel(pose!)).toBe(true);
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
