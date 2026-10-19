#!/usr/bin/env node
/**
 * Evidence integrity gate.
 *
 * Rejects zero-filled or otherwise corrupted evidence before it can be committed or pushed.
 * The failure mode this repo actually hit (2026-10-20) was working-tree files coming back
 * all-NUL with their correct byte length before `git add` ran, so the gate verifies:
 *
 *   1. every evidence file in the working tree (NUL / JSON / PNG / JPEG / MP4 / WebM checks)
 *   2. the staged blobs of evidence files about to be committed (read back from git, not disk)
 *   3. optionally, the blobs of files changed by a commit (default: HEAD)
 *
 * Usage:
 *   node tools/verify-evidence-integrity.cjs [--no-worktree] [--no-staged] [--commit <sha>]
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = usage error.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = { worktree: true, staged: true, commit: null };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--no-worktree') opt.worktree = false;
  else if (args[i] === '--no-staged') opt.staged = false;
  else if (args[i] === '--commit') { opt.commit = args[i + 1] || 'HEAD'; i += 1; }
  else { console.error(`unknown argument: ${args[i]}`); process.exit(2); }
}

const TEXT_EXT = new Set(['.md', '.json', '.csv', '.txt', '.log', '.yml', '.yaml', '.knouxedit', '.xml', '.html', '.css', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.sh', '.ps1', '.gitignore']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIG = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'release', '.vite', 'reports', 'artifacts']);
const EVIDENCE_DIRS = ['design-evidence', 'release-closure-artifacts'];

const findings = [];
function fail(where, rel, problem) { findings.push({ where, rel, problem }); }

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, ...opts });
}

function checkBuffer(where, rel, buf) {
  if (buf.length === 0) { fail(where, rel, 'zero-length'); return; }
  const ext = path.extname(rel).toLowerCase();
  if (TEXT_EXT.has(ext)) {
    if (buf.includes(0)) { fail(where, rel, 'NUL bytes in text evidence'); return; }
    if (ext === '.json' || ext === '.knouxedit') {
      try { JSON.parse(buf.toString('utf8')); } catch (e) { fail(where, rel, `malformed JSON: ${e.message}`); }
    }
    return;
  }
  if (ext === '.png') {
    if (!buf.subarray(0, 8).equals(PNG_SIG)) fail(where, rel, 'PNG bad signature');
    else if (!buf.subarray(Math.max(0, buf.length - 16)).includes(Buffer.from('IEND'))) fail(where, rel, 'PNG missing IEND');
    return;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) fail(where, rel, 'JPEG bad SOI');
    else if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) fail(where, rel, 'JPEG missing EOI');
    return;
  }
  if (ext === '.webm' || ext === '.mkv') {
    if (!buf.subarray(0, 4).equals(EBML_SIG)) fail(where, rel, 'WebM bad EBML magic');
    return;
  }
  if (ext === '.mp4') {
    if (buf.subarray(4, 8).toString('latin1') !== 'ftyp') fail(where, rel, 'MP4 missing ftyp');
  }
}

function walkEvidence(dir, relBase) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkEvidence(abs, rel);
      continue;
    }
    if (!e.isFile()) continue;
    let buf;
    try { buf = fs.readFileSync(abs); } catch (err) { fail('worktree', rel, `unreadable: ${err.message}`); continue; }
    checkBuffer('worktree', rel, buf);
  }
}

function blobOf(rev) {
  try {
    return execFileSync('git', ['cat-file', 'blob', rev], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

(async () => {
  const counts = { worktree: 0, blobs: 0 };

  if (opt.worktree) {
    for (const d of EVIDENCE_DIRS) {
      const abs = path.join(root, d);
      if (!fs.existsSync(abs)) continue;
      walkEvidence(abs, d);
    }
  }

  const toVerify = new Map();
  if (opt.staged) {
    const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
    for (const f of out.split('\0').filter(Boolean)) {
      if (f.startsWith('design-evidence/') || f.startsWith('release-closure-artifacts/')) toVerify.set(f, 'staged');
    }
  }
  if (opt.commit) {
    const out = git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-r', '-z', opt.commit]);
    for (const f of out.split('\0').filter(Boolean)) {
      if (f.startsWith('design-evidence/') || f.startsWith('release-closure-artifacts/')) toVerify.set(f, opt.commit);
    }
  }

  for (const [file, ref] of toVerify) {
    counts.blobs += 1;
    const rev = ref === 'staged' ? `:${file}` : `${ref}:${file}`;
    const buf = blobOf(rev);
    if (!buf) { fail(ref, file, 'blob unreadable'); continue; }
    checkBuffer(ref, file, buf);
  }

  console.log('evidence-integrity gate');
  console.log(`  worktree evidence dirs : ${opt.worktree ? EVIDENCE_DIRS.join(', ') : 'skipped'}`);
  console.log(`  blobs verified         : ${counts.blobs} (${[...new Set([...toVerify.values()])].join(', ') || 'none'})`);
  console.log(`  findings               : ${findings.length}`);
  for (const f of findings) console.log(`   !! [${f.where}] ${f.rel} — ${f.problem}`);
  console.log(`  RESULT: ${findings.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(findings.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
