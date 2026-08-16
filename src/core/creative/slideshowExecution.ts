import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { MAX_INLINE_FILTER_LENGTH } from './slideshowRender';

/**
 * Bounding strategy for a single slideshow spawn. The Windows CreateProcess command line of
 * the FINAL argument array must stay below WINDOWS_SAFE_COMMAND_LENGTH, so every transform
 * re-runs the exact length calculation before the executable is invoked.
 */
export type SlideshowRenderStrategy =
  | 'direct-bounded'
  | 'file-backed-filter'
  | 'short-alias'
  | 'chunked-render';

export interface SlideshowExecutionCapability {
  executablePath: string | null;
  version: string | null;
  supportsFilterComplexScript: boolean;
  supportsModernFilterFileSyntax: boolean;
  detectedAt: string;
}

export interface StagedInputRecord {
  original: string;
  alias: string;
  source: 'hardlink' | 'copy';
}

export interface SlideshowExecutionPlan {
  executablePath: string | null;
  args: string[];
  strategy: SlideshowRenderStrategy;
  commandLineLength: number;
  stagedInputs: StagedInputRecord[];
  filterScriptPath?: string;
}

export interface SlideshowRenderPlanLike {
  args: string[];
  filterComplexString: string;
}

export interface BuildSlideshowExecutionInput {
  executablePath: string | null;
  capability: SlideshowExecutionCapability;
  isWindows: boolean;
  workspaceRoot: string;
}

/** Safe ceiling for the Windows CreateProcess command line (32767 is the hard limit). */
export const WINDOWS_SAFE_COMMAND_LENGTH = 30_000;

/** Stage user media to short aliases once more than this many real inputs appear on Windows. */
export const SHORT_ALIAS_INPUT_THRESHOLD = 3;

/** A single user input path at or above this many characters is staged to a short alias. */
export const SHORT_ALIAS_PATH_LENGTH = 40;

function needsQuote(value: string): boolean {
  return /[\s"^&|<>%]/.test(value);
}

/**
 * Estimate the exact Windows command line that `spawn(executable, args, { shell: false })`
 * passes to CreateProcess: the executable, one space per argument, and double quotes when an
 * argument contains whitespace or a metacharacter Windows would otherwise reinterpret.
 */
export function windowsCommandLineLength(
  executablePath: string,
  args: readonly string[]
): number {
  let length = executablePath.length;
  for (const argument of args) {
    length += 1; // separating space
    if (needsQuote(argument)) length += 2; // surrounding double quotes
    length += argument.length;
  }
  return length;
}

export interface SlideshowInputEntry {
  index: number;
  sourcePath: string;
}

/** List every `-i <path>` pair preserving order for deterministic alias assignment. */
export function listInputEntries(args: readonly string[]): SlideshowInputEntry[] {
  const entries: SlideshowInputEntry[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '-i' && index + 1 < args.length) {
      entries.push({ index, sourcePath: args[index + 1] });
    }
  }
  return entries;
}

async function statFileSize(filePath: string): Promise<number> {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new Error(`Slideshow input is missing: ${path.basename(filePath)}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Slideshow input is not a file: ${path.basename(filePath)}`);
  }
  return stats.size;
}

async function writeStagedAlias(
  sourcePath: string,
  aliasPath: string,
  expectedSize: number
): Promise<'hardlink' | 'copy'> {
  let source: 'hardlink' | 'copy' = 'hardlink';
  try {
    await fs.link(sourcePath, aliasPath);
  } catch {
    source = 'copy';
    await fs.copyFile(sourcePath, aliasPath);
  }
  const aliasSize = await statFileSize(aliasPath);
  if (aliasSize !== expectedSize) {
    throw new Error(`Staged alias size mismatch for ${path.basename(sourcePath)}`);
  }
  return source;
}

function isInsideWorkspace(sourcePath: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot).toLowerCase();
  const source = path.resolve(sourcePath).toLowerCase();
  return source.startsWith(`${root}${path.sep}`);
}

