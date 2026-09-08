import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Android mobile Beauty Studio contracts', () => {
  it('automatically analyzes a ready portrait and caches analysis by source', () => {
    const source = read('src/platform/AndroidBeautyExtension.tsx');

    for (const state of ['IDLE', 'QUEUED', 'ANALYZING', 'READY', 'NO_FACE', 'MODEL_UNAVAILABLE', 'ERROR']) {
      expect(source).toContain(`'${state}'`);
    }
    expect(source).toContain('analysisCacheRef');
    expect(source).toContain('analysisInFlightRef');
    expect(source).toContain("source?.sourceHash ?? source?.assetRef ?? source?.dataUrl");
    expect(source).toContain('void analyze(false)');
    expect(source).toContain("requestAnimationFrame(startWhenCanvasReady)");
    expect(source).toContain('Apply all faces');
    expect(source).toContain("['auto-beautify', 'auto'");
    expect(source).not.toContain("'Analyze Face'");
  });

  it('uses a purpose-built mobile Beauty canvas instead of mounting the desktop ImageEditorView', () => {
    const view = read('src/features/image-studio/MobileBeautyRetouchView.tsx');
    const canvas = read('src/features/image-studio/MobileBeautyCanvas.tsx');
    const css = read('src/features/image-studio/mobileBeautyStudio.css');

    expect(view).toContain("import { MobileBeautyCanvas } from './MobileBeautyCanvas';");
    expect(view).toContain('<MobileBeautyCanvas />');
    expect(view).not.toContain('ImageEditorView');
    expect(view).toContain('id="knoux-mobile-beauty-host"');
    expect(view).toContain('kmc-beauty-preview-engine');

    expect(canvas).toContain('className="image-editor-stage kmc-beauty-stage"');
    expect(canvas).toContain('className="image-editor-canvas kmc-beauty-canvas"');
    expect(canvas).toContain('LatestRenderScheduler');
    expect(canvas).toContain('retouchProject');
    expect(canvas).toContain('maskFromDescriptor');
    expect(canvas).toContain('applyStoredRetouchOperation');
    expect(canvas).toContain('liquifyMeshWarp');

    expect(css).toContain('.kmc-beauty-stage');
    expect(css).toContain('.kmc-beauty-canvas');
    expect(css).not.toContain('.image-editor-toolbar');
    expect(css).not.toContain('.image-editor-ai-panel');
    expect(css).not.toContain('.image-editor-retouch-studio');
  });

  it('resets the previous portrait recipe before a newly selected portrait becomes active', () => {
    const view = read('src/features/image-studio/MobileBeautyRetouchView.tsx');

    expect(view).toContain('setRetouchProject(null)');
    expect(view).toContain('setBeautyBeforeSnapshot(null)');
    expect(view).toContain('setBeautyPreview(null)');
    expect(view).toContain('URL.revokeObjectURL(previousObjectUrl)');
  });

  it('starts body analysis only after the user opens Body and respects partial geometry', () => {
    const source = read('src/platform/AndroidBodyBeautyExtension.tsx');
    const main = read('src/main.tsx');

    for (const state of ['IDLE', 'QUEUED', 'ANALYZING', 'READY', 'PARTIAL', 'NO_BODY', 'MODEL_UNAVAILABLE', 'ERROR']) {
      expect(source).toContain(`'${state}'`);
    }
    expect(source).toContain('if (!active || !source || !sourceKey) return;');
    expect(source).toContain('getVerifiedPoseModel()');
    expect(source).toContain('Partial body detected. Only supported controls are enabled.');
    expect(source).toContain('Protect Background');
    expect(source).toContain('createBodyFreezeMask');
    expect(source).toContain("operation.tool === 'body-sculpt'");
    expect(main).toContain('<AndroidBodyBeautyExtension />');
  });

  it('offers independent positive/negative body-part controls without exposing unavailable geometry', () => {
    const source = read('src/platform/AndroidBodyBeautyExtension.tsx');

    for (const control of ['bodySize', 'waist', 'abdomenWidth', 'hips', 'hipVolume', 'shoulders', 'upperArmSize', 'forearmSize', 'thighWidth', 'calfWidth', 'legLength', 'headSize']) {
      expect(source).toContain(`'${control}'`);
    }
    expect(source).toContain('min={-max}');
    expect(source).toContain('disabled={!available');
    expect(source).toContain("value < 0 ? 'pinch' : 'expand'");
  });
});
