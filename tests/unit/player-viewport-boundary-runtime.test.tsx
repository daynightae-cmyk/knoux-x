/** @jest-environment jsdom */

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { PlayerViewportBoundary } from '../../src/features/player/PlayerViewportBoundary';

jest.mock('lucide-react', () => ({
  Activity: () => null,
}));

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../src/store/playerStore', () => ({
  usePlayerStore: (selector: (state: { isPlaying: boolean }) => unknown) => selector({ isPlaying: false }),
}));

jest.mock('../../src/features/player/PlayerDiagnosticsPanel', () => ({
  PlayerDiagnosticsPanel: ({ children }: { children?: ReactNode }) => <aside>{children}</aside>,
}));

jest.mock('../../src/features/player/PlayerView', () => ({
  PlayerView: () => (
    <div className="player-view">
      <div className="video-container">
        <video className="video-element" />
      </div>
      <div className="controls-overlay" />
    </div>
  ),
}));

interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
}

function renderViewport(): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlayerViewportBoundary />);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function clickByText(container: HTMLElement, text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('PlayerViewportBoundary runtime state', () => {
  afterEach(() => {
    delete document.documentElement.dataset.playerDisplayMode;
  });

  test('updates the live viewport fit mode from every production toolbar action', () => {
    const rendered = renderViewport();
    const boundary = rendered.container.querySelector<HTMLElement>('.player-viewport-boundary');
    expect(boundary?.dataset.fitMode).toBe('contain');

    const labels = {
      contain: 'playerViewport.fit',
      cover: 'playerViewport.fill',
      fill: 'playerViewport.stretch',
      original: 'playerViewport.original',
    } as const;
    for (const mode of ['cover', 'fill', 'original', 'contain'] as const) {
      clickByText(rendered.container, labels[mode]);
      expect(boundary?.dataset.fitMode).toBe(mode);
    }

    expect(rendered.container.querySelector('.video-container .video-element')).not.toBeNull();
    rendered.unmount();
  });

  test('synchronizes normal, theater, and cinema toolbar state to the document root', () => {
    const rendered = renderViewport();
    const boundary = rendered.container.querySelector<HTMLElement>('.player-viewport-boundary');

    clickByText(rendered.container, 'playerViewport.theater');
    expect(boundary?.dataset.displayMode).toBe('theater');
    expect(document.documentElement.dataset.playerDisplayMode).toBe('theater');

    clickByText(rendered.container, 'playerViewport.cinema');
    expect(boundary?.dataset.displayMode).toBe('cinema');
    expect(document.documentElement.dataset.playerDisplayMode).toBe('cinema');

    clickByText(rendered.container, 'playerViewport.normal');
    expect(boundary?.dataset.displayMode).toBe('normal');
    expect(document.documentElement.dataset.playerDisplayMode).toBe('normal');

    rendered.unmount();
    expect(document.documentElement.dataset.playerDisplayMode).toBeUndefined();
  });
});
