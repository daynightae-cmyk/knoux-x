import fs from 'node:fs';
import path from 'node:path';

export interface IpcConstantNamespaces {
  invoke: Readonly<Record<string, string>>;
  inbound: Readonly<Record<string, string>>;
  outbound: Readonly<Record<string, string>>;
}

const DECLARATION_FILES = new Set([
  'electron/ipc/channel-source-inventory.ts',
  'electron/ipc/channel-types.ts',
  'electron/ipc/contract.ts',
]);

function productionTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

export function collectProductionIpcSourceRoots(
  repositoryRoot: string,
  namespaces: IpcConstantNamespaces,
): Readonly<Record<string, readonly string[]>> {
  const roots = new Map<string, Set<string>>();
  const namespaceLookup = {
    INVOKE: namespaces.invoke,
    INBOUND: namespaces.inbound,
    OUTBOUND: namespaces.outbound,
  } as const;

  for (const sourcePath of productionTypeScriptFiles(path.join(repositoryRoot, 'electron'))) {
    const relativePath = path.relative(repositoryRoot, sourcePath).replace(/\\/g, '/');
    if (DECLARATION_FILES.has(relativePath)) continue;
    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(/IPC_(INVOKE|INBOUND|OUTBOUND)\.([A-Z0-9_]+)/g)) {
      const direction = match[1] as keyof typeof namespaceLookup;
      const property = match[2];
      const channel = namespaceLookup[direction][property];
      if (!channel) throw new Error(`IPC_SOURCE_PARITY_UNKNOWN_CONSTANT ${direction}.${property} in ${relativePath}`);
      const channelRoots = roots.get(channel) ?? new Set<string>();
      channelRoots.add(relativePath);
      roots.set(channel, channelRoots);
    }
  }

  return Object.fromEntries(
    [...roots.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([channel, channelRoots]) => [channel, [...channelRoots].sort()]),
  );
}
