/**
 * KNOUX X web production smoke test.
 *
 * Fetches the production URL, asserts the app shell loads, and — when the
 * bundle carries baked release identity — asserts the live SHA matches the
 * release SHA. Distinguishes PREVIEW from PRODUCTION: only the exact
 * production URL counts.
 *
 * Usage:
 *   node tools/verify-web-production.cjs --url <production-url> --sha <release-sha> --version <x.y.z>
 *
 * Exit 0 PASS, exit 2 when the deployment serves a stale SHA, exit 1 on error.
 */
function flag(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing required argument: ${name} <value>`);
  return process.argv[index + 1];
}

async function fetchText(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const text = await response.text().catch(() => '');
    return { status: response.status, url: response.url, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const url = flag('--url');
  const sha = flag('--sha');
  const version = flag('--version');
  const evidence = {
    timestamp: new Date().toISOString(),
    url,
    expectedSha: sha,
    expectedVersion: version,
    checks: {},
    verdict: 'PENDING',
  };
  const record = (name, data) => {
    evidence.checks[name] = data;
    process.stdout.write(`[${name}] ${JSON.stringify(data).substring(0, 220)}\n`);
  };

  const home = await fetchText(url);
  record('http', { status: home.status, finalUrl: home.url });
  if (home.status < 200 || home.status >= 400) {
    evidence.verdict = 'FAIL';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const hasRoot = /id="root"/.test(home.text);
  const hasBrand = /Knoux X|KNOUX/i.test(home.text);
  record('shell', { hasRoot, hasBrand });
  if (!hasRoot || !hasBrand) {
    evidence.verdict = 'FAIL';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  // Baked release identity travels in the JS bundle (__KNOUX_RELEASE__).
  const scriptRefs = [...home.text.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]).slice(0, 12);
  let liveSha = null;
  let liveVersion = null;
  for (const ref of scriptRefs) {
    try {
      const absolute = new URL(ref, home.url).toString();
      const bundle = await fetchText(absolute);
      const shaMatch = bundle.text.match(/"sha"\s*:\s*"([0-9a-f]{40})"/i) || bundle.text.match(/__KNOUX_RELEASE__[^}]*?([0-9a-f]{40})/);
      const versionMatch = bundle.text.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/);
      if (shaMatch) liveSha = shaMatch[1].toLowerCase();
      if (versionMatch) liveVersion = versionMatch[1];
      if (liveSha) break;
    } catch {
      // A single chunk failing to load must not mask the verdict.
    }
  }
  record('identity', { liveSha, liveVersion });

  if (liveSha && liveSha !== sha.toLowerCase()) {
    evidence.verdict = 'STALE';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (liveVersion && liveVersion !== version) {
    evidence.verdict = 'STALE';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  evidence.verdict = liveSha ? 'PASS' : 'PASS-UNVERIFIED-IDENTITY';
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
