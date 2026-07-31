import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('player viewport layout contract', () => {
  const appSource = read('src/App.tsx');
  const boundarySource = read('src/features/player/PlayerViewportBoundary.tsx');
  const playerSource = read('src/features/player/PlayerView.tsx');
  const viewportCss = read('src/styles/player-viewport.css');

  test('mounts the player inside the dedicated viewport boundary', () => {
    expect(appSource).toContain("import { PlayerViewportBoundary }");
    expect(appSource).toContain("case 'player': return <PlayerViewportBoundary />");
    expect(appSource).toContain('data-current-view={currentView}');
    expect(appSource).toContain("import './styles/player-viewport.css'");
  });

  test('keeps empty and loaded media states mutually exclusive', () => {
    expect(playerSource).toMatch(/\{mediaUrl \? \([\s\S]*?<video[\s\S]*?\) : \([\s\S]*?className="empty-state"/);
  });

  test('provides all required video fit modes', () => {
    for (const mode of ['contain', 'cover', 'fill', 'original']) {
      expect(boundarySource).toContain(`value: '${mode}'`);
      expect(viewportCss).toContain(`data-fit-mode='${mode}'`);
    }
  });

  test('bounds every shell and player flex child', () => {
    expect(viewportCss).toContain('height: 100dvh');
    expect(viewportCss).toContain(".app-shell[data-current-view='player'] .view-transition");
    expect(viewportCss).toContain('.player-viewport-boundary .video-container');
    expect(viewportCss).toContain('min-height: 0');
    expect(viewportCss).toContain('min-width: 0');
    expect(viewportCss).toContain('overflow: hidden');
  });

  test('keeps controls in absolute overlays that do not consume document height', () => {
    expect(viewportCss).toContain('.player-viewport-boundary .controls-overlay');
    expect(viewportCss).toMatch(/\.player-viewport-boundary \.controls-overlay \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
    expect(viewportCss).toMatch(/\.player-viewport-toolbar \{[\s\S]*?position: absolute;/);
  });

  test('implements theater and cinema without adding viewport height', () => {
    expect(boundarySource).toContain("type DisplayMode = 'normal' | 'theater' | 'cinema'");
    expect(viewportCss).toContain("html[data-player-display-mode='theater']");
    expect(viewportCss).toContain("html[data-player-display-mode='cinema']");
  });
});
