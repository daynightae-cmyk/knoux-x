import fs from 'node:fs';
import path from 'node:path';

import {
  TOOL_CATEGORIES,
  TOOL_ENTRIES,
  capabilityState,
  findTool,
} from '../../src/features/tools/mobileToolsCatalog';
import { mobileCopyCoverage, mobileCopy } from '../../src/components/mobile/mobileCopyCatalog';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

/**
 * The tools hub is the product's central claim, so the catalog is checked
 * structurally: every card must resolve to a route that App.tsx actually renders
 * or to a panel component that exists in this repository. A card that points at
 * nothing is exactly the "primitive fake button" this app promised not to ship.
 */
describe('tools catalog contract', () => {
  const app = read('src/App.tsx');
  const panels = read('src/features/tools/MobileToolPanels.tsx');
  const store = read('src/store/appStore.ts');

  test('every id is unique', () => {
    const ids = TOOL_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every route card names a view App.tsx can render', () => {
    const routes = TOOL_ENTRIES.filter((entry) => entry.target.kind === 'route');
    expect(routes.length).toBeGreaterThan(8);
    routes.forEach((entry) => {
      if (entry.target.kind !== 'route') return;
      expect(store).toContain(`| '${entry.target.view}'`);
      expect(app).toContain(`case '${entry.target.view}'`);
    });
  });

  test('every panel card is a real exported component', () => {
    const panelEntries = TOOL_ENTRIES.filter((entry) => entry.target.kind === 'panel');
    expect(panelEntries.length).toBeGreaterThanOrEqual(7);
    panelEntries.forEach((entry) => {
      if (entry.target.kind !== 'panel') return;
      const expected = {
        frames: 'FrameExtractorTool',
        metadata: 'PhotoInspectorTool',
        palette: 'ColourPickerTool',
        grid: 'GridSplitterTool',
        merge: 'PhotoMergeTool',
        audioExtract: 'AudioExtractorTool',
        resolution: 'ResolutionCalculatorTool',
      }[entry.target.panel];
      expect(expected).toBeDefined();
      expect(panels).toContain(`export const ${expected}`);
    });
  });

  test('the hub wires each panel id to its component', () => {
    const hub = read('src/features/tools/MobileToolsHub.tsx');
    ['frames', 'metadata', 'palette', 'grid', 'merge', 'audioExtract', 'resolution'].forEach((id) => {
      expect(hub).toContain(id);
    });
  });

  test('no card borrows a capability the platform report does not define', () => {
    const capabilities = read('src/platform/platformCapabilities.ts');
    TOOL_ENTRIES.filter((entry) => entry.capability).forEach((entry) => {
      expect(capabilities).toContain(`${entry.capability}:`);
    });
  });

  test('every card is searchable in both languages', () => {
    const missingArabic = TOOL_ENTRIES
      .filter((entry) => entry.tags.length < 3 || !entry.tags.some((tag) => /[؀-ۿ]/.test(tag)))
      .map((entry) => entry.id);
    expect(missingArabic).toEqual([]);
  });

  test('every card belongs to a declared category and carries copy', () => {
    const categories = TOOL_CATEGORIES.map((category) => category.id);
    TOOL_ENTRIES.forEach((entry) => {
      expect(categories).toContain(entry.category);
      expect(entry.label.trim().length).toBeGreaterThan(1);
      expect(entry.blurb.trim().length).toBeGreaterThan(20);
    });
  });

  test('findTool resolves ids and refuses invented ones', () => {
    expect(findTool('frames')?.target.kind).toBe('panel');
    expect(findTool('definitely-not-a-tool')).toBeUndefined();
  });

  test('capability states map honestly, with the reason kept', () => {
    expect(capabilityState(undefined).state).toBe('supported');
    expect(capabilityState({ status: 'supported', provider: 'electron', limits: {} }).state).toBe('supported');
    expect(capabilityState({ status: 'requires-permission', provider: 'android-native', limits: {}, reason: 'needs access' }).state).toBe('permission');
    expect(capabilityState({ status: 'degraded', provider: 'android-webview', limits: {}, reason: 'no model' })).toEqual({ state: 'degraded', reason: 'no model' });
    expect(capabilityState({ status: 'unsupported', provider: 'ffmpeg', limits: {}, reason: 'desktop only' }).state).toBe('off');
  });
});

/**
 * Batch output depends on a native method that only exists in the generated
 * Android plugin. These checks keep the three layers — Java template, bridge,
 * tool — from drifting apart, which is how "saves one file at a time" tends to
 * come back without anyone deciding it should.
 */
describe('batch tile output contract', () => {
  const generator = read('tools/prepare-android-functional-closure.cjs');
  const bridge = read('src/platform/androidSafBridge.ts');
  const panels = read('src/features/tools/MobileToolPanels.tsx');
  const access = read('src/features/tools/toolFileAccess.ts');

  test('the SAF plugin template creates child documents in a picked tree', () => {
    expect(generator).toContain('public void createChild(PluginCall call)');
    expect(generator).toContain('DocumentsContract.createDocument(');
    expect(generator).toContain('buildChildDocumentsUriUsingTree');
    // A batch must not overwrite: the collision rule lives in the plugin.
    expect(generator).toContain('static String collisionSafeName(');
    expect(generator).toContain('result.put("created", true)');
  });

  test('the generator verifies its own createChild output', () => {
    expect(generator).toContain(`['KnouxSafPlugin.java', 'public void createChild(PluginCall call) {']`);
  });

  test('the bridge exposes tree creation and reports the stored name', () => {
    expect(bridge).toContain('createChild?(options: { uri: string; name: string; mimeType: string })');
    expect(bridge).toContain('export async function androidCreateChildDocument');
    expect(bridge).toContain('export function androidTreeCreateSupported');
    // An older installed build without the method must not look like a success.
    expect(bridge).toContain("typeof saf.createChild !== 'function'");
  });

  test('the file helper writes once into the folder and reads each file back', () => {
    expect(access).toContain('export async function saveToolFileIntoDirectory');
    expect(access).toContain('stored.byteLength !== bytes.byteLength');
    expect(access).toContain('export function toolDirectoryWriteSupported');
    expect(access).toContain('export async function pickToolDirectory');
  });

  test('the grid tool offers the batch route and keeps an honest fallback', () => {
    expect(panels).toContain('saveToolFileIntoDirectory');
    expect(panels).toContain('toolDirectoryWriteSupported');
    expect(panels).toContain('layoutTileGrid');
    // Both paths report saved/total, so a partial run never reads as complete.
    expect(panels).toMatch(/copy\('Tiles saved'\)} · \$\{saved\}\/\$\{[a-z]+\.length\}/);
    expect(panels).toContain('This build cannot create files inside a folder, so tiles save one by one.');
  });
});

/**
 * Mobile surfaces resolve Arabic through the shared catalog. A missing entry
 * silently shows English to an Arabic user, which is the exact defect the
 * directive calls out, so the catalog is required to be fully filled.
 */
describe('mobile copy catalog', () => {
  test('has no empty Arabic entries', () => {
    const coverage = mobileCopyCoverage();
    expect(coverage.missing).toEqual([]);
    expect(coverage.total).toBeGreaterThan(150);
  });

  test('resolves Arabic and passes English through', () => {
    expect(mobileCopy('Crop', 'ar')).toBe('اقتصاص');
    expect(mobileCopy('Crop', 'en')).toBe('Crop');
  });

  test('unknown strings fall back to the source rather than a key path', () => {
    expect(mobileCopy('Not In The Catalog', 'ar')).toBe('Not In The Catalog');
  });
});