async function applyShortAliasStaging(
  args: string[],
  workspaceRoot: string
): Promise<{ args: string[]; stagedInputs: StagedInputRecord[] }> {
  const entries = listInputEntries(args);
  const staged = new Map<number, string>();
  const stagedInputs: StagedInputRecord[] = [];
  let cursor = 0;
  for (const entry of entries) {
    if (isInsideWorkspace(entry.sourcePath, workspaceRoot)) continue;
    const original = path.resolve(entry.sourcePath);
    const extension = path.extname(original).slice(0, 6);
    const aliasPath = path.join(workspaceRoot, `in${String(cursor).padStart(3, '0')}${extension}`);
    const expectedSize = await statFileSize(original);
    const source = await writeStagedAlias(original, aliasPath, expectedSize);
    staged.set(entry.index, aliasPath);
    stagedInputs.push({ original, alias: aliasPath, source });
    cursor += 1;
  }
  if (stagedInputs.length === 0) return { args, stagedInputs };
  const next = [...args];
  for (const [index, aliasPath] of staged) next[index + 1] = aliasPath;
  return { args: next, stagedInputs };
}

/**
 * Move the inline filter graph into a bounded, job-owned script file and point the args at it.
 */
export async function writeFilterScript(
  filterComplexString: string,
  workspaceRoot: string
): Promise<string> {
  const digest = createHash('sha256').update(filterComplexString).digest('hex').slice(0, 12);
  const scriptPath = path.join(
    workspaceRoot,
    `${digest}.filter-complex-script.txt`
  );
  await fs.writeFile(scriptPath, filterComplexString, 'utf8');
  return scriptPath;
}

function replaceFilterComplex(args: string[], scriptPath: string): string[] {
  const filterIndex = args.indexOf('-filter_complex');
  if (filterIndex < 0) return args;
  return [
    ...args.slice(0, filterIndex),
    '-filter_complex_script',
    scriptPath,
    ...args.slice(filterIndex + 2),
  ];
}

/**
 * Decide, apply, and record the bounding strategy for one slideshow render, returning the exact
 * argument array that will be handed to spawn. Throws when a host cannot stay under the safe
 * ceiling (forcing chunked rendering to be added) rather than spilling an over-length command.
 */
export async function buildSlideshowExecution(
  plan: SlideshowRenderPlanLike,
  input: BuildSlideshowExecutionInput
): Promise<SlideshowExecutionPlan> {
  const { executablePath, capability, isWindows, workspaceRoot } = input;
  await fs.mkdir(workspaceRoot, { recursive: true });
  let args = [...plan.args];
  const stagedInputs: StagedInputRecord[] = [];
  let filterScriptPath: string | undefined;

// 1) File-backed filter for oversized inline graphs when the binary supports it; otherwise
  //    keep the inline graph (a supported fallback) and rely on the final length check below.
  if (plan.filterComplexString.length > MAX_INLINE_FILTER_LENGTH) {
    if (capability.supportsFilterComplexScript) {
      filterScriptPath = await writeFilterScript(plan.filterComplexString, workspaceRoot);
      args = replaceFilterComplex(args, filterScriptPath);
    }
  }

  // 2) Bounded short-alias staging on Windows for many inputs or long/Unicode user paths.
  const entries = listInputEntries(args);
  const inputCount = entries.length;
  const longestInput = entries.reduce(
    (longest, entry) => Math.max(longest, entry.sourcePath.length),
    0
  );
  const predictedLength =
    executablePath == null ? 0 : windowsCommandLineLength(executablePath, args);
  const shouldStage =
    isWindows &&
    (inputCount > SHORT_ALIAS_INPUT_THRESHOLD ||
      longestInput >= SHORT_ALIAS_PATH_LENGTH ||
      (executablePath != null && predictedLength > WINDOWS_SAFE_COMMAND_LENGTH));
  if (shouldStage) {
    const stagedResult = await applyShortAliasStaging(args, workspaceRoot);
    args = stagedResult.args;
    stagedInputs.push(...stagedResult.stagedInputs);
  }

  // 3) Final exact length check after every transform.
  const commandLineLength =
    executablePath == null ? 0 : windowsCommandLineLength(executablePath, args);
  if (commandLineLength > WINDOWS_SAFE_COMMAND_LENGTH) {
    throw new Error(
      `Slideshow render command line (${commandLineLength} chars) exceeds the safe ceiling ` +
        `${WINDOWS_SAFE_COMMAND_LENGTH}; this project requires chunked rendering.`
    );
  }

  const strategy: SlideshowRenderStrategy = stagedInputs.length > 0
    ? 'short-alias'
    : filterScriptPath
      ? 'file-backed-filter'
      : 'direct-bounded';

  return {
    executablePath,
    args,
    strategy,
    commandLineLength,
    stagedInputs,
    filterScriptPath,
  };
}