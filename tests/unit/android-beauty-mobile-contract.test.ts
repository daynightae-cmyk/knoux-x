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
    expect(source).not.toContain("'Analyze Face'");
  });

  it('drives beauty through the shared studio panel with draft/commit semantics', () => {
    const source = read('src/platform/AndroidBeautyExtension.tsx');
    const panel = read('src/features/retouch-studio/RetouchStudioPanel.tsx');
    const model = read('src/features/retouch-studio/retouchStudioModel.ts');

    // Reference UX: category bar, tool carousel, one focused slider, apply.
    expect(source).toContain('<RetouchStudioPanel');
    expect(source).toContain('rebuildDraft');
    expect(source).toContain('commitDraft');
    expect(source).toContain('undoStudio');
    expect(source).toContain('redoStudio');
    expect(source).toContain('setCompareEnabled');
    expect(source).toContain('removeTagged');
    // Live slider preview replaces stale drafts instead of stacking operations.
    expect(source).toContain('draftIdsRef');
    expect(source).toContain('draftRunRef');
    expect(source).toContain('scheduleDraft');
    // Landmark-driven face geometry ships through real mesh strokes.
    expect(source).toContain('faceGeometryStrokes');
    expect(source).toContain('facetpl:');
    // CapCut-style pre-made templates preview as one undoable group.
    expect(source).toContain('applyStudioTemplate');
    expect(source).toContain('FACE_SHAPE_RECIPES');
    expect(source).toContain('SKIN_RECIPES');
    expect(source).toContain('look:');
    // Panel contract: hold-to-compare, undo/redo, reset granularity, faces.
    expect(panel).toContain('onCompareHold');
    expect(panel).toContain('onResetTool');
    expect(panel).toContain('onResetCategory');
    expect(panel).toContain('onResetAll');
    expect(panel).toContain('data-studio-template');
    expect(panel).toContain('aria-pressed');
    // No fake hair tooling.
    expect(model).toContain("status: 'hidden'");
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
    const geometry = read('src/features/image-editor/retouch/bodyReshapeGeometry.ts');

    for (const control of ['bodySize', 'waist', 'abdomenWidth', 'hips', 'hipVolume', 'chest', 'shoulders', 'upperArmSize', 'forearmSize', 'thighWidth', 'calfWidth', 'legLength', 'headSize']) {
      expect(source).toContain(`'${control}'`);
    }
    // One focused slider through the shared panel — never a wall of sliders.
    expect(source).toContain('<RetouchStudioPanel');
    expect(source).toContain('focusedControl');
    expect(source).toContain('disabledToolIds');
    expect(source).not.toContain('android-body-beauty__sliders');
    // Chest derives honestly from shoulder + waist landmarks.
    expect(source).toContain('deriveChestRegion');
    expect(geometry).toContain('deriveChestRegion');
    expect(geometry).toContain('chest');
    // Bipolar reshape keeps pinch/expand polarity in the geometry engine.
    expect(geometry).toContain("amount < 0 ? 'pinch' : 'expand'");
    // CapCut-style body templates apply as one undo checkpoint.
    expect(source).toContain('applyBodyTemplate');
    expect(source).toContain('BODY_SHAPE_RECIPES');
    expect(source).toContain('pushBodyHistory');
    expect(source).toContain('undoBody');
    expect(source).toContain('redoBody');
    expect(source).toContain('setBodyCompare');
  });
});
