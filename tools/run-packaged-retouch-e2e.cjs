/**
 * KNOUX-X — WINDOWS PACKAGED RETOUCH E2E DRIVER
 *
 * Drives the REAL packaged Knoux X application (out/Knoux X-win32-x64/
 * knoux-player-x.exe) through the production Retouch workflow and verifies
 * every gate independently from outside the application:
 *
 *   Phase A: launch packaged EXE with --retouch-e2e -> the in-app handler
 *     (electron/startup/packaged-retouch-e2e.ts) performs media open, Video
 *     Studio checks, Body Retouch with a deterministic nonzero control,
 *     preview pixel delta, and export through the REAL product ExportService.
 *     This driver then independently re-verifies with the PACKAGED
 *     ffmpeg.exe/ffprobe.exe binaries: output exists, FFprobe streams,
 *     reopen decode, baked pixel delta > 0, audio present.
 *   Phase B: relaunch WITHOUT flags -> renderer healthy; second-instance
 *     argv/Open With -> APP_OPEN_MEDIA received with the fixture path.
 *
 * Writes:
 *   reports/windows-packaged-retouch-e2e.json   (machine-readable gate)
 *   reports/WINDOWS-PACKAGED-RETOUCH-E2E.md      (human-readable evidence)
 *
 * Exit code is nonzero unless verdict === 'PASS'.
 */
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const ffmpegPath = path.join(packageRoot, 'resources', 'ffmpeg.exe');
const ffprobePath = path.join(packageRoot, 'resources', 'ffprobe.exe');
const sourceVideo = path.join(root, 'tests', 'fixtures', 'retouch-real', 'army-exercise.mp4');
const outputPath = path.join(root, 'reports', 'retouch-packaged-e2e-output.mp4');
const runtimeEvidencePath = path.join(root, 'reports', 'windows-packaged-retouch-e2e-runtime.json');
const finalEvidencePath = path.join(root, 'reports', 'windows-packaged-retouch-e2e.json');
const finalReportPath = path.join(root, 'reports', 'WINDOWS-PACKAGED-RETOUCH-E2E.md');
const logPath = path.join(root, 'reports', 'windows-packaged-retouch-e2e-run.log');

const E2E_TIMEOUT_MS = 20 * 60 * 1000;
const RELAUNCH_TIMEOUT_MS = 120000;

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  fs.appendFileSync(logPath, line, 'utf8');
}

