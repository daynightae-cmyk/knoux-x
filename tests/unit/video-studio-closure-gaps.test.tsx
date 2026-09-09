/** @jest-environment jsdom */
import '../mocks/structured-clone';

// The closure tests never render Retouch internals; stub the inspector so
// the test does not pull the MediaPipe analyzer chain (import.meta/vite)
// into the ts-jest CommonJS transform.
jest.mock('../../src/features/video-studio/retouch/VideoRetouchInspector', () => ({
  VideoRetouchInspector: () => null,
}));
import fs from 'node:fs';
import path from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { transitionFadeOpacity } from '../../src/core/creative/transitionFade';
import { createMultitrackProject, type TimelineTransition } from '../../src/core/creative/multitrackProject';
import { multitrackEditorArabic, multitrackEditorEnglish } from '../../src/locales/multitrackEditor';
import { MultitrackEditorView } from '../../src/features/editor/MultitrackEditorView';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

async function pollFor(label: string, check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Video Studio closure gaps', () => {
  describe('shared transition fade math', () => {
    test('no transitions preserves the base opacity', () => {
      expect(transitionFadeOpacity(0.8, null, null, 2, 10)).toBeCloseTo(0.8);
      expect(transitionFadeOpacity(1, undefined, undefined, 0, 5)).toBe(1);
    });

    test('fade-in ramps from zero across its duration', () => {
      const fadeIn: TimelineTransition = { id: 'a', kind: 'fade-black', duration: 2, direction: 'left', color: '#000' };
      expect(transitionFadeOpacity(1, fadeIn, null, 0, 10)).toBe(0);
      expect(transitionFadeOpacity(1, fadeIn, null, 1, 10)).toBeCloseTo(0.5);
      expect(transitionFadeOpacity(1, fadeIn, null, 2, 10)).toBe(1);
      expect(transitionFadeOpacity(1, fadeIn, null, 9, 10)).toBe(1);
    });

    test('fade-out ramps to zero at the item end', () => {
      const out: TimelineTransition = { id: 'b', kind: 'fade-white', duration: 2, direction: 'left', color: '#fff' };
      expect(transitionFadeOpacity(1, null, out, 8, 10)).toBe(1);
      expect(transitionFadeOpacity(1, null, out, 9, 10)).toBeCloseTo(0.5);
      expect(transitionFadeOpacity(1, null, out, 10, 10)).toBe(0);
    });

    test('combined fades multiply and clamp honestly', () => {
      const fadeIn: TimelineTransition = { id: 'a', kind: 'cross-dissolve', duration: 2, direction: 'left', color: '#000' };
      const fadeOut: TimelineTransition = { id: 'b', kind: 'cross-dissolve', duration: 2, direction: 'left', color: '#000' };
      expect(transitionFadeOpacity(0.5, fadeIn, fadeOut, 1, 10)).toBeCloseTo(0.25);
      expect(transitionFadeOpacity(2, null, null, 1, 10)).toBe(1);
      expect(transitionFadeOpacity(1, fadeIn, null, -5, 10)).toBe(0);
      expect(transitionFadeOpacity(1, { ...fadeIn, duration: 0 }, null, 1, 10)).toBe(1);
    });
  });

  describe('transition output wiring', () => {
    test('the mobile timeline renderer bakes the shared fade', () => {
      const renderer = readSource('src/features/export/mobileTimelineRenderer.ts');
      expect(renderer).toContain('transitionFadeOpacity');
      expect(renderer).toContain('transitionOpacity(item, localTime)');
    });

    test('the desktop program monitor applies the shared fade to video and image previews', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain('transitionFadeOpacity(');
      expect(view).toContain('previewOpacity');
      expect(view).toContain('opacity: previewOpacity');
    });

    test('the transition control discloses the honest preview semantic', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain(`t('multitrack.transitionPreviewNote')`);
      expect(multitrackEditorEnglish.transitionPreviewNote).toContain('opacity fades');
      expect(multitrackEditorArabic.transitionPreviewNote.length).toBeGreaterThan(0);
    });
  });

  describe('recent media wiring', () => {
    test('the landing reads production playback history and reopens items through open-item', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain('knouxAPI.library.getHistory');
      expect(view).toContain('knouxCreativeAPI.library.openItem');
      expect(view).toContain('importRecentMediaItem');
      expect(view).toContain(`t('multitrack.recentMedia')`);
      expect(view).toContain(`t('multitrack.noRecentMedia')`);
      expect(multitrackEditorEnglish.recentMedia).toBe('Recent media');
      expect(multitrackEditorArabic.recentMedia.length).toBeGreaterThan(0);
    });

    test('playback history is recorded from real player usage', () => {
      const player = readSource('src/features/player/PlayerView.tsx');
      expect(player).toContain('library.updatePlayback');
    });
  });

  describe('rendered closure behavior', () => {
    function installBridge(history: Array<Record<string, unknown>> = []): {
      calls: { create: string[]; openItem: string[]; toUrl: string[] };
      cleanup: () => void;
    } {
      document.documentElement.dataset.runtime = 'electron';
      const calls = { create: [] as string[], openItem: [] as string[], toUrl: [] as string[] };
      (window as unknown as Record<string, unknown>).knouxMultitrackAPI = {
        create: async (name: string) => {
          calls.create.push(name);
          return createMultitrackProject('closure-gaps', name);
        },
        open: async () => null,
        openRecent: async () => { throw new Error('no recent in harness'); },
        save: async () => null,
        autosave: async () => 'autosave',
        recoveries: async () => [],
        recent: async () => [],
        clearRecent: async () => undefined,
      };
      (window as unknown as Record<string, unknown>).knouxCreativeAPI = {
        media: {
          open: async () => ({ filePath: 'D:\\Clips\\frame.png', mediaUrl: 'file:///D:/Clips/frame.png' }),
          openVideo: async () => null,
          toUrl: async (filePath: string) => {
            calls.toUrl.push(filePath);
            return `file:///${filePath.replace(/\\/g, '/')}`;
          },
        },
        export: {
          probe: async (filePath: string) => {
            const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
            const streams = [];
            if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension)) {
              streams.push({ codec_type: 'video', codec_name: 'h264', width: 640, height: 360 });
            }
            if (['mp4', 'mov', 'mkv', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(extension)) {
              streams.push({ codec_type: 'audio', codec_name: 'aac' });
            }
            return { format: {}, streams };
          },
        },
        library: {
          openItem: async (filePath: string) => {
            calls.openItem.push(filePath);
            return { filePath, mediaUrl: `file:///${filePath.replace(/\\/g, '/')}` };
          },
        },
      };
      (window as unknown as Record<string, unknown>).knouxAPI = {
        file: {
          authorizeDroppedFile: async (file: File) => `D:\\Clips\\${file.name}`,
        },
        settings: {
          get: async (_key: string, fallback: unknown) => fallback,
          set: async () => undefined,
          onChange: () => () => undefined,
        },
        library: {
          getHistory: async () => history,
        },
      };
      const originalPrompt = window.prompt;
      window.prompt = () => '1';
      return {
        calls,
        cleanup: () => {
          delete (window as unknown as Record<string, unknown>).knouxMultitrackAPI;
          delete (window as unknown as Record<string, unknown>).knouxCreativeAPI;
          delete (window as unknown as Record<string, unknown>).knouxAPI;
          delete document.documentElement.dataset.runtime;
          window.prompt = originalPrompt;
        },
      };
    }

    function renderEditor(): { container: HTMLElement; unmount: () => void } {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(<MultitrackEditorView />);
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
      const button = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent?.includes(text));
      if (!button) throw new Error(`Button missing: ${text}`);
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    test('recent media strip imports through open-item with an auto-created project', async () => {
      const bridge = installBridge([{ path: 'D:\\Clips\\song.mp3', title: 'Song', type: 'audio', duration: 180 }]);
      const editor = renderEditor();
      let restoreMedia: (() => void) | null = null;
      try {
        await pollFor('recent media strip', () => editor.container.textContent?.includes('Recent media') === true);
        await pollFor('history entry', () => editor.container.textContent?.includes('Song') === true);
        // jsdom media elements never fire loadedmetadata; complete durations
        // deterministically so the import can resolve them like a decoder would.
        const originalCreate = document.createElement.bind(document);
        (document as unknown as Record<string, unknown>).createElement = (tag: string, ...rest: unknown[]) => {
          const element = originalCreate(tag, ...(rest as []));
          if (tag === 'video' || tag === 'audio') {
            Object.defineProperty(element, 'duration', { value: 12, configurable: true });
            setTimeout(() => element.dispatchEvent(new Event('loadedmetadata')), 0);
          }
          return element;
        };
        restoreMedia = () => {
          (document as unknown as Record<string, unknown>).createElement = originalCreate;
        };
        clickByText(editor.container, 'Song');
        await pollFor('history open-item', () => bridge.calls.openItem.length === 1);
        expect(bridge.calls.openItem[0]).toBe('D:\\Clips\\song.mp3');
        await pollFor('history project creation', () => bridge.calls.create.length === 1);
        expect(bridge.calls.create[0]).toBe('Untitled project');
        await pollFor('history preview source', () => bridge.calls.toUrl.some((entry) => entry.endsWith('song.mp3')));
      } finally {
        restoreMedia?.();
        editor.unmount();
        bridge.cleanup();
      }
    });

    test('a transition-in visibly fades the program monitor preview', async () => {
      const bridge = installBridge();
      const editor = renderEditor();
      try {
        await pollFor('landing buttons', () => editor.container.textContent?.includes('Import media') === true);
        clickByText(editor.container, 'Import media');
        await pollFor('preview element', () => editor.container.querySelector('.knoux-media-frame img') !== null);
        const image = editor.container.querySelector('.knoux-media-frame img') as HTMLImageElement;
        expect(image.style.opacity).toBe('1');
        // Open the Transition in dropdown and pick a real fade kind.
        const selects = Array.from(editor.container.querySelectorAll('.neon-select'));
        const transitionSelect = selects.find((entry) => entry.textContent?.includes('Transition in') || entry.parentElement?.textContent?.includes('Transition in'));
        const trigger = (transitionSelect ?? editor.container).querySelector('.neon-select-trigger') as HTMLButtonElement | null;
        const hostLabel = transitionSelect?.parentElement?.querySelector('span')?.textContent ?? '';
        expect(`${hostLabel} ${transitionSelect?.textContent ?? ''}`).toContain('Transition in');
        if (!trigger) throw new Error('Transition trigger missing');
        act(() => {
          trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await pollFor('transition options', () => document.body.textContent?.includes('fade-black') === true || editor.container.textContent?.includes('fade-black') === true);
        const option = Array.from(document.querySelectorAll('[role="option"]')).concat(Array.from(editor.container.querySelectorAll('[role="option"]')))
          .find((entry) => entry.textContent === 'fade-black');
        if (!option) throw new Error('fade-black option missing');
        act(() => {
          (option as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        // Playhead 0 inside a 1s fade-in: the preview must be fully faded.
        await pollFor('faded preview', () => (editor.container.querySelector('.knoux-media-frame img') as HTMLImageElement | null)?.style.opacity === '0');
        expect((editor.container.querySelector('.knoux-media-frame img') as HTMLImageElement).style.opacity).toBe('0');
      } finally {
        editor.unmount();
        bridge.cleanup();
      }
    });
  });
});
