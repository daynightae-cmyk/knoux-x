import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_INLINE_FILTER_LENGTH,
  buildSlideshowRenderPlan,
} from '../../src/core/creative/slideshowRender';
import {
  buildSlideshowExecution,
  windowsCommandLineLength,
  type SlideshowExecutionCapability,
  WINDOWS_SAFE_COMMAND_LENGTH,
} from '../../src/core/creative/slideshowExecution';
import {
  createSlideshowProject,
  createSlideshowSlide,
} from '../../src/core/creative/slideshowProject';

function capability(
  overrides: Partial<SlideshowExecutionCapability> = {}
): SlideshowExecutionCapability {
  return {
    executablePath: 'C:\\KNOUX\\resources\\ffmpeg.exe',
    version: 'ffmpeg version 6.1.1',
    supportsFilterComplexScript: true,
    supportsModernFilterFileSyntax: true,
    detectedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('slideshow execution bounding (Windows command-line safety)', () => {
  let work: string;
  let media: string;
  let workspace: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-exec-work-'));
    media = path.join(work, 'media');
    workspace = path.join(work, 'job');
    await fs.mkdir(media, { recursive: true });
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    // Windows can transiently lock freshly staged hard links (antivirus/Indexer);
    // retry before surfacing the cleanup error instead of flaking the suite.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(work, { recursive: true, force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    await fs.rm(work, { recursive: true, force: true });
  });

  async function slideshowFor(slideCount: number): Promise<import('../../src/core/creative/slideshowRender').SlideshowRenderPlan> {
    const project = createSlideshowProject('large', 'Large');
    project.resolution = '1080p';
    project.fps = 30;
    project.slides = Array.from({ length: slideCount }, (_, index) => {
      const name = `slide-${index}.jpg`;
      return createSlideshowSlide({
        id: `slide-${String(index).padStart(3, '0')}`,
        sourcePath: `${media}/${name}`,
        kind: 'image',
        duration: 3,
        transition: 'crossfade',
        transitionDuration: 0.5,
      });
    });
    for (let index = 0; index < slideCount; index += 1) {
      await fs.writeFile(`${media}/slide-${index}.jpg`, `jit-${index}`);
    }
    const assets = {
      slideSources: Object.fromEntries(
        project.slides.map((slide) => [slide.id, slide.sourcePath])
      ),
      slideMetadata: Object.fromEntries(
        project.slides.map((slide) => [slide.id, { duration: slide.duration, hasAudio: false }])
      ),
      audioMetadata: {},
    };
    return buildSlideshowRenderPlan(project, assets, path.join(work, 'out.mp4'), 'mp4');
  }

  function createSlideProject(name = 'Slide') {
    const project = createSlideshowProject(name, name, 'social-vertical');
    project.resolution = '1080p';
    project.fps = 30;
    return project;
  }

  test('72 slides stay below the safe command-line ceiling via short aliases', async () => {
    const plan = await slideshowFor(72);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    expect(exec.strategy).toBe('short-alias');
    expect(exec.stagedInputs).toHaveLength(72);
    expect(exec.commandLineLength).toBeLessThanOrEqual(WINDOWS_SAFE_COMMAND_LENGTH);
    expect(exec.args.some((argument) => argument.endsWith('in000.jpg'))).toBe(true);
    expect(exec.args).not.toContain(`${media}/slide-0.jpg`);
    expect(windowsCommandLineLength(exec.executablePath!, exec.args)).toBe(
      exec.commandLineLength
    );
  });

  test('100 slides stay below the safe max-line ceiling after staging', async () => {
    const plan = await slideshowFor(100);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    expect(exec.commandLineLength).toBeLessThanOrEqual(WINDOWS_SAFE_COMMAND_LENGTH);
    expect(exec.stagedInputs).toHaveLength(100);
  });

  test('250 slides are staged so the final command stays bounded', async () => {
    // 500+ filesystem operations (write fixtures, hard-link/copy staging, filter script);
    // antivirus and parallel-suite I/O contention can exceed the default 5s on Windows.
    const plan = await slideshowFor(250);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    expect(exec.strategy).toBe('short-alias');
    expect(exec.stagedInputs).toHaveLength(250);
    expect(exec.commandLineLength).toBeLessThanOrEqual(WINDOWS_SAFE_COMMAND_LENGTH);
  }, 30_000);

  test('long Arabic/Unicode user paths are replaced by short aliases', async () => {
    const ArabicPath = `${work}/مجلد طويل جداً غير عربي ١٢٣/صورة ٠١.jpg`;
    await fs.mkdir(path.dirname(ArabicPath), { recursive: true });
    await fs.writeFile(ArabicPath, 'bytes');
    const project = createSlideProject('Arabic');
    project.slides = [
      createSlideshowSlide({
        id: 's1',
        sourcePath: ArabicPath,
        kind: 'image',
        duration: 3,
        transition: 'none',
        transitionDuration: 0,
      }),
    ];
    const plan = buildSlideshowRenderPlan(
      project,
      {
        slideSources: { s1: ArabicPath },
        slideMetadata: { s1: { duration: 3, hasAudio: false } },
        audioMetadata: {},
      },
      path.join(work, 'out.mp4'),
      'mp4'
    );
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    expect(exec.args.some((argument) => argument.endsWith('in000.jpg'))).toBe(true);
    expect(exec.args).not.toContain(ArabicPath);
    expect(exec.commandLineLength).toBeLessThanOrEqual(WINDOWS_SAFE_COMMAND_LENGTH);
  });

  test('hard-link failure falls back to byte-safe copy staging', async () => {
    const linkSpy = jest.spyOn(fs, 'link').mockRejectedValue(new Error('EXDEV cross-device'));
    try {
      const plan = await slideshowFor(6);
      const exec = await buildSlideshowExecution(plan, {
        executablePath: capability().executablePath,
        capability: capability(),
        isWindows: true,
        workspaceRoot: workspace,
      });
      expect(exec.stagedInputs.every((record) => record.source === 'copy')).toBe(true);
      expect(exec.stagedInputs).toHaveLength(6);
      for (const record of exec.stagedInputs) {
        expect((await fs.stat(record.alias)).size).toBe(
          (await fs.stat(record.original)).size
        );
      }
    } finally {
      linkSpy.mockRestore();
    }
  });

  test('staging failure prevents spawn by rejecting the execution plan', async () => {
    const missing = `${work}/missing-وغير-موجود-الطويل-بالعربية-المرصودة.jpg`;
    const project = createSlideProject();
    project.slides = [
      createSlideshowSlide({
        id: 's1',
        sourcePath: missing,
        kind: 'image',
        duration: 3,
        transition: 'none',
        transitionDuration: 0,
      }),
    ];
    const plan = buildSlideshowRenderPlan(
      project,
      {
        slideSources: { s1: missing },
        slideMetadata: { s1: { duration: 3, hasAudio: false } },
        audioMetadata: {},
      },
      path.join(work, 'out.mp4'),
      'mp4'
    );
    const built = buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    await expect(built).rejects.toThrow(/missing/);
  });

  test('job workspace removal clears current-job short aliases', async () => {
    const plan = await slideshowFor(8);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: true,
      workspaceRoot: workspace,
    });
    expect(exec.stagedInputs.length).toBeGreaterThan(0);
    for (const record of exec.stagedInputs) {
      expect(path.dirname(record.alias)).toBe(workspace);
      expect(record.original.startsWith(`${media}${path.sep}`)).toBe(true);
    }
    await fs.rm(workspace, { recursive: true, force: true });
    for (const record of exec.stagedInputs) {
      await expect(fs.access(record.alias)).rejects.toThrow();
    }
  });

  test('unsupported filter-script syntax keeps a bounded inline fallback', async () => {
    const plan = await slideshowFor(30);
    expect(plan.filterComplexString.length).toBeGreaterThan(MAX_INLINE_FILTER_LENGTH);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability({ supportsFilterComplexScript: false }),
      isWindows: false,
      workspaceRoot: workspace,
    });
    expect(exec.strategy).toBe('direct-bounded');
    expect(exec.args).toContain('-filter_complex');
    expect(exec.commandLineLength).toBeLessThanOrEqual(WINDOWS_SAFE_COMMAND_LENGTH);
  });

  test('supported filter syntax moves the graph to a bounded script file', async () => {
    const plan = await slideshowFor(40);
    const exec = await buildSlideshowExecution(plan, {
      executablePath: capability().executablePath,
      capability: capability(),
      isWindows: false,
      workspaceRoot: workspace,
    });
    expect(exec.strategy).toBe('file-backed-filter');
    expect(exec.args).toContain('-filter_complex_script');
    expect(exec.args).not.toContain('-filter_complex');
    expect(exec.filterScriptPath).toBeDefined();
    await expect(fs.access(exec.filterScriptPath!)).resolves.toBeUndefined();
  });
});