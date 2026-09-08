import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X Retouch Studio contracts', () => {
  test('studio model exposes specialized tools, looks and honest capabilities', () => {
    const model = read('src/features/retouch-studio/retouchStudioModel.ts');
    for (const category of ['face', 'skin', 'makeup', 'body', 'presets', 'details']) {
      expect(model).toContain(`id: '${category}'`);
    }
    for (const tool of ['lip-size', 'lip-definition', 'dark-circles', 'redness', 'jaw', 'nose-width', 'chest']) {
      expect(model).toContain(`id: '${tool}'`);
    }
    for (const look of ['natural', 'soft-glam', 'warm', 'rose', 'peach', 'evening', 'editorial', 'classic', 'fresh', 'nude']) {
      expect(model).toContain(`id: '${look}'`);
    }
    for (const template of ['face-vline', 'body-hourglass', 'skin-porcelain']) {
      expect(model).toContain(`id: '${template}'`);
    }
    expect(model).toContain('HAIR_CAPABILITY');
    expect(model).toContain("status: 'hidden'");
    expect(model).toContain('a11yEn');
  });

  test('geometry strokes stay landmark-local and bipolar', () => {
    const geometry = read('src/features/retouch-studio/faceGeometryStrokes.ts');
    expect(geometry).toContain('lip-size');
    expect(geometry).toContain('MOUTH_LEFT_CORNER');
    expect(geometry).toContain("'pinch' : 'expand'");
    expect(geometry).toContain('LiquifyStroke');
    expect(geometry).not.toContain('object-fit');
    expect(geometry).not.toContain('style.transform');
  });

  test('video exposes only executable template categories', () => {
    const inspector = read('src/features/video-studio/retouch/VideoRetouchInspector.tsx');
    expect(inspector).toContain("'lipstick', 'blush'");
    expect(inspector).toContain('toggleBeforeAfter');
    expect(inspector).toContain('faceTracks');
    expect(inspector).toContain('removeVideoRetouchLayer');
    expect(inspector).not.toContain("'face-shape'");
    expect(inspector).not.toContain("'body-shape'");
  });

  test('mobile beauty canvas replays operations at full resolution', () => {
    const canvas = read('src/features/image-studio/MobileBeautyCanvas.tsx');
    expect(canvas).toContain('renderProject');
    expect(canvas).toContain('LatestRenderScheduler');
    expect(canvas).toContain('liquifyMeshWarp');
    expect(canvas).toContain('cosmeticTint');
    expect(canvas).toContain('guidedSkinSmooth');
  });

  test('beauty and body hosts mount the shared studio panel', () => {
    const beauty = read('src/platform/AndroidBeautyExtension.tsx');
    const body = read('src/platform/AndroidBodyBeautyExtension.tsx');
    expect(beauty).toContain('<RetouchStudioPanel');
    expect(body).toContain('<RetouchStudioPanel');
    expect(beauty).toContain('retouchStudioPanel.css');
    expect(body).toContain('retouchStudioPanel.css');
  });
});
