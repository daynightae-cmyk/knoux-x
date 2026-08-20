import {
  addRetouchMask,
  addRetouchOperation,
  createRetouchMask,
  createRetouchOperation,
  createRetouchProject,
  removeRetouchOperation,
  reorderRetouchOperations,
  updateRetouchOperation,
} from '../../src/features/image-editor/retouch/retouchProject';

describe('retouch project v2', () => {
  const source = {
    name: 'portrait.jpg',
    width: 1200,
    height: 800,
    dataUrl: 'data:image/png;base64,AA==',
  };

  function skinOperation(maskId: string | null) {
    return createRetouchOperation({
      tool: 'skin-smoothing',
      name: 'Skin smoothing',
      enabled: true,
      opacity: 1,
      blendMode: 'normal',
      maskId,
      params: { strength: 0.18 },
      engine: 'canvas-local',
    });
  }

  it('keeps the original source separate from its operation recipe', () => {
    const project = createRetouchProject(source);

    expect(project.version).toBe(2);
    expect(project.type).toBe('knoux-retouch-project');
    expect(project.source).toEqual(source);
    expect(project.operations).toEqual([]);
    expect(project.masks).toEqual([]);
  });

  it('stores an editable mask and retouch operation without changing the source', () => {
    const project = createRetouchProject(source);
    const mask = createRetouchMask({
      type: 'brush',
      source: 'manual',
      width: 1200,
      height: 800,
      alphaDataUrl: 'data:image/png;base64,AA==',
      featherPx: 16,
      inverted: false,
      protectedRegions: ['eyes', 'brows'],
    });
    const withMask = addRetouchMask(project, mask);
    const withOperation = addRetouchOperation(withMask, skinOperation(mask.id));

    expect(withOperation.source).toEqual(source);
    expect(withOperation.masks[0].protectedRegions).toEqual(['eyes', 'brows']);
    expect(withOperation.operations[0].maskId).toBe(mask.id);
    expect(withOperation.operations[0].params.strength).toBe(0.18);
  });

  it('updates visibility, reorders layers, and deletes a single operation independently', () => {
    const first = skinOperation(null);
    const second = createRetouchOperation({
      tool: 'lip-tint',
      name: 'Lip tint',
      enabled: true,
      opacity: 0.4,
      blendMode: 'color',
      maskId: null,
      params: { strength: 0.4, color: '#d94868' },
      engine: 'canvas-local',
    });
    const project = addRetouchOperation(addRetouchOperation(createRetouchProject(source), first), second);
    const hidden = updateRetouchOperation(project, first.id, { enabled: false, opacity: 0.5 });
    const reordered = reorderRetouchOperations(hidden, [second.id, first.id]);
    const removed = removeRetouchOperation(reordered, second.id);

    expect(hidden.operations[0].enabled).toBe(false);
    expect(hidden.operations[0].opacity).toBe(0.5);
    expect(reordered.operations.map((operation) => operation.id)).toEqual([second.id, first.id]);
    expect(removed.operations).toHaveLength(1);
    expect(removed.operations[0].id).toBe(first.id);
  });
});
