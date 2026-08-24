const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function replaceExact(rel, before, after) {
  const source = read(rel);
  if (!source.includes(before)) {
    throw new Error(`Expected block not found in ${rel}`);
  }
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one block in ${rel}, found ${occurrences}`);
  }
  write(rel, source.replace(before, after));
}

const canvas = 'src/features/image-studio/components/ImageStudioCanvas.tsx';
replaceExact(
  canvas,
  "import { useImageStudioStore } from '../store/imageStudioStore';\n",
  "import { useImageStudioStore } from '../store/imageStudioStore';\nimport {\n  clientPointToCanvasDocument,\n  findTopmostVisibleLayerAtPoint,\n  isStrokeRetouchType,\n} from './imageStudioCanvasInteraction';\n",
);

replaceExact(
  canvas,
  `    const retouchType = activeRetouchOperation?.type;\n    const supportsStroke = retouchType === 'geometry-warp'\n      || retouchType === 'manual-smooth'\n      || retouchType === 'manual-healing'\n      || retouchType === 'manual-dodge-burn';\n`,
  `    const retouchType = activeRetouchOperation?.type;\n    const supportsStroke = isStrokeRetouchType(retouchType);\n`,
);

replaceExact(
  canvas,
  `  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {\n    const rect = event.currentTarget.getBoundingClientRect();\n    const x = (event.clientX - rect.left) / zoom;\n    const y = (event.clientY - rect.top) / zoom;\n    if (currentDocument) {\n      const clickedLayer = currentDocument.layers.find((layer) => {\n        const tx = layer.transform ? layer.transform.e : 0;\n        const ty = layer.transform ? layer.transform.f : 0;\n        return x >= tx && x <= tx + (currentDocument?.canvas.width ?? 0) && y >= ty && y <= ty + (currentDocument?.canvas.height ?? 0);\n      });\n      if (clickedLayer) {\n        setActiveLayerId(clickedLayer.id);\n      } else {\n        setActiveLayerId(null);\n        setSelection(null);\n      }\n    }\n  }, [currentDocument, zoom, setActiveLayerId, setSelection]);\n`,
  `  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {\n    // A completed retouch stroke generates a click event after pointerup.\n    // Do not let that click silently retarget subsequent retouch operations.\n    if (isStrokeRetouchType(activeRetouchOperation?.type)) return;\n    if (!currentDocument) return;\n\n    const rect = event.currentTarget.getBoundingClientRect();\n    const point = clientPointToCanvasDocument(\n      event.clientX,\n      event.clientY,\n      rect,\n      canvasWidth,\n      canvasHeight,\n    );\n    const clickedLayer = findTopmostVisibleLayerAtPoint(\n      currentDocument.layers,\n      point,\n      currentDocument.canvas.width,\n      currentDocument.canvas.height,\n    );\n    if (clickedLayer) {\n      setActiveLayerId(clickedLayer.id);\n    } else {\n      setActiveLayerId(null);\n      setSelection(null);\n    }\n  }, [activeRetouchOperation, canvasHeight, canvasWidth, currentDocument, setActiveLayerId, setSelection]);\n`,
);

const panel = 'src/features/image-studio/components/ImageStudioRetouchPanel.tsx';
replaceExact(
  panel,
  "            data-testid={`retouch-add-${tool.label.toLowerCase().replace(/[^a-z]/g, '-')}`}\n",
  "            data-testid={`retouch-add-${tool.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`}\n",
);

