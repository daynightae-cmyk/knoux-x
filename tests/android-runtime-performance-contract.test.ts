import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_WORKSPACE_SETTINGS } from '../src/core/settings/productCustomization';
import { normalizeRuntimeWorkspace } from '../src/core/settings/runtimeWorkspace';

const root = path.resolve(__dirname, '..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Android runtime performance and recovery contract', () => {
  test('keeps beauty workers and observers out of Android startup', () => {
    const main = read('src/main.tsx');
    const optionalRuntime = read('src/platform/AndroidOptionalRuntime.tsx');

    expect(main).toContain('AndroidOptionalRuntime');
    expect(main).not.toContain("import { AndroidBeautyExtension } from './platform/AndroidBeautyExtension'");
    expect(main).not.toContain("import { AndroidBodyBeautyExtension } from './platform/AndroidBodyBeautyExtension'");
    expect(optionalRuntime).toContain("currentView === 'image-studio'");
    expect(optionalRuntime).toContain("import('./AndroidBeautyExtension')");
    expect(optionalRuntime).toContain("import('./AndroidBodyBeautyExtension')");
  });

  test('does not install desktop command interception on Android', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('!android && (');
    expect(app).toContain('<CommandShortcutController />');
    expect(app).toContain('<Sprint02CommandRuntime />');
  });

  test('fails Android smoke when the renderer recovery boundary appears', () => {
    const boundary = read('src/components/system/ErrorBoundary.tsx');
    const smoke = read('tools/android-emulator-smoke.sh');

    expect(boundary).toContain('KNOUX_RENDER_BOUNDARY_ERROR');
    expect(smoke).toContain('KNOUX_RENDER_BOUNDARY_ERROR');
    expect(smoke).toContain('KNOUX RECOVERY MODE');
  });

  test('removes expensive Android backdrop blur and view transitions', () => {
    const css = read('src/styles/android-performance.css');
    expect(css).toContain('backdrop-filter: none !important');
    expect(css).toContain('transition: none !important');
  });

  test('repairs malformed legacy workspace settings instead of throwing', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(normalizeRuntimeWorkspace({})).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    warning.mockRestore();
  });
});
