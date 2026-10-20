import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Android navigation drawer production contract', () => {
  const drawer = read('src/components/mobile/MobileGlassDrawer.tsx');
  const css = read('src/styles/android-visual-system.css');

  it('never uses a translucent drawer sheet over live page content', () => {
    expect(css).toContain('background-color: #0c0814;');
    expect(css).toContain('-webkit-backdrop-filter: none;');
    expect(css).toContain('background: #030207d9;');
    expect(css).toContain('.kmd-drawer > * { position: relative; z-index: 1; }');
  });

  it('owns focus, scroll and Escape while the drawer is open', () => {
    expect(drawer).toContain("document.body.style.overflow = 'hidden'");
    expect(drawer).toContain("event.key === 'Escape'");
    expect(drawer).toContain('closeButtonRef.current?.focus()');
    expect(drawer).toContain('aria-current={currentView === view ?');
  });

  it('gives navigation touches the Android minimum target size', () => {
    expect(css).toContain('.kmd-nav button {');
    expect(css).toContain('min-height: 52px;');
    expect(css).toContain('width: 48px;');
  });
});