write('src/features/image-studio/components/imageStudioCanvasInteraction.ts', `import type { ImageLayer } from '../../../core/image-studio/document/schema';\n\nconst STROKE_RETOUCH_TYPES = new Set([\n  'geometry-warp',\n  'manual-smooth',\n  'manual-healing',\n  'manual-dodge-burn',\n]);\n\nexport interface CanvasRectLike {\n  left: number;\n  top: number;\n  width: number;\n  height: number;\n}\n\nexport interface CanvasPoint {\n  x: number;\n  y: number;\n}\n\nexport function isStrokeRetouchType(type: string | null | undefined): boolean {\n  return typeof type === 'string' && STROKE_RETOUCH_TYPES.has(type);\n}\n\nexport function clientPointToCanvasDocument(\n  clientX: number,\n  clientY: number,\n  rect: CanvasRectLike,\n  canvasWidth: number,\n  canvasHeight: number,\n): CanvasPoint {\n  const scaleX = rect.width > 0 ? canvasWidth / rect.width : 1;\n  const scaleY = rect.height > 0 ? canvasHeight / rect.height : 1;\n  return {\n    x: Math.max(0, Math.min(canvasWidth, (clientX - rect.left) * scaleX)),\n    y: Math.max(0, Math.min(canvasHeight, (clientY - rect.top) * scaleY)),\n  };\n}\n\nexport function findTopmostVisibleLayerAtPoint(\n  layers: readonly ImageLayer[],\n  point: CanvasPoint,\n  canvasWidth: number,\n  canvasHeight: number,\n): ImageLayer | null {\n  for (let index = layers.length - 1; index >= 0; index -= 1) {\n    const layer = layers[index];\n    if (!layer.visible) continue;\n    const tx = layer.transform?.e ?? 0;\n    const ty = layer.transform?.f ?? 0;\n    if (\n      point.x >= tx\n      && point.x <= tx + canvasWidth\n      && point.y >= ty\n      && point.y <= ty + canvasHeight\n    ) {\n      return layer;\n    }\n  }\n  return null;\n}\n`);

write('tests/unit/retouch-phase3-canvas-targeting.test.ts', `import type { ImageLayer } from '../../src/core/image-studio/document/schema';\nimport {\n  clientPointToCanvasDocument,\n  findTopmostVisibleLayerAtPoint,\n  isStrokeRetouchType,\n} from '../../src/features/image-studio/components/imageStudioCanvasInteraction';\n\nfunction layer(id: string, visible = true, x = 0, y = 0): ImageLayer {\n  return {\n    id,\n    kind: 'raster',\n    name: id,\n    parentId: null,\n    visible,\n    locked: false,\n    positionLocked: false,\n    opacity: 1,\n    blendMode: 'normal',\n    transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: y },\n    clipped: false,\n    mask: null,\n    metadata: {},\n    createdAt: '2026-08-24T00:00:00.000Z',\n    updatedAt: '2026-08-24T00:00:00.000Z',\n    assetId: \`asset-\${id}\`,\n  } as ImageLayer;\n}\n\ndescribe('Phase 3 canvas retouch targeting', () => {\n  test('stroke retouch tools are identified without treating normal operations as brushes', () => {\n    expect(isStrokeRetouchType('geometry-warp')).toBe(true);\n    expect(isStrokeRetouchType('manual-healing')).toBe(true);\n    expect(isStrokeRetouchType('manual-smooth')).toBe(true);\n    expect(isStrokeRetouchType('manual-dodge-burn')).toBe(true);\n    expect(isStrokeRetouchType('makeup-tint')).toBe(false);\n    expect(isStrokeRetouchType(null)).toBe(false);\n  });\n\n  test('canvas client coordinates map correctly when CSS scaling is active', () => {\n    const point = clientPointToCanvasDocument(350, 250, { left: 100, top: 50, width: 500, height: 400 }, 1000, 800);\n    expect(point).toEqual({ x: 500, y: 400 });\n  });\n\n  test('overlapping layers select the topmost visible layer', () => {\n    const bottom = layer('bottom');\n    const top = layer('top');\n    expect(findTopmostVisibleLayerAtPoint([bottom, top], { x: 100, y: 100 }, 500, 500)?.id).toBe('top');\n  });\n\n  test('invisible top layer does not steal targeting from visible layer below', () => {\n    const bottom = layer('bottom');\n    const top = layer('top', false);\n    expect(findTopmostVisibleLayerAtPoint([bottom, top], { x: 100, y: 100 }, 500, 500)?.id).toBe('bottom');\n  });\n\n  test('point outside translated layers returns null', () => {\n    const translated = layer('translated', true, 600, 600);\n    expect(findTopmostVisibleLayerAtPoint([translated], { x: 100, y: 100 }, 200, 200)).toBeNull();\n  });\n});\n`);

console.log('Phase 3A remote repair applied.');
