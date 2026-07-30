const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('KNOUX Phase 02 source integration', () => {
  test('mounts the production error boundary and system overlay', () => {
    const mainEntry = read('src/main.tsx');

    expect(mainEntry).toContain("./components/system/ErrorBoundary");
    expect(mainEntry).toContain("./components/system/SystemOverlay");
    expect(mainEntry).toContain('<ErrorBoundary>');
    expect(mainEntry).toContain('<SystemOverlay />');
  });

  test('keeps reviewed theme presets data-only and bounded', () => {
    const themeCatalog = read('src/theme/knouxThemeCatalog.ts');

    expect(themeCatalog).toContain("'neon-cyan'");
    expect(themeCatalog).toContain("'neon-purple'");
    expect(themeCatalog).toContain("'midnight-gold'");
    expect(themeCatalog).not.toContain('electron');
    expect(themeCatalog).not.toContain('window.knouxAPI');
  });

  test('does not import archive mocks into the production entry point', () => {
    const mainEntry = read('src/main.tsx');

    expect(mainEntry).not.toContain('MockElectron');
    expect(mainEntry).not.toContain('IPCCommunicationHub');
    expect(mainEntry).not.toContain('placeholder.com');
  });

  test('ships responsive diagnostics and reduced-motion handling', () => {
    const styles = read('src/components/system/system-overlay.css');

    expect(styles).toContain('@media (max-width: 820px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
