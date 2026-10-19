const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const evidenceDir = path.join(root, '_temp', 'live-evidence');
const traceDir = path.join(root, '_temp', 'performance-traces');
const processName = 'knoux-player-x';

const runCount = Number(process.env.KNOUX_PERF_RUNS || 5);
const cdpPort = Number(process.env.KNOUX_PERF_PORT || 9333);

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function git(args) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(deadline, exitInfo) {
  while (Date.now() < deadline) {
    if (exitInfo && exitInfo.code !== null) {
      const error = new Error(`PACKAGED_EARLY_EXIT code=${exitInfo.code} signal=${exitInfo.signal ?? 'none'}`);
      error.earlyExit = true;
      throw error;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) return true;
    } catch {
      // DevTools endpoint is not up yet.
    }
    await sleep(100);
  }
  throw new Error('PACKAGED_CDP_ENDPOINT_TIMEOUT');
}

function listAppProcesses() {
  const script = [
    `$p = Get-Process -Name '${processName}' -ErrorAction SilentlyContinue`,
    'if ($p) { @{ count = @($p).Count; workingSetBytes = (@($p) | Measure-Object WorkingSet64 -Sum).Sum; privateBytes = (@($p) | Measure-Object PrivateMemorySize64 -Sum).Sum; cpuSeconds = (@($p) | Measure-Object CPU -Sum).Sum } | ConvertTo-Json -Compress } else { Write-Output "null" }',
  ].join('; ');
  const output = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
  return JSON.parse(output);
}

function killAppTree() {
  childProcess.spawnSync('taskkill', ['/IM', `${processName}.exe`, '/T', '/F'], { encoding: 'utf8', windowsHide: true });
}

async function waitForProcessExit(deadline) {
  while (Date.now() < deadline) {
    const processes = listAppProcesses();
    if (!processes || processes.count === 0) return;
    await sleep(250);
  }
}

function parseTrace(traceFile) {
  if (!fs.existsSync(traceFile)) return null;
  const lines = fs.readFileSync(traceFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    const match = line.match(/^(\S+) \[knoux-startup\] pid=(\d+) event=([^ ]+)(?: (.*))?$/);
    if (match) events.push({ at: match[1], pid: Number(match[2]), event: match[3], detail: match[4] || '' });
  }
  const byEvent = {};
  for (const event of events) if (!byEvent[event.event]) byEvent[event.event] = event;
  const start = byEvent['module-enter'] ? Date.parse(byEvent['module-enter'].at) : null;
  const deltas = {};
  if (start !== null) {
    for (const [name, event] of Object.entries(byEvent)) deltas[name] = Date.parse(event.at) - start;
  }
  return { eventCount: events.length, deltasMs: deltas };
}

async function readRendererMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] || null;
    const paints = performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    const memory = typeof performance.memory === 'object' && performance.memory
      ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      }
      : null;
    return {
      navigation: navigation
        ? {
          responseEnd: navigation.responseEnd,
          domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
          loadEventEnd: navigation.loadEventEnd,
        }
        : null,
      paints,
      heap: memory,
      readyState: document.readyState,
    };
  });
}

