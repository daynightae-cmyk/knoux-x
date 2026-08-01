const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const reportRoot = path.join(root, 'reports', 'native-completion', 'sprint-02');
const packageRoot = path.join(root, 'out', 'KNOUX Player X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const asarPath = path.join(packageRoot, 'resources', 'app.asar');

function waitForFile(filePath, timeoutMs = 15000) {
  const started = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - started > timeoutMs) throw new Error(`SPRINT02_WAIT_TIMEOUT ${filePath}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function git(args) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function launch(phase, syntheticRoot, environment) {
  const evidencePath = path.join(reportRoot, `packaged-interaction-${phase}.json`);
  const logPath = path.join(reportRoot, `packaged-interaction-${phase}.log`);
  const args = [
    '--sprint-02-smoke',
    `--sprint-02-root=${syntheticRoot}`,
    `--sprint-02-evidence=${evidencePath}`,
    ...(phase === 'restart' ? ['--sprint-02-restart'] : []),
  ];
  const launched = childProcess.spawnSync(executablePath, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...environment },
  });
  const log = [launched.stdout || '', launched.stderr || '', launched.error ? String(launched.error.stack || launched.error) : ''].filter(Boolean).join('\n');
  fs.writeFileSync(logPath, log, 'utf8');
  if (launched.error || launched.status !== 0) throw new Error(`SPRINT02_PACKAGED_PROCESS_FAILED ${phase} status=${launched.status} ${log.slice(-4000)}`);
  for (const pattern of [/No handler registered/i, /handler already registered/i, /uncaught exception/i, /unhandled rejection/i, /ERR_IPC_CHANNEL_CLOSED/i]) {
    if (pattern.test(log)) throw new Error(`SPRINT02_FATAL_LOG ${phase} ${pattern}`);
  }
  if (!fs.existsSync(evidencePath)) throw new Error(`SPRINT02_EVIDENCE_MISSING ${phase}`);
  return { evidencePath, logPath, evidence: JSON.parse(fs.readFileSync(evidencePath, 'utf8')) };
}

function main() {
  if (process.platform !== 'win32') throw new Error('Sprint 02 packaged verification is Windows-only.');
  for (const artifact of [executablePath, asarPath]) if (!fs.existsSync(artifact) || fs.statSync(artifact).size <= 0) throw new Error(`SPRINT02_PACKAGE_ARTIFACT_MISSING ${artifact}`);
  fs.mkdirSync(reportRoot, { recursive: true });
  const syntheticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-sprint-02-'));
  const stubConfigPath = path.join(syntheticRoot, 'https-stub-config.json');
  const stubLogPath = path.join(reportRoot, 'https-stub.log');
  const stubLog = fs.openSync(stubLogPath, 'w');
  const stub = childProcess.spawn(process.execPath, [path.join(root, 'tools', 'sprint-02-https-stub.cjs'), syntheticRoot, stubConfigPath], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', stubLog, stubLog],
  });
  try {
    waitForFile(stubConfigPath);
    const stubConfig = JSON.parse(fs.readFileSync(stubConfigPath, 'utf8'));
    const environment = { KNOUX_SPRINT02_STUB_ENDPOINT: stubConfig.endpoint, KNOUX_SPRINT02_STUB_CA: stubConfig.caPath };
    const initial = launch('initial', syntheticRoot, environment);
    const restart = launch('restart', syntheticRoot, environment);
    const requiredSurfaces = ['Player','Library','Queue','Captures','Recorder','Editor','Image Editor','Slideshow','Audio Tools','Export','Settings','Developer Center','About','Diagnostics'];
    const surfaces = initial.evidence.renderer?.surfaces || {};
    const missingSurfaces = requiredSurfaces.filter((surface) => !surfaces[surface]);
    if (missingSurfaces.length) throw new Error(`SPRINT02_SURFACE_CENSUS_MISSING ${missingSurfaces.join(',')}`);
    const emptySurfaces = requiredSurfaces.filter((surface) => !Array.isArray(surfaces[surface]?.records) || surfaces[surface].records.length === 0);
    if (emptySurfaces.length) throw new Error(`SPRINT02_SURFACE_ACTIONS_MISSING ${emptySurfaces.join(',')}`);
    if (initial.evidence.startupHealth?.status !== 'ready' || initial.evidence.startupHealth?.missing?.length || initial.evidence.startupHealth?.duplicates?.length) throw new Error('SPRINT02_IPC_REGRESSION');
    const recording = initial.evidence.recording;
    if (!recording || recording.bytes < 32768 || recording.frames < 45 || recording.duration < 3.5 || recording.probe?.streams?.find((stream) => stream.codec_type === 'video')?.codec_name !== 'vp8') throw new Error('SPRINT02_RECORDING_PROOF_INVALID');
    const persisted = restart.evidence.renderer?.persistenceProbe?.read;
    if (!persisted || persisted.location !== 'floating' || persisted.mode !== 'compact' || persisted.position?.x !== 444) throw new Error('SPRINT02_RESTART_PERSISTENCE_FAILED');
    waitForFile(stubConfig.requestEvidencePath);
    const stubEvidence = JSON.parse(fs.readFileSync(stubConfig.requestEvidencePath, 'utf8'));
    if (!stubEvidence.requests?.length || !stubEvidence.requests.every((request) => request.method === 'POST' && request.hasEncodedImagePart && request.hasKnouxMarker)) throw new Error('SPRINT02_HTTPS_ADAPTER_PROOF_FAILED');
    const outputPath = recording.outputPath;
    const artifacts = {
      executable: { path: executablePath, bytes: fs.statSync(executablePath).size, sha256: hashFile(executablePath) },
      asar: { path: asarPath, bytes: fs.statSync(asarPath).size, sha256: hashFile(asarPath) },
      recording: { path: outputPath, bytes: fs.statSync(outputPath).size, sha256: hashFile(outputPath) },
    };
    const actionInventory = Object.values(surfaces).flatMap((surface) => surface.records || []);
    const inventoryById = [...new Map(actionInventory.map((record) => [record.id, record])).values()];
    const activations = initial.evidence.renderer.activations || [];
    const activationById = new Map(activations.map((activation) => [activation.id, activation]));
    const unprovenImplemented = inventoryById.filter((record) => record.status === 'implemented' && (!record.automated || !record.pass || activationById.get(record.id)?.traces !== 1));
    const dispatchedUnavailable = inventoryById.filter((record) => record.status !== 'implemented' && (!record.disabledReason || activationById.get(record.id)?.traces !== 0));
    if (unprovenImplemented.length) throw new Error(`SPRINT02_IMPLEMENTED_ACTION_UNPROVEN ${unprovenImplemented.map((record) => record.id).join(',')}`);
    if (dispatchedUnavailable.length) throw new Error(`SPRINT02_UNAVAILABLE_ACTION_DISPATCHED ${dispatchedUnavailable.map((record) => record.id).join(',')}`);
    const statusSummary = inventoryById.reduce((summary, record) => { summary[record.status] = (summary[record.status] || 0) + 1; return summary; }, {});
    const head = git(['rev-parse', 'HEAD']).toLowerCase();
    const branch = git(['branch', '--show-current']);
    const final = {
      schemaVersion: 1,
      success: true,
      product: 'KNOUX Player X',
      mode: 'sprint-02-packaged-interaction-and-persistence',
      testedHead: head,
      testedBranch: branch,
      requiredSurfaces,
      missingSurfaces,
      emptySurfaces,
      actionInventory: inventoryById,
      statusSummary,
      commandTrace: initial.evidence.renderer.snapshot?.traces || [],
      activations,
      persistence: { initial: initial.evidence.renderer.persistenceProbe, restart: restart.evidence.renderer.persistenceProbe },
      capture: { retentionLimits: { count: 8, itemBytes: 26214400, aggregateBytes: 104857600, unpinnedTtlMs: 900000, pinnedTtlMs: 3600000, pinnedLimit: 3 }, consent: initial.evidence.googleAdapter, networkStub: stubEvidence },
      recorder: recording,
      screenshots: [initial.evidence.screenshots, restart.evidence.screenshots],
      artifacts,
      processEvidence: { initial: initial.evidencePath, restart: restart.evidencePath, initialLog: initial.logPath, restartLog: restart.logPath, stubLogPath, stubRequestEvidence: stubConfig.requestEvidencePath },
      limitations: [
        { class: 'external-hardware', capability: 'physical camera/microphone/system audio', status: 'probe-required', allowed: true },
        { class: 'external-os', capability: 'Windows Share / hide from capture', status: 'unavailable', allowed: true },
        { class: 'external-network', capability: 'live Google endpoint', status: 'not-contacted; production adapter proven with trusted HTTPS stub', allowed: true },
      ],
      completedAt: new Date().toISOString(),
    };
    writeJson(path.join(reportRoot, 'action-inventory.json'), inventoryById);
    writeJson(path.join(reportRoot, 'command-trace.json'), final.commandTrace);
    writeJson(path.join(reportRoot, 'recording-proof.json'), recording);
    writeJson(path.join(reportRoot, 'network-stub.json'), stubEvidence);
    writeJson(path.join(reportRoot, 'verification-report.json'), final);
    fs.writeFileSync(path.join(reportRoot, 'index.md'), `# Sprint 02 packaged evidence\n\n- Result: PASS\n- HEAD: ${head}\n- Branch: ${branch}\n- Actions: ${inventoryById.length}\n- Recording: ${recording.bytes} bytes, ${recording.frames} frames, ${recording.duration}s\n- HTTPS adapter requests: ${stubEvidence.requests.length}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ success: true, reportRoot, testedHead: head, artifacts, statusSummary }, null, 2)}\n`);
  } finally {
    stub.kill();
    fs.closeSync(stubLog);
  }
}

try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }
