import { VideoStudioService } from '../../electron/video-studio/video-studio-service';
import { isExecutableVideoModel } from '../../src/core/video-studio/ai/video-catalog';

describe('VideoStudioService provider truth', () => {
  it('exposes only executable real models to the runtime model picker', () => {
    const service = new VideoStudioService();
    const models = service.listModels();

    expect(models.length).toBeGreaterThan(0);
    expect(models.every(isExecutableVideoModel)).toBe(true);
    expect(models.some((model) => model.id === 'minimax/video-01' && model.provider === 'replicate')).toBe(true);
    expect(models.some((model) => model.id === 'tencent/HunyuanVideo')).toBe(false);
  });

  it('keeps Replicate declared wired now that the main-process adapter exists', () => {
    const service = new VideoStudioService();
    const replicate = service.listProviders().find((provider) => provider.id === 'replicate');

    expect(replicate).toMatchObject({ id: 'replicate', wired: true, configured: false });
    service.setReplicateKey('test-key');
    expect(service.listProviders().find((provider) => provider.id === 'replicate')?.configured).toBe(true);
  });

  it('blocks an explicitly selected static-documentation model before network execution', () => {
    const service = new VideoStudioService();
    service.setHfKey('test-key');

    expect(() => service.createJob({
      task: 'text-to-video',
      prompt: 'A cinematic tracking shot',
      explicitModelId: 'tencent/HunyuanVideo',
      allowPaidFallback: true,
    })).toThrow(/not verified as executable/);
  });

  it('requires paid confirmation before creating a Replicate generation job', () => {
    const service = new VideoStudioService();
    service.setReplicateKey('test-key');

    expect(() => service.createJob({
      task: 'text-to-video',
      prompt: 'A cinematic tracking shot',
      explicitModelId: 'minimax/video-01',
      allowPaidFallback: false,
    })).toThrow(/Paid model requires confirmation/);
  });
});