function requireFile(filePath, label) {
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`PACKAGED_RETOUCH_E2E_MISSING ${label} ${filePath}`);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function ffprobeJson(target) {
  const run = childProcess.spawnSync(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', target,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`FFPROBE_FAILED ${target} ${run.stderr || run.error}`);
  return JSON.parse(run.stdout);
}

function extractRawFrame(target, seekSeconds, rawPath, width, height) {
  const args = ['-hide_banner', '-nostdin', '-y'];
  if (seekSeconds > 0) args.push('-ss', String(seekSeconds));
  args.push('-i', target, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath);
  const run = childProcess.spawnSync(ffmpegPath, args, { encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (run.status !== 0) throw new Error(`FRAME_EXTRACT_FAILED ${target} t=${seekSeconds}`);
  const pixels = fs.readFileSync(rawPath);
  if (pixels.length !== width * height * 3) {
    throw new Error(`RAW_SIZE_MISMATCH ${target} expected=${width * height * 3} actual=${pixels.length}`);
  }
  return pixels;
}

function bakedDelta(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += Math.abs(left[index] - right[index]);
  return sum;
}

function streamOf(probe, type) {
  return (probe.streams || []).find((stream) => stream.codec_type === type) || null;
}

function git(commandArgs) {
  try {
    return childProcess.execFileSync('git', commandArgs, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function phaseB() {
  const { _electron } = require('playwright');
  const result = { relaunchSuccess: false, argvOpenWithSuccess: false, detail: {} };
  let app = null;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath, args: [], env, timeout: RELAUNCH_TIMEOUT_MS });
    const page = await app.firstWindow({ timeout: RELAUNCH_TIMEOUT_MS });
    await page.waitForFunction(
      `typeof window.knouxRuntime === 'object' && window.knouxRuntime !== null
        && typeof window.knouxAPI === 'object' && typeof window.knouxAPI.system?.getBuildInfo === 'function'
        && typeof window.knouxAPI.app?.onOpenMedia === 'function'`,
      null,
      { timeout: RELAUNCH_TIMEOUT_MS },
    );
    const identity = await page.evaluate(`(async () => ({
      build: await window.knouxAPI.system.getBuildInfo(),
      system: await window.knouxAPI.system.getInfo(),
    }))()`);
    result.detail.identity = identity;
    if (identity.build && identity.build.packaged === true && identity.build.product === 'Knoux X') {
      result.relaunchSuccess = true;
    }
    await page.evaluate(`window.__argvSeen = null;
      window.knouxAPI.app.onOpenMedia((paths) => { window.__argvSeen = paths; });`);
    const second = childProcess.spawn(executablePath, [sourceVideo], {
      cwd: packageRoot,
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });
    second.unref();
    const deadline = Date.now() + 60000;
    for (;;) {
      const seen = await page.evaluate(`window.__argvSeen`);
      if (Array.isArray(seen) && seen.some((entry) => path.resolve(entry) === path.resolve(sourceVideo))) {
        result.argvOpenWithSuccess = true;
        result.detail.argvSeen = seen;
        break;
      }
      if (Date.now() > deadline) {
        result.detail.argvSeen = seen;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    result.detail.error = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    try {
      if (app) await app.close();
    } catch (error) {
      result.detail.closeError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const tasklist = childProcess.spawnSync('tasklist', ['/FI', 'IMAGENAME eq knoux-player-x.exe', '/FO', 'CSV'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    result.detail.orphans = (tasklist.stdout || '').split('\n').filter((line) => line.includes('knoux-player-x.exe')).length;
  } catch {
    result.detail.orphans = null;
  }
  return result;
}

async function main() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  const startedAt = new Date().toISOString();
  logLine(`packagedExe=${executablePath}`);
  requireFile(executablePath, 'packaged executable');
  requireFile(ffmpegPath, 'packaged ffmpeg');
  requireFile(ffprobePath, 'packaged ffprobe');
  requireFile(sourceVideo, 'source fixture');
  try { fs.rmSync(outputPath, { force: true }); } catch { /* fresh output */ }
  try { fs.rmSync(runtimeEvidencePath, { force: true }); } catch { /* fresh evidence */ }

  const headSha = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']);
  logLine(`head=${headSha} branch=${branch}`);

  logLine('Phase A: launching packaged app with --retouch-e2e');
  const launch = childProcess.spawnSync(executablePath, [
    '--retouch-e2e',
    `--retouch-e2e-evidence=${runtimeEvidencePath}`,
    `--retouch-e2e-source=${sourceVideo}`,
    `--retouch-e2e-output=${outputPath}`,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: E2E_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const combinedLog = [launch.stdout || '', launch.stderr || '', launch.error ? String(launch.error.stack || launch.error) : ''].filter(Boolean).join('\n');
  fs.appendFileSync(logPath, combinedLog, 'utf8');
  logLine(`Phase A exit status=${launch.status} signal=${launch.signal || 'none'}`);
  if (launch.error || launch.status !== 0) throw new Error(`PACKAGED_RETOUCH_E2E_PROCESS_FAILED status=${launch.status} signal=${launch.signal || 'none'}`);
  requireFile(runtimeEvidencePath, 'runtime evidence');
  const runtime = JSON.parse(fs.readFileSync(runtimeEvidencePath, 'utf8'));
  if (!runtime.success) throw new Error(`PACKAGED_RETOUCH_E2E_RUNTIME_FAILED ${runtime.error || ''}`.slice(0, 2000));

  const renderer = runtime.renderer || {};
  const sourceProbe = ffprobeJson(sourceVideo);
  const outputProbe = ffprobeJson(outputPath);
  const sourceVideoStream = streamOf(sourceProbe, 'video');
  const outputVideoStream = streamOf(outputProbe, 'video');
  const outputAudioStream = streamOf(outputProbe, 'audio');
  const outputVideoCodec = outputVideoStream ? outputVideoStream.codec_name : null;
  const outputAudioCodec = outputAudioStream ? outputAudioStream.codec_name : null;
  const width = Number(outputVideoStream ? outputVideoStream.width : 0);
  const height = Number(outputVideoStream ? outputVideoStream.height : 0);
  if (!(width > 0 && height > 0)) throw new Error('PACKAGED_RETOUCH_E2E_OUTPUT_NO_VIDEO_STREAM');

  const workRaw = path.join(root, 'reports', '.packaged-retouch-e2e-raw');
  fs.mkdirSync(workRaw, { recursive: true });
  const sourceRaw0 = path.join(workRaw, 'source-000.raw');
  const outputRaw0 = path.join(workRaw, 'output-000.raw');
  const sourceRawMid = path.join(workRaw, 'source-mid.raw');
  const outputRawMid = path.join(workRaw, 'output-mid.raw');
  const sourcePixels0 = extractRawFrame(sourceVideo, 0, sourceRaw0, width, height);
  const outputPixels0 = extractRawFrame(outputPath, 0, outputRaw0, width, height);
  const reopenedBakedPixelDelta = bakedDelta(sourcePixels0, outputPixels0);
  const sourcePixelsMid = extractRawFrame(sourceVideo, 1.5, sourceRawMid, width, height);
  const outputPixelsMid = extractRawFrame(outputPath, 1.5, outputRawMid, width, height);
  const reopenedBakedPixelDeltaMid = bakedDelta(sourcePixelsMid, outputPixelsMid);
  try { fs.rmSync(workRaw, { recursive: true, force: true }); } catch { /* best effort */ }

  const sourceSha256 = sha256File(sourceVideo);
  const outputExists = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
  const exportCompleted = runtime.exportCompleted === true && outputExists;
  const reopened = reopenedBakedPixelDelta > 0 && reopenedBakedPixelDeltaMid > 0;
  logLine(`previewPixelDelta=${renderer.previewPixelDelta} baked0=${reopenedBakedPixelDelta} bakedMid=${reopenedBakedPixelDeltaMid}`);

  logLine('Phase B: relaunch + argv/Open With verification');
  const relaunch = await phaseB();
  logLine(`relaunchSuccess=${relaunch.relaunchSuccess} argvOpenWithSuccess=${relaunch.argvOpenWithSuccess} orphans=${relaunch.detail.orphans}`);

  const previewPixelDelta = Number(renderer.previewPixelDelta);
  const gate = {
    packagedExe: executablePath,
    packageVersion: runtime.packageVersion || (relaunch.detail.identity ? relaunch.detail.identity.build.version : null),
    sourceVideo,
    sourceSha256,
    rendererReady: runtime.rendererReady === true && renderer.rendererReady === true,
    mediaOpened: renderer.mediaOpened === true,
    videoStudioReady: renderer.videoStudioReady === true,
    retouchReady: renderer.retouchReady === true,
    bodyDetectionCount: Number(renderer.bodyDetectionCount),
    bodyTrackId: String(renderer.bodyTrackId || ''),
    strokeCount: Number(renderer.strokeCount),
    previewPixelDelta,
    exportCompleted,
    exportPath: outputPath,
    outputExists,
    outputFfprobe: outputProbe,
    outputVideoCodec,
    outputAudioCodec,
    reopened,
    reopenedBakedPixelDelta,
    reopenedBakedPixelDeltaMid,
    relaunchSuccess: relaunch.relaunchSuccess,
    argvOpenWithSuccess: relaunch.argvOpenWithSuccess,
    verdict: 'FAIL',
  };
  const pass = (
    gate.rendererReady
    && gate.mediaOpened
    && gate.videoStudioReady
    && gate.retouchReady
    && Number.isFinite(gate.bodyDetectionCount) && gate.bodyDetectionCount > 0
    && typeof gate.bodyTrackId === 'string' && gate.bodyTrackId.length > 0
    && Number.isFinite(gate.strokeCount) && gate.strokeCount > 0
    && Number.isFinite(previewPixelDelta) && previewPixelDelta > 0
    && exportCompleted
    && outputExists
    && reopened
    && outputVideoCodec === 'h264'
    && outputAudioCodec === 'aac'
    && relaunch.relaunchSuccess
    && relaunch.argvOpenWithSuccess
  );
  gate.verdict = pass ? 'PASS' : 'FAIL';

  const finalEvidence = {
    schemaVersion: 1,
    product: 'Knoux X',
    mode: 'windows-packaged-retouch-e2e',
    ...gate,
    renderer,
    runtimeEvidencePath,
    sourceProbe: { format: sourceProbe.format || null, video: sourceVideoStream, audio: streamOf(sourceProbe, 'audio') },
    outputDuration: outputProbe.format ? outputProbe.format.duration : null,
    outputResolution: `${width}x${height}`,
    exportJob: runtime.exportJob || null,
    relaunch: relaunch.detail,
    testedHead: headSha,
    testedBranch: branch,
    logPath,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(finalEvidencePath, `${JSON.stringify(finalEvidence, null, 2)}\n`, 'utf8');

  const lines = [
    '# WINDOWS PACKAGED RETOUCH E2E — Knoux X',
    '',
    `- verdict: **${gate.verdict}**`,
    `- packagedExe: ${gate.packagedExe}`,
    `- packageVersion: ${gate.packageVersion}`,
    `- testedHead: ${headSha}`,
    `- testedBranch: ${branch}`,
    `- sourceVideo: ${gate.sourceVideo}`,
    `- sourceSha256: ${gate.sourceSha256}`,
    `- rendererReady: ${gate.rendererReady}`,
    `- mediaOpened: ${gate.mediaOpened} (${renderer.mediaUrl || 'n/a'})`,
    `- videoStudioReady: ${gate.videoStudioReady} (providers: ${renderer.videoStudioProviders ?? 'n/a'})`,
    `- retouchReady: ${gate.retouchReady}`,
    `- bodyDetectionCount: ${gate.bodyDetectionCount}`,
    `- bodyTrackId: ${gate.bodyTrackId}`,
    `- strokeCount: ${gate.strokeCount}`,
    `- confidenceMin: ${renderer.confidenceMin ?? 'n/a'}`,
    `- freezeCoverage: ${renderer.freezeCoverageMin ?? 'n/a'} - ${renderer.freezeCoverageMax ?? 'n/a'}`,
    `- previewPixelDelta: ${gate.previewPixelDelta}`,
    `- exportCompleted: ${gate.exportCompleted}`,
    `- exportPath: ${gate.exportPath}`,
    `- outputExists: ${gate.outputExists}`,
    `- outputVideoCodec: ${gate.outputVideoCodec}`,
    `- outputAudioCodec: ${gate.outputAudioCodec}`,
    `- outputResolution: ${width}x${height}`,
    `- outputDuration: ${outputProbe.format ? outputProbe.format.duration : 'n/a'}`,
    `- reopened: ${gate.reopened}`,
    `- reopenedBakedPixelDelta (t=0): ${gate.reopenedBakedPixelDelta}`,
    `- reopenedBakedPixelDelta (t=1.5s): ${gate.reopenedBakedPixelDeltaMid}`,
    `- relaunchSuccess: ${gate.relaunchSuccess}`,
    `- argvOpenWithSuccess: ${gate.argvOpenWithSuccess}`,
    `- orphan knoux-player-x processes after close: ${relaunch.detail.orphans ?? 'n/a'}`,
    '',
    '## Production path exercised',
    '',
    '- Real packaged EXE launch, vanilla renderer boot, build identity (packaged=true).',
    '- Fixture authorized via authorizeMediaPaths; media opened via production creative:path-to-media-url IPC.',
    '- Video Studio production IPC (list-providers/provider-status) on the real renderer.',
    '- Verified packaged pose model via production image-studio:get-pose-model IPC (resources/assets/models/pose_landmarker_full.task).',
    '- Real Chromium decode of tests/fixtures/retouch-real/army-exercise.mp4 (Video Studio preview path).',
    '- Body Retouch enabled with deterministic control waist:-65/torsoWidth:-35 strength:100 via production createVideoRetouchState/addVideoRetouchLayer.',
    '- Preview pixels via production VideoFrameProcessor (same class VideoRetouchPreviewOverlay renders with); zero/disabled/before controls verified at 0 delta; background freeze verified at 0 delta.',
    '- Export multiplexed with production FFmpegService (packaged ffmpeg.exe), final artifact produced by the REAL product ExportService.export high-quality preset (probe-validated, partial+rename).',
    '- Reopen verified independently with packaged ffprobe.exe/ffmpeg.exe (raw rgb24 baked delta at t=0 and t=1.5s).',
    '- Relaunch without flags: renderer healthy; second-instance file argv forwarded as APP_OPEN_MEDIA (Open With path intact).',
    '',
    `- runtime evidence: ${runtimeEvidencePath}`,
    `- run log: ${logPath} (local-only, gitignored)`,
    `- completed: ${finalEvidence.completedAt}`,
    '',
  ];
  fs.writeFileSync(finalReportPath, lines.join('\n'), 'utf8');
  logLine(`verdict=${gate.verdict}`);

  if (!pass) {
    process.stderr.write(`WINDOWS_PACKAGED_RETOUCH_E2E verdict=FAIL evidence=${finalEvidencePath}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`WINDOWS_PACKAGED_RETOUCH_E2E verdict=PASS evidence=${finalEvidencePath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
