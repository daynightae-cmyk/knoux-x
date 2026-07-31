const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const reportRoot = path.join(root, 'reports', 'native-completion', 'sprint-01');
const inspectionRoot = path.join(reportRoot, 'asar-inspection');
const packageRoot = path.join(root, 'out', 'KNOUX Player X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const asarPath = path.join(packageRoot, 'resources', 'app.asar');
const runtimeEvidencePath = path.join(reportRoot, 'packaged-ipc-runtime.json');
const finalEvidencePath = path.join(reportRoot, 'packaged-ipc-smoke.json');
const logPath = path.join(reportRoot, 'packaged-ipc-smoke.log');
const manifestEvidencePath = path.join(reportRoot, 'ipc-manifest.json');
const healthEvidencePath = path.join(reportRoot, 'ipc-health.json');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function requireFile(filePath, label) {
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`PACKAGED_ARTIFACT_MISSING ${label} ${filePath}`);
  }
}

function extractEntry(entryPath, outputPath) {
  const normalized = entryPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const archiveKey = normalized.split('/').join(path.sep);
  const buffer = asar.extractFile(asarPath, archiveKey);
  if (!buffer || buffer.length === 0) throw new Error(`ASAR_ENTRY_EMPTY ${normalized}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return { normalized, outputPath, bytes: buffer.length, sha256: hashFile(outputPath) };
}

function git(args) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function main() {
  const startedAt = new Date().toISOString();
  fs.mkdirSync(inspectionRoot, { recursive: true });
  requireFile(executablePath, 'executable');
  requireFile(asarPath, 'app.asar');

  const packageEntry = extractEntry('package.json', path.join(inspectionRoot, 'package.json'));
  const packagedManifest = JSON.parse(fs.readFileSync(packageEntry.outputPath, 'utf8'));
  if (typeof packagedManifest.main !== 'string' || packagedManifest.main.length === 0) throw new Error('ASAR_MAIN_NOT_CONFIGURED');
  const mainEntry = extractEntry(packagedManifest.main, path.join(inspectionRoot, 'main-entry.js'));
  const preloadEntryPath = '.vite/build/preload-entry.js';
  const preloadEntry = extractEntry(preloadEntryPath, path.join(inspectionRoot, 'preload-entry.js'));
  const mainText = fs.readFileSync(mainEntry.outputPath, 'utf8');
  const preloadText = fs.readFileSync(preloadEntry.outputPath, 'utf8');
  const head = git(['rev-parse', 'HEAD']).toLowerCase();
  const branch = git(['branch', '--show-current']);
  if (!mainText.includes('preload-entry.js') || !mainText.includes('KNOUX_IPC_HEALTH') || !mainText.toLowerCase().includes(head)) {
    throw new Error('ASAR_MAIN_ENTRY_STALE_OR_UNRELATED');
  }
  for (const marker of ['knouxRuntime', 'knouxAPI', 'knouxCreativeAPI', 'knouxRecordingAPI', 'knouxMultitrackAPI', 'knouxSlideshowAPI', 'knouxAudioToolsAPI']) {
    if (!preloadText.includes(marker)) throw new Error(`ASAR_PRELOAD_COMPOSITION_MISSING ${marker}`);
  }

  const launch = childProcess.spawnSync(executablePath, [
    '--ipc-smoke-test',
    `--ipc-smoke-evidence=${runtimeEvidencePath}`,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const combinedLog = [launch.stdout || '', launch.stderr || '', launch.error ? String(launch.error.stack || launch.error) : ''].filter(Boolean).join('\n');
  fs.writeFileSync(logPath, combinedLog, 'utf8');
  if (launch.error || launch.status !== 0) throw new Error(`PACKAGED_SMOKE_PROCESS_FAILED status=${launch.status} signal=${launch.signal || 'none'}`);
  requireFile(runtimeEvidencePath, 'runtime evidence');
  const fatalPatterns = [
    /No handler registered/i,
    /Attempted to register a second handler/i,
    /Error invoking remote method/i,
    /handler already registered/i,
    /ERR_IPC_CHANNEL_CLOSED/i,
    /uncaught exception/i,
    /unhandled rejection/i,
  ];
  const fatal = fatalPatterns.find((pattern) => pattern.test(combinedLog));
  if (fatal) throw new Error(`PACKAGED_SMOKE_FATAL_LOG ${fatal}`);

  const runtime = JSON.parse(fs.readFileSync(runtimeEvidencePath, 'utf8'));
  if (!runtime.success || !runtime.packaged || runtime.startupHealth?.status !== 'ready') throw new Error('PACKAGED_SMOKE_RUNTIME_NOT_READY');
  if (runtime.renderer?.buildInfo?.sha?.toLowerCase() !== head || runtime.renderer?.buildInfo?.branch !== branch) throw new Error('PACKAGED_SMOKE_HEAD_MISMATCH');
  const artifacts = {
    executable: { path: executablePath, bytes: fs.statSync(executablePath).size, sha256: hashFile(executablePath) },
    asar: { path: asarPath, bytes: fs.statSync(asarPath).size, sha256: hashFile(asarPath) },
    packageManifest: packageEntry,
    mainBundle: mainEntry,
    preloadBundle: preloadEntry,
  };
  const finalEvidence = {
    schemaVersion: 1,
    product: 'KNOUX Player X',
    mode: 'packaged-asar-context-bridge-ipc-smoke',
    success: true,
    packaged: true,
    testedHead: head,
    testedBranch: branch,
    configuredMain: packagedManifest.main,
    expectedPreloadEntry: preloadEntryPath,
    asarEntriesInspected: [packageEntry.normalized, mainEntry.normalized, preloadEntry.normalized],
    artifacts,
    runtime,
    fatalPatterns: fatalPatterns.map((pattern) => pattern.source),
    fatalMatches: [],
    logPath,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  writeJson(finalEvidencePath, finalEvidence);
  writeJson(manifestEvidencePath, {
    schemaVersion: 1,
    testedHead: head,
    channels: runtime.ipcManifest,
  });
  writeJson(healthEvidencePath, runtime.startupHealth);
  process.stdout.write(`${JSON.stringify({ success: true, finalEvidencePath, logPath, artifacts }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
