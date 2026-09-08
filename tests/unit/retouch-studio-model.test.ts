import {
  AUTO_BEAUTIFY_RECIPE,
  BODY_SHAPE_RECIPES,
  FACE_SHAPE_RECIPES,
  HAIR_CAPABILITY,
  MAKEUP_LOOKS,
  SKIN_RECIPES,
  STUDIO_BODY_TOOLS,
  STUDIO_CATEGORIES,
  STUDIO_TEMPLATES,
  makeupLookById,
  studioTemplateById,
  studioToolById,
  templatesForCategory,
  toolsForCategory,
} from '../../src/features/retouch-studio/retouchStudioModel';

describe('Retouch Studio model', () => {
  test('categories cover face, skin, makeup, body, presets and details in both languages', () => {
    expect(STUDIO_CATEGORIES.map((entry) => entry.id)).toEqual(['face', 'skin', 'makeup', 'body', 'presets', 'details']);
    for (const entry of STUDIO_CATEGORIES) {
      expect(entry.en.trim().length).toBeGreaterThan(0);
      expect(entry.ar.trim().length).toBeGreaterThan(0);
    }
  });

  test('hair stays hidden with an honest reason', () => {
    expect(HAIR_CAPABILITY.status).toBe('hidden');
    expect(HAIR_CAPABILITY.reasonEn).toMatch(/segmentation/i);
  });

  test('every visible tool has a descriptive accessible label and conservative default', () => {
    const tools = [
      ...toolsForCategory('face'),
      ...toolsForCategory('skin'),
      ...toolsForCategory('makeup'),
      ...toolsForCategory('details'),
    ];
    expect(tools.length).toBeGreaterThan(15);
    for (const tool of tools) {
      expect(tool.a11yEn.toLowerCase()).not.toBe('slider');
      expect(tool.a11yEn.length).toBeGreaterThan(3);
      expect(tool.a11yAr.length).toBeGreaterThan(1);
      expect(tool.def).toBeGreaterThanOrEqual(tool.min);
      expect(tool.def).toBeLessThanOrEqual(tool.max);
      if (tool.control === 'slider') expect(tool.def).toBeLessThanOrEqual(0.5);
    }
  });

  test('specialized lip, eye and skin tools exist with real engines', () => {
    for (const id of ['lip-size', 'lip-definition', 'dark-circles', 'redness', 'jaw', 'nose-width']) {
      const tool = studioToolById(id);
      expect(tool).toBeDefined();
      expect(tool?.capability).toBe('requires-analysis');
    }
    expect(studioToolById('lip-size')?.control).toBe('bipolar');
    expect(studioToolById('red-eye')?.control).toBe('action');
  });

  test('makeup looks are Knoux-owned recipes with swatches', () => {
    expect(MAKEUP_LOOKS.length).toBe(10);
    for (const look of MAKEUP_LOOKS) {
      expect(look.swatch).toHaveLength(2);
      expect(look.intensity).toBeGreaterThan(0);
      expect(look.intensity).toBeLessThanOrEqual(0.75);
    }
    expect(makeupLookById('rose')?.lipstick).toBe('#d94a7a');
  });

  test('auto beautify stays conservative', () => {
    for (const value of Object.values(AUTO_BEAUTIFY_RECIPE)) {
      expect(value).toBeLessThanOrEqual(0.3);
    }
  });

  test('body tools include chest with bipolar control', () => {
    const chest = STUDIO_BODY_TOOLS.find((entry) => entry.id === 'chest');
    expect(chest).toBeDefined();
    expect(chest?.a11yEn).toBe('Chest width');
    expect(STUDIO_BODY_TOOLS.length).toBe(13);
  });

  test('CapCut-style templates exist for looks, face shapes, body shapes and skin', () => {
    const kinds = new Set(STUDIO_TEMPLATES.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(['face-shape', 'body-shape', 'skin']));
    expect(templatesForCategory('presets').length).toBe(STUDIO_TEMPLATES.length);
    expect(templatesForCategory('body').every((entry) => entry.kind === 'body-shape')).toBe(true);
    expect(templatesForCategory('face').every((entry) => entry.kind === 'face-shape')).toBe(true);
    expect(templatesForCategory('skin').every((entry) => entry.kind === 'skin')).toBe(true);
    expect(studioTemplateById('body-hourglass')).toBeDefined();
    for (const template of STUDIO_TEMPLATES) {
      expect(template.swatch).toHaveLength(2);
    }
  });

  test('face-shape recipes use bounded intensities', () => {
    expect(FACE_SHAPE_RECIPES.length).toBe(4);
    for (const recipe of FACE_SHAPE_RECIPES) {
      expect(recipe.strokes.length).toBeGreaterThan(0);
      for (const item of recipe.strokes) expect(Math.abs(item.intensity)).toBeLessThanOrEqual(0.5);
    }
  });

  test('body-shape recipes stay believable', () => {
    expect(BODY_SHAPE_RECIPES.length).toBe(4);
    for (const recipe of BODY_SHAPE_RECIPES) {
      for (const value of Object.values(recipe.values)) {
        expect(Math.abs(value)).toBeLessThanOrEqual(0.45);
      }
    }
    expect(BODY_SHAPE_RECIPES.find((entry) => entry.id === 'body-hourglass')?.values.waist).toBeLessThan(0);
  });

  test('skin recipes use only real skin engines', () => {
    const engines = new Set(['skin-smoothing', 'blemish-removal', 'skin-tone', 'portrait-glow', 'sharpen']);
    for (const recipe of SKIN_RECIPES) {
      for (const op of recipe.ops) expect(engines.has(op.tool)).toBe(true);
    }
  });
});
