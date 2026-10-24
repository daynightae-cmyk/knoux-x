import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isTrustedNavigationTarget } from '../../electron/security/navigation-target';

/**
 * Directive §5: the renderer may only navigate inside its own packaged
 * directory (or the Forge dev origin), never to arbitrary file:// documents
 * or remote origins. Renderer-created windows are denied by policy; only
 * validated https/mailto URLs reach the OS browser.
 */
describe('renderer navigation policy', () => {
  const rendererRoot = path.join('C:', 'apps', 'knoux', 'resources', 'app.asar', '.vite', 'renderer');

  test('packaged renderer documents inside the renderer root are trusted', () => {
    const index = pathToFileURL(path.join(rendererRoot, 'main_window', 'index.html')).toString();
    const asset = pathToFileURL(path.join(rendererRoot, 'main_window', 'assets', 'index-abc.js')).toString();
    expect(isTrustedNavigationTarget(index, { rendererRoot })).toBe(true);
    expect(isTrustedNavigationTarget(`${asset}#fragment`, { rendererRoot })).toBe(true);
  });

  test('file documents outside the renderer root are rejected', () => {
    const outside = pathToFileURL(path.join('C:', 'apps', 'knoux', 'resources', 'app.asar', 'package.json')).toString();
    const traversal = pathToFileURL(path.join(rendererRoot, '..', '..', '..', 'evil.html')).toString();
    const siblingPrefix = pathToFileURL(path.join(`${rendererRoot}-evil`, 'index.html')).toString();
    expect(isTrustedNavigationTarget(outside, { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget(traversal, { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget(siblingPrefix, { rendererRoot })).toBe(false);
  });

  test('remote origins are rejected outside the dev server', () => {
    expect(isTrustedNavigationTarget('https://example.com/', { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget('http://localhost:5173/', { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget('javascript:alert(1)', { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget('data:text/html,<script>alert(1)</script>', { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget('not a url', { rendererRoot })).toBe(false);
    expect(isTrustedNavigationTarget('', { rendererRoot })).toBe(false);
  });

  test('the Forge dev-server origin is trusted only during development', () => {
    const devServerUrl = 'http://localhost:5173';
    expect(isTrustedNavigationTarget('http://localhost:5173/editor', { rendererRoot, devServerUrl })).toBe(true);
    expect(isTrustedNavigationTarget('http://127.0.0.1:5173/editor', { rendererRoot, devServerUrl })).toBe(false);
    expect(isTrustedNavigationTarget('https://localhost:5173/', { rendererRoot, devServerUrl })).toBe(false);
  });

  test('a file navigation without a renderer root is rejected', () => {
    expect(isTrustedNavigationTarget('file:///C:/Windows/System32/drivers/etc/hosts', {})).toBe(false);
  });
});