async function runOnce(index) {
  const traceFile = path.join(traceDir, `run-${index + 1}.log`);
  fs.rmSync(traceFile, { force: true });
  const preClean = listAppProcesses();
  killAppTree();
  await waitForProcessExit(Date.now() + 20000);
  const preCleanSurvivors = listAppProcesses();
  const launches = [];

  async function launchAndAttach(attempt) {
    const startedAt = Date.now();
    const exitInfo = { code: null, signal: null };
    const child = childProcess.spawn(executablePath, [`--remote-debugging-port=${cdpPort}`], {
      cwd: packageRoot,
      env: { ...process.env, KNOUX_STARTUP_TRACE_FILE: traceFile },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('exit', (code, signal) => {
      exitInfo.code = code;
      exitInfo.signal = signal;
    });
    try {
      try {
        await waitForCdp(startedAt + 60000, exitInfo);
      } catch (error) {
        launches.push({ attempt, startedAtMs: startedAt, cdpMs: null, earlyExit: error.earlyExit === true, error: error.message });
        error.launchPhase = true;
        throw error;
      }
      const cdpUpMs = Date.now() - startedAt;
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 10000 });
      const pageDeadline = Date.now() + 30000;
      let page = null;
      while (!page && Date.now() < pageDeadline) {
        const contexts = browser.contexts();
        page = contexts.length > 0 ? contexts[0].pages()[0] || null : null;
        if (!page) await sleep(50);
      }
      if (!page) {
        await browser.close().catch(() => {});
        throw new Error('PACKAGED_RENDERER_PAGE_MISSING');
      }
      launches.push({ attempt, startedAtMs: startedAt, cdpMs: cdpUpMs, earlyExit: false, error: null });
      return { child, browser, page, startedAt, cdpUpMs };
    } catch (error) {
      if (!error.launchPhase) {
        launches.push({ attempt, startedAtMs: startedAt, cdpMs: null, earlyExit: false, error: error.message });
        error.launchPhase = true;
      }
      if (!child.killed) child.unref();
      throw error;
    }
  }

  let launch = null;
  let relaunchReason = null;
  let browser = null;
  try {
    try {
      launch = await launchAndAttach(1);
    } catch (error) {
      if (error.launchPhase !== true) throw error;
      relaunchReason = error.message;
      killAppTree();
      await waitForProcessExit(Date.now() + 20000);
      launch = await launchAndAttach(2);
    }
    browser = launch.browser;
    const { page, startedAt, cdpUpMs } = launch;
    const pageUpMs = Date.now() - startedAt;
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    const domMs = Date.now() - startedAt;
    if (await page.locator('.first-run-backdrop').isVisible().catch(() => false)) {
      await page.locator('.tour-skip').click().catch(() => {});
      await page.locator('.first-run-backdrop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }
    await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#initial-loading').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    const uiMs = Date.now() - startedAt;
    const renderer = await readRendererMetrics(page);
    await sleep(3000);
    const memoryAfter3s = listAppProcesses();
    await sleep(5000);
    const memorySettled = listAppProcesses();
    return {
      index,
      cold: index === 0,
      ok: true,
      wallMs: { cdp: cdpUpMs, page: pageUpMs, domContentLoaded: domMs, uiReady: uiMs },
      renderer,
      memoryAfter3s,
      memorySettled,
      trace: parseTrace(traceFile),
      traceFile,
      preClean,
      preCleanSurvivors,
      launches,
      relaunchReason,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    killAppTree();
    await waitForProcessExit(Date.now() + 15000);
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, rank))];
}

function writeEvidence(evidencePath, evidence) {
  const payload = `${JSON.stringify(evidence, null, 2)}\n`;
  const tmpPath = `${evidencePath}.tmp`;
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, evidencePath);
  if (fs.readFileSync(evidencePath, 'utf8') !== payload) throw new Error('EVIDENCE_WRITE_CORRUPTED');
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(traceDir, { recursive: true });
  if (!fs.existsSync(executablePath)) throw new Error(`PACKAGED_EXECUTABLE_MISSING ${executablePath}`);
  killAppTree();
  await waitForProcessExit(Date.now() + 10000);
  const artifact = {
    executable: { path: executablePath, bytes: fs.statSync(executablePath).size, sha256: hashFile(executablePath) },
    head: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    trackedTreeClean: git(['status', '--porcelain', '--untracked-files=no']) === '',
  };
  const machine = {
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
  };
  const runs = [];
  for (let index = 0; index < runCount; index += 1) {
    process.stdout.write(`run ${index + 1}/${runCount} ...\n`);
    try {
      const result = await runOnce(index);
      runs.push(result);
      process.stdout.write(`  uiReady=${result.wallMs.uiReady}ms heap=${result.renderer.heap ? Math.round(result.renderer.heap.usedJSHeapSize / 1048576) : 'n/a'}MB ws=${result.memorySettled ? Math.round(result.memorySettled.workingSetBytes / 1048576) : 'n/a'}MB\n`);
    } catch (error) {
      runs.push({ index, cold: index === 0, ok: false, error: error instanceof Error ? error.message : String(error) });
      process.stdout.write(`  FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await sleep(1000);
  }
  const uiReady = runs.filter((run) => run.ok).map((run) => run.wallMs.uiReady).sort((a, b) => a - b);
  const uiReadyCold = runs.filter((run) => run.ok && run.cold).map((run) => run.wallMs.uiReady);
  const uiReadyWarm = runs.filter((run) => run.ok && !run.cold).map((run) => run.wallMs.uiReady).sort((a, b) => a - b);
  const heap = runs.filter((run) => run.ok && run.renderer.heap).map((run) => run.renderer.heap.usedJSHeapSize).sort((a, b) => a - b);
  const workingSet = runs.filter((run) => run.ok && run.memorySettled).map((run) => run.memorySettled.workingSetBytes).sort((a, b) => a - b);
  const privateBytes = runs.filter((run) => run.ok && run.memorySettled).map((run) => run.memorySettled.privateBytes).sort((a, b) => a - b);
  const cpuSeconds = runs.filter((run) => run.ok && run.memorySettled).map((run) => run.memorySettled.cpuSeconds).sort((a, b) => a - b);
  const setupDeltas = runs.filter((run) => run.ok && run.trace && run.trace.deltasMs).map((run) => run.trace.deltasMs);
  const traceSummary = {
    primaryBootstrapMs: setupDeltas.map((deltas) => deltas['primary-bootstrap'] ?? null).filter((value) => value !== null).sort((a, b) => a - b),
    moduleEnterToElectronApiMs: setupDeltas.map((deltas) => deltas['electron-api-loaded'] ?? null).filter((value) => value !== null).sort((a, b) => a - b),
  };
  const evidence = {
    schemaVersion: 1,
    product: 'Knoux X',
    kind: 'windows-packaged-performance-probe',
    timestamp: new Date().toISOString(),
    artifact,
    machine,
    runs,
    aggregates: {
      uiReadyMs: { samples: uiReady, p50: percentile(uiReady, 50), p95: percentile(uiReady, 95), min: uiReady[0] ?? null, max: uiReady[uiReady.length - 1] ?? null },
      uiReadyColdMs: { samples: uiReadyCold },
      uiReadyWarmMs: { samples: uiReadyWarm, p50: percentile(uiReadyWarm, 50), p95: percentile(uiReadyWarm, 95) },
      usedJsHeapBytes: { samples: heap, p50: percentile(heap, 50), p95: percentile(heap, 95) },
      workingSetBytes: { samples: workingSet, p50: percentile(workingSet, 50), p95: percentile(workingSet, 95) },
      privateBytes: { samples: privateBytes, p50: percentile(privateBytes, 50) },
      cpuSecondsBurnIn: { samples: cpuSeconds, p50: percentile(cpuSeconds, 50) },
      trace: traceSummary,
    },
    notes: [
      'Wall times measured from process spawn to observable milestone on this machine.',
      `cold = first launch after the process tree was fully terminated; warm = subsequent relaunches without rebuild. runs=${runCount}.`,
      'Launch-phase failures (early single-instance exit, CDP attach) are retried once after a full process-tree termination; every attempt is recorded in run.launches.',
    ],
  };
  const evidencePath = path.join(evidenceDir, `windows-performance-${artifact.head.slice(0, 7)}-${Date.now()}.json`);
  writeEvidence(evidencePath, evidence);
  process.stdout.write(`\nEvidence: ${evidencePath}\n`);
  process.stdout.write(`uiReady p50=${evidence.aggregates.uiReadyMs.p50}ms p95=${evidence.aggregates.uiReadyMs.p95}ms; heap p50=${evidence.aggregates.usedJsHeapBytes.p50}B; ws p50=${evidence.aggregates.workingSetBytes.p50}B\n`);
  const failed = runs.filter((run) => !run.ok);
  if (failed.length > 0) {
    process.stderr.write(`FAILED_RUNS=${failed.length}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
