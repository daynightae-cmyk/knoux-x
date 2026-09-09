/**
 * KNOUX-X — PACKAGED WINDOWS RETOUCH E2E (test-only main-process handler)
 *
 * Activated ONLY by the explicit `--retouch-e2e` executable flag and ONLY in
 * a packaged executable. It drives the REAL packaged main window (the same
 * trust boundary production IPC requires) through the REAL product workflow:
 *
 *   vanilla boot -> renderer ready (build identity) -> authorize fixture ->
 *   source probe (ExportService) -> reload main window with the query-gated
 *   test-only renderer module (same bundle, same production retouch classes) ->
 *   media open via creative:path-to-media-url -> Chromium decode -> verified
 *   packaged pose model via image-studio:get-pose-model -> BodyAnalysisClient /
 *   VideoBodyTracker / VideoFrameProcessor -> preview pixel delta ->
 *   processed frames pulled to main -> mux via production FFmpegService ->
 *   FINAL output via the REAL product ExportService.export preset pipeline ->
 *   ffprobe reopen + raw-frame baked pixel delta -> atomic evidence -> exit.
 *
 * Returning true guarantees normal desktop startup must not continue.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import { ExportService } from '../creative/export-service';
import { FFmpegService } from '../creative/ffmpeg-service';
import { authorizeMediaPaths } from '../ipc/setup';
import { getMainWindow } from '../window';

const FLAG = '--retouch-e2e';
const EVIDENCE_PREFIX = '--retouch-e2e-evidence=';
const SOURCE_PREFIX = '--retouch-e2e-source=';
const OUTPUT_PREFIX = '--retouch-e2e-output=';
const QUERY_FLAG = 'knouxRetouchE2E';
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 360;
const FRAME_COUNT = 45;
const FPS = 15;
const BRIDGE_TIMEOUT_MS = 60000;
const E2E_TIMEOUT_MS = 15 * 60 * 1000;

interface RetouchE2EArgs {
  evidencePath: string;
  sourcePath: string;
  outputPath: string;
}

function parseArgs(argv: readonly string[]): RetouchE2EArgs | null {
  if (!argv.includes(FLAG)) return null;
  const evidencePath = argv.find((argument) => argument.startsWith(EVIDENCE_PREFIX))?.slice(EVIDENCE_PREFIX.length) ?? '';
  const sourcePath = argv.find((argument) => argument.startsWith(SOURCE_PREFIX))?.slice(SOURCE_PREFIX.length) ?? '';
  const outputPath = argv.find((argument) => argument.startsWith(OUTPUT_PREFIX))?.slice(OUTPUT_PREFIX.length) ?? '';
  if (!path.isAbsolute(evidencePath) || path.extname(evidencePath).toLowerCase() !== '.json') {
    throw new Error('PACKAGED_RETOUCH_E2E_BAD_EVIDENCE_PATH');
  }
  for (const [label, value] of [['source', sourcePath], ['output', outputPath]] as const) {
    if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.mp4') {
      throw new Error(`PACKAGED_RETOUCH_E2E_BAD_${label.toUpperCase()}_PATH`);
    }
  }
  return { evidencePath, sourcePath, outputPath };
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridge(window: BrowserWindow, timeoutMs = BRIDGE_TIMEOUT_MS): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (window.isDestroyed()) throw new Error('PACKAGED_RETOUCH_E2E_WINDOW_DESTROYED');
    try {
      const ready = await window.webContents.executeJavaScript(
        `typeof window.knouxRuntime === 'object' && window.knouxRuntime !== null
          && typeof window.knouxAPI === 'object' && typeof window.knouxAPI.system?.getBuildInfo === 'function'
          && typeof window.knouxCreativeAPI === 'object' && typeof window.knouxImageStudioAPI === 'object'`,
        true,
      );
      if (ready === true) return;
    } catch {
      // Renderer still hydrating; retry until the timeout below.
    }
    if (Date.now() - started > timeoutMs) throw new Error('PACKAGED_RETOUCH_E2E_BRIDGE_NOT_READY');
    await sleep(250);
  }
}

async function waitForE2E(window: BrowserWindow): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    if (window.isDestroyed()) throw new Error('PACKAGED_RETOUCH_E2E_WINDOW_DESTROYED');
    const snapshot = (await window.webContents.executeJavaScript(
      `(() => {
        const status = window.__knouxRetouchE2E;
        if (!status) return { present: false, done: false };
        return {
          present: true,
          done: status.done === true,
          failed: typeof status.failed === 'string' ? status.failed.slice(0, 4000) : null,
          summary: status.done && !status.failed ? status.summary : null,
          frames: Array.isArray(status.frames) ? status.frames.length : 0,
          frameEvidence: Array.isArray(status.frameEvidence) ? status.frameEvidence.length : 0,
        };
      })()`,
      true,
    )) as { present: boolean; done: boolean; failed: string | null; summary: Record<string, unknown> | null; frames: number; frameEvidence: number };
    if (snapshot.present && snapshot.done) {
      if (snapshot.failed) throw new Error(`PACKAGED_RETOUCH_E2E_RENDERER_FAILED ${snapshot.failed}`);
      if (!snapshot.summary) throw new Error('PACKAGED_RETOUCH_E2E_RENDERER_EMPTY_SUMMARY');
      return snapshot.summary;
    }
    if (Date.now() - started > E2E_TIMEOUT_MS) {
      throw new Error(`PACKAGED_RETOUCH_E2E_TIMEOUT present=${snapshot.present} frames=${snapshot.frames} evidence=${snapshot.frameEvidence}`);
    }
    await sleep(2000);
  }
}

async function pullFrames(window: BrowserWindow, count: number): Promise<string[]> {
  const frames: string[] = [];
  const chunk = 5;
  for (let offset = 0; offset < count; offset += chunk) {
    const slice = (await window.webContents.executeJavaScript(
      `(() => window.__knouxRetouchE2E.frames.slice(${offset}, ${offset + chunk}))()`,
      true,
    )) as string[];
    if (!Array.isArray(slice) || slice.length === 0) throw new Error(`PACKAGED_RETOUCH_E2E_FRAME_PULL_FAILED offset=${offset}`);
    for (const dataUrl of slice) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error(`PACKAGED_RETOUCH_E2E_FRAME_NOT_PNG offset=${offset}`);
      }
      frames.push(dataUrl);
    }
  }
  if (frames.length !== count) throw new Error(`PACKAGED_RETOUCH_E2E_FRAME_COUNT_MISMATCH expected=${count} actual=${frames.length}`);
  return frames;
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function writeDataUrlPng(dataUrl: string, filePath: string): Promise<void> {
  const payload = dataUrl.slice('data:image/png;base64,'.length);
  await fs.writeFile(filePath, Buffer.from(payload, 'base64'));
}

export async function maybeRunPackagedRetouchE2E(argv: readonly string[]): Promise<boolean> {
  const args = parseArgs(argv);
  if (!args) return false;
  const startedAt = new Date().toISOString();
  try {
    if (!app.isPackaged) throw new Error('Packaged Retouch E2E refuses to run outside a packaged executable.');
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('PACKAGED_RETOUCH_E2E_NO_MAIN_WINDOW');

    // 1. Vanilla boot of the REAL packaged application: renderer ready + build identity.
    await waitForBridge(mainWindow);
    const vanillaIdentity = (await mainWindow.webContents.executeJavaScript(
      `(() => Promise.all([window.knouxAPI.system.getBuildInfo(), window.knouxAPI.system.getInfo()]).then(([build, system]) => ({ build, system })))()`,
      true,
    )) as { build: Record<string, unknown>; system: Record<string, unknown> };
    if (vanillaIdentity.build.packaged !== true) throw new Error('PACKAGED_RETOUCH_E2E_NOT_PACKAGED_IDENTITY');
    const rendererReady = true;

    // 2. Authorize + probe the real fixture through production services.
    const authorized = authorizeMediaPaths([args.sourcePath]);
    if (!authorized.includes(path.resolve(args.sourcePath)) && !authorized.includes(args.sourcePath)) {
      throw new Error('PACKAGED_RETOUCH_E2E_SOURCE_NOT_AUTHORIZED');
    }
    const sourceBytes = await fs.readFile(args.sourcePath);
    const sourceSha256 = sha256Hex(sourceBytes);
    const exports = new ExportService();
    const ffmpeg = new FFmpegService();
    const sourceProbe = await exports.probe(args.sourcePath);

    // 3. Boot the SAME packaged renderer with the query-gated test-only module.
    const indexPath = path.join(__dirname, '..', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html');
    await mainWindow.loadFile(indexPath, { query: { [QUERY_FLAG]: '1', source: args.sourcePath } });
    await waitForBridge(mainWindow);
    const summary = await waitForE2E(mainWindow);

    // 4. Pull processed frames and persist them for the export pipeline.
    const frameCount = Number(summary.frameCount);
    if (!Number.isInteger(frameCount) || frameCount <= 0 || frameCount > FRAME_COUNT) {
      throw new Error(`PACKAGED_RETOUCH_E2E_BAD_FRAME_COUNT ${String(summary.frameCount)}`);
    }
    const workRoot = path.join(tmpdir(), `knoux-packaged-retouch-e2e-${process.pid}`);
    const processedDir = path.join(workRoot, 'processed');
    await fs.mkdir(processedDir, { recursive: true });
    const frames = await pullFrames(mainWindow, frameCount);
    for (let index = 0; index < frames.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await writeDataUrlPng(frames[index], path.join(processedDir, `${String(index).padStart(3, '0')}.png`));
    }

    // 5. Mux processed frames + original audio with the production FFmpegService,
    //    then produce the FINAL artifact through the REAL product export path:
    //    ExportService.export with a product preset (probe-validated, partial+rename).
    const intermediatePath = path.join(workRoot, 'retouch-intermediate.mp4');
    await ffmpeg.run([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(processedDir, '%03d.png'),
      '-i',
      args.sourcePath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-shortest',
      intermediatePath,
    ]);
    const job = await exports.export({
      inputPath: intermediatePath,
      presetId: 'high-quality',
      outputPath: args.outputPath,
      overwrite: true,
    });
    if (!job || job.status !== 'completed' || !job.outputPath) throw new Error('PACKAGED_RETOUCH_E2E_EXPORT_NOT_COMPLETED');
    const exportCompleted = true;
    const outputProbe = await exports.probe(job.outputPath);
    const outputStreams = outputProbe.streams ?? [];
    const outputVideoCodec = outputStreams.find((stream) => stream.codec_type === 'video')?.codec_name ?? null;
    const outputAudioCodec = outputStreams.find((stream) => stream.codec_type === 'audio')?.codec_name ?? null;

    // 6. Reopen: extract raw RGB frames from source and output, prove baked delta.
    const sourceRaw = path.join(workRoot, 'source-000.raw');
    const outputRaw = path.join(workRoot, 'output-000.raw');
    await ffmpeg.run(['-hide_banner', '-nostdin', '-y', '-i', args.sourcePath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', sourceRaw]);
    await ffmpeg.run(['-hide_banner', '-nostdin', '-y', '-i', job.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', outputRaw]);
    const sourcePixels = await fs.readFile(sourceRaw);
    const outputPixels = await fs.readFile(outputRaw);
    const expectedBytes = FRAME_WIDTH * FRAME_HEIGHT * 3;
    if (sourcePixels.length !== expectedBytes || outputPixels.length !== expectedBytes) {
      throw new Error(`PACKAGED_RETOUCH_E2E_RAW_SIZE_MISMATCH source=${sourcePixels.length} output=${outputPixels.length}`);
    }
    let reopenedBakedPixelDelta = 0;
    for (let index = 0; index < expectedBytes; index += 1) reopenedBakedPixelDelta += Math.abs(sourcePixels[index] - outputPixels[index]);
    const reopened = true;

    await atomicJson(args.evidencePath, {
      schemaVersion: 1,
      product: 'Knoux X',
      mode: 'packaged-retouch-e2e',
      success: true,
      packaged: app.isPackaged,
      executable: app.getPath('exe'),
      packageVersion: app.getVersion(),
      rendererReady,
      vanillaIdentity,
      sourcePath: args.sourcePath,
      sourceSha256,
      sourceProbe,
      renderer: summary,
      previewPixelDelta: summary.previewPixelDelta,
      workRoot,
      intermediatePath,
      exportJob: job,
      exportCompleted,
      exportPath: job.outputPath,
      outputProbe,
      outputVideoCodec,
      outputAudioCodec,
      reopened,
      reopenedBakedPixelDelta,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    app.exit(0);
  } catch (error) {
    console.error('PACKAGED_RETOUCH_E2E_FAILED', error);
    try {
      await atomicJson(args.evidencePath, {
        schemaVersion: 1,
        product: 'Knoux X',
        mode: 'packaged-retouch-e2e',
        success: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } catch {
      // Evidence write is best-effort on failure; the exit code still signals FAIL.
    }
    app.exit(1);
  }
  return true;
}
