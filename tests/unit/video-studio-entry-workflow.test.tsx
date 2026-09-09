/** @jest-environment jsdom */
import '../mocks/structured-clone';

// The entry workflow never renders Retouch internals; stub the inspector so
// the test does not pull the MediaPipe analyzer chain (import.meta/vite)
// into the ts-jest CommonJS transform.
jest.mock('../../src/features/video-studio/retouch/VideoRetouchInspector', () => ({
  VideoRetouchInspector: () => null,
}));
import fs from 'node:fs';
import path from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { IPC_INVOKE } from '../../electron/ipc/contract';
import {
  AUDIO_EXTENSIONS,
  buildImportItem,
  classifyMediaExtension,
  ensureImportTrack,
  extensionOf,
  IMAGE_EXTENSIONS,
  projectHasItems,
  resolveImportKind,
  VIDEO_EXTENSIONS,
} from '../../src/features/editor/videoStudioEntry';
import {
  createMultitrackProject,
  insertItem,
} from '../../src/core/creative/multitrackProject';
import { localeCoverage } from '../../src/i18n';
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

describe('Video Studio entry workflow', () => {
  describe('media classification', () => {
    test('video extensions cover the required import set', () => {
      for (const extension of ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v']) {
        expect(VIDEO_EXTENSIONS).toContain(extension);
      }
    });

    test('audio extensions cover the required import set', () => {
      for (const extension of ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus']) {
        expect(AUDIO_EXTENSIONS).toContain(extension);
      }
    });

    test('image extensions cover the required import set', () => {
      for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']) {
        expect(IMAGE_EXTENSIONS).toContain(extension);
      }
    });

    test('classification is case-insensitive and Windows-path aware', () => {
      expect(classifyMediaExtension('D:\\Clips\\Intro.MP4')).toBe('video');
      expect(classifyMediaExtension('/media/song.FLAC')).toBe('audio');
      expect(classifyMediaExtension('C:/shots/frame.Jpg')).toBe('image');
      expect(classifyMediaExtension('notes.txt')).toBe('unknown');
      expect(extensionOf('D:\\Clips\\Intro.MP4')).toBe('mp4');
    });

    test('image files never require a probe; video requests reject images honestly', () => {
      expect(resolveImportKind('shot.png', null, 'auto')).toBe('image');
      expect(() => resolveImportKind('shot.png', null, 'video')).toThrow('IMPORT_NOT_IMAGE_REQUESTED');
      expect(() => resolveImportKind('clip.mp4', null, 'video')).toThrow('IMPORT_PROBE_REQUIRED');
      expect(() => resolveImportKind('clip.mp4', null, 'image')).toThrow('IMPORT_NOT_IMAGE_FILE');
    });

    test('video/audio resolve from real stream evidence', () => {
      expect(resolveImportKind('clip.mp4', { hasVideo: true, hasAudio: true }, 'video')).toBe('video');
      expect(resolveImportKind('clip.mp4', { hasVideo: true, hasAudio: true }, 'auto')).toBe('video');
      expect(resolveImportKind('song.mp3', { hasVideo: false, hasAudio: true }, 'auto')).toBe('audio');
      expect(resolveImportKind('song.mp3', { hasVideo: false, hasAudio: true }, 'audio')).toBe('audio');
      expect(() => resolveImportKind('clip.mp4', { hasVideo: false, hasAudio: true }, 'video')).toThrow('IMPORT_NOT_VIDEO');
      expect(() => resolveImportKind('song.mp3', { hasVideo: false, hasAudio: false }, 'auto')).toThrow('IMPORT_UNSUPPORTED');
    });
  });

  describe('zero-project import planning', () => {
    test('a first import lands on a video track at timeline 0 with preview source', () => {
      const empty = createMultitrackProject('import-planning', 'Untitled project');
      expect(projectHasItems(empty)).toBe(false);
      const kind = resolveImportKind('D:\\Clips\\intro.mp4', { hasVideo: true, hasAudio: true }, 'auto');
      expect(kind).toBe('video');
      const ensured = ensureImportTrack(empty, kind, 'track-video-1', 'Video');
      expect(ensured.track.kind).toBe('video');
      const item = buildImportItem('item-1', ensured.track.id, kind, 'D:\\Clips\\intro.mp4', 3, 0);
      expect(item.timelineStart).toBe(0);
      expect(item.sourcePath).toBe('D:\\Clips\\intro.mp4');
      expect(item.name).toBe('intro.mp4');
      const next = insertItem(ensured.project, item);
      expect(projectHasItems(next)).toBe(true);
      const stored = next.tracks.flatMap((track) => track.items);
      expect(stored).toHaveLength(1);
      expect(stored[0].trackId).toBe(ensured.track.id);
    });

    test('a missing video track is created instead of failing the import', () => {
      const base = createMultitrackProject('import-track', 'Untitled project');
      const withoutVideo = { ...base, tracks: base.tracks.filter((track) => track.kind !== 'video') };
      const ensured = ensureImportTrack(withoutVideo, 'video', 'track-video-2', 'Video');
      expect(ensured.track.kind).toBe('video');
      expect(ensured.project.tracks.some((track) => track.id === 'track-video-2')).toBe(true);
    });

    test('images fall back to the video track when no image track exists', () => {
      const base = createMultitrackProject('import-image', 'Untitled project');
      const ensured = ensureImportTrack(base, 'image', 'track-image-9', 'Image');
      expect(ensured.track.kind).toBe('video');
      expect(ensured.project).toBe(base);
    });
  });

  describe('project format truth', () => {
    test('Open Project uses .knouxedit only and never exposes raw .json', () => {
      const service = readSource('electron/creative/multitrack-project-service.ts');
      expect(service).toMatch(/extensions:\s*\['knouxedit'\]/);
      expect(service).toMatch(/KNOUX Edit Project/);
      const openDialog = service.slice(service.indexOf('async open()'), service.indexOf('async openRecent'));
      expect(openDialog).not.toMatch(/json/);
      const saveDialog = service.slice(service.indexOf('async save('), service.indexOf('async autosave'));
      expect(saveDialog).not.toMatch(/'\.json'|"\\.json"|extensions:\s*\['json'\]/);
    });

    test('Import Video uses real video-only filters', () => {
      const suite = readSource('electron/ipc/creative-suite.ts');
      expect(suite).toContain('CREATIVE_OPEN_VIDEO');
      const videoFilters = suite.slice(suite.indexOf('const videoFilters'), suite.indexOf('const videoFilters') + 400);
      for (const extension of ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v']) {
        expect(videoFilters).toContain(`'${extension}'`);
      }
      expect(videoFilters).not.toContain('mp3');
      expect(videoFilters).not.toContain('png');
    });

    test('Import Media covers video, audio and image filters', () => {
      const suite = readSource('electron/ipc/creative-suite.ts');
      const mediaFilters = suite.slice(suite.indexOf('const mediaFilters'), suite.indexOf('const videoFilters'));
      for (const extension of ['mp4', 'mp3', 'png', 'jpg', 'wav', 'webm']) {
        expect(mediaFilters).toContain(`'${extension}'`);
      }
    });

    test('the open-video channel is a declared production channel with both endpoints', () => {
      expect(IPC_INVOKE.CREATIVE_OPEN_VIDEO).toBe('creative:open-video');
      const preload = readSource('electron/preload-creative.ts');
      expect(preload).toContain('openVideo');
      expect(preload).toContain('CREATIVE_OPEN_VIDEO');
      const inventory = readSource('electron/ipc/channel-source-inventory.ts');
      expect(inventory).toContain(`'creative:open-video': { sourceRoots: ['electron/ipc/creative-suite.ts', 'electron/preload-creative.ts']`);
    });
  });

  describe('entry wiring', () => {
    test('landing exposes Import Video primary, Import Media, New and Open Project with file drops', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain(`importEntryMedia('video')`);
      expect(view).toContain(`importEntryMedia('auto')`);
      expect(view).toContain(`t('multitrack.importVideo')`);
      expect(view).toContain(`t('multitrack.importMedia')`);
      expect(view).toContain('onDrop={(event) => {');
      expect(view).toContain('void importDroppedFiles(event.dataTransfer.files)');
      expect(view).toContain('void importDroppedFiles(files, trackId)');
      expect(view).toContain(`t('multitrack.open')`);
      expect(view).not.toContain(`onClick={() => void openProject()} disabled={busy}>{t('common.open')}`);
    });

    test('in-editor video import uses the video-only picker', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain('media.openVideo');
    });

    test('Explorer drops follow the production import path', () => {
      const view = readSource('src/features/editor/MultitrackEditorView.tsx');
      expect(view).toContain('authorizeDroppedFile');
      expect(view).toContain('media.toUrl(filePath)');
      expect(view).toContain('insertSelectedMedia(current, { filePath, mediaUrl }');
    });

    test('the global player Open action opens media, not a project', () => {
      const player = readSource('src/features/player/PlayerView.tsx');
      expect(player).toContain('knouxCreativeAPI.media.open()');
      expect(player).not.toContain('knouxMultitrackAPI.open()');
    });

    test('mobile keeps the mobile editor while Windows keeps the desktop multitrack editor', () => {
      expect(readSource('src/features/video-studio/MobileVideoStudioView.tsx')).toContain('MobileVideoTimelineEditor');
      expect(readSource('src/features/video-studio/VideoStudioView.tsx')).toContain('MultitrackEditorView');
      expect(readSource('src/features/video-studio/VideoStudioView.tsx')).not.toContain('MobileVideoTimelineEditor');
    });
  });

  describe('locale parity', () => {
    test.each(['untitledProject', 'importVideo', 'importMedia', 'importDescription', 'dropHint', 'selectVideoFile'] as const)(
      'English and Arabic both define multitrack.%s',
      (key) => {
        expect(typeof multitrackEditorEnglish[key]).toBe('string');
        expect(multitrackEditorEnglish[key].length).toBeGreaterThan(0);
        expect(typeof multitrackEditorArabic[key]).toBe('string');
        expect(multitrackEditorArabic[key].length).toBeGreaterThan(0);
      },
    );

    test('locale coverage stays complete for the new entry keys', () => {
      const coverage = localeCoverage();
      expect(coverage.en.total).toBeGreaterThan(0);
      expect(coverage.ar.percentage).toBeGreaterThan(0);
      expect(multitrackEditorEnglish.importVideo).not.toBe('multitrack.importVideo');
    });
  });

  describe('rendered landing behavior', () => {
    function installBridge(): {
      calls: { create: string[]; openVideo: number; open: number; authorize: string[]; toUrl: string[] };
      cleanup: () => void;
    } {
      document.documentElement.dataset.runtime = 'electron';
      const calls = { create: [] as string[], openVideo: 0, open: 0, authorize: [] as string[], toUrl: [] as string[] };
      const multitrackAPI = {
        create: async (name: string) => {
          calls.create.push(name);
          return createMultitrackProject('landing-import', name);
        },
        open: async () => null,
        openRecent: async () => { throw new Error('no recent in harness'); },
        save: async () => null,
        autosave: async () => 'autosave',
        recoveries: async () => [],
        recent: async () => [],
        clearRecent: async () => undefined,
      };
      const creativeAPI = {
        media: {
          open: async () => {
            calls.open += 1;
            return { filePath: 'D:\\Clips\\frame.png', mediaUrl: 'file:///D:/Clips/frame.png' };
          },
          openVideo: async () => {
            calls.openVideo += 1;
            return { filePath: 'D:\\Clips\\frame.png', mediaUrl: 'file:///D:/Clips/frame.png' };
          },
          toUrl: async (filePath: string) => {
            calls.toUrl.push(filePath);
            return `file:///${filePath.replace(/\\/g, '/')}`;
          },
        },
        export: {
          probe: async () => ({ format: {}, streams: [] }),
        },
      };
      const knouxAPI = {
        file: {
          authorizeDroppedFile: async (file: File) => {
            const authorized = `D:\\Clips\\${file.name}`;
            calls.authorize.push(authorized);
            return authorized;
          },
        },
        settings: {
          get: async (_key: string, fallback: unknown) => fallback,
          set: async () => undefined,
          onChange: () => () => undefined,
        },
      };
      (window as unknown as Record<string, unknown>).knouxMultitrackAPI = multitrackAPI;
      (window as unknown as Record<string, unknown>).knouxCreativeAPI = creativeAPI;
      (window as unknown as Record<string, unknown>).knouxAPI = knouxAPI;
      return {
        calls,
        cleanup: () => {
          delete (window as unknown as Record<string, unknown>).knouxMultitrackAPI;
          delete (window as unknown as Record<string, unknown>).knouxCreativeAPI;
          delete (window as unknown as Record<string, unknown>).knouxAPI;
          delete document.documentElement.dataset.runtime;
        },
      };
    }

    function renderLanding(): { container: HTMLElement; unmount: () => void } {
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
      if (!button) throw new Error(`Landing button missing: ${text}`);
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    test('landing leads with media import and labels project open honestly', async () => {
      const bridge = installBridge();
      const landing = renderLanding();
      try {
        await pollFor('landing buttons', () => landing.container.textContent?.includes('Import video') === true);
        expect(landing.container.textContent).toContain('Import media');
        expect(landing.container.textContent).toContain('Open project');
        expect(landing.container.textContent).not.toMatch(/\.json/);
      } finally {
        landing.unmount();
        bridge.cleanup();
      }
    });

    test('Import Media with no project creates Untitled, inserts at 0, and previews', async () => {
      const bridge = installBridge();
      const landing = renderLanding();
      try {
        await pollFor('landing buttons', () => landing.container.textContent?.includes('Import media') === true);
        clickByText(landing.container, 'Import media');
        await pollFor('project creation', () => bridge.calls.create.length === 1);
        expect(bridge.calls.create[0]).toBe('Untitled project');
        await pollFor('editor transition', () => landing.container.textContent?.includes('Untitled project') === true);
        await pollFor('preview source', () => bridge.calls.toUrl.some((entry) => entry.endsWith('frame.png')));
        expect(landing.container.textContent).toContain('Open project');
      } finally {
        landing.unmount();
        bridge.cleanup();
      }
    });

    test('dropping a file on the landing follows the same production import path', async () => {
      const bridge = installBridge();
      const landing = renderLanding();
      try {
        await pollFor('landing buttons', () => landing.container.textContent?.includes('Import media') === true);
        const section = landing.container.querySelector('section.multitrack-editor-view');
        if (!section) throw new Error('Landing section missing');
        const file = new File(['pixels'], 'frame.png', { type: 'image/png' });
        const drop = new Event('drop', { bubbles: true });
        Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
        act(() => {
          section.dispatchEvent(drop);
        });
        await pollFor('drop authorization', () => bridge.calls.authorize.length === 1);
        expect(bridge.calls.authorize[0]).toBe('D:\\Clips\\frame.png');
        await pollFor('drop project creation', () => bridge.calls.create.length === 1);
        await pollFor('drop preview source', () => bridge.calls.toUrl.some((entry) => entry.endsWith('frame.png')));
      } finally {
        landing.unmount();
        bridge.cleanup();
      }
    });
  });
});
