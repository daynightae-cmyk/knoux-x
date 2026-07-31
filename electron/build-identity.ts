import { app } from 'electron';

import type { BuildIdentity } from './ipc/contract';

declare const __KNOUX_BUILD_SHA__: string;
declare const __KNOUX_BUILD_BRANCH__: string;
declare const __KNOUX_BUILD_TIMESTAMP__: string;

function requiredBuildValue(value: string | undefined, label: string, pattern: RegExp): string {
  if (!value || !pattern.test(value)) throw new Error(`BUILD_IDENTITY_INVALID ${label}`);
  return value;
}

export function getBuildIdentity(): BuildIdentity {
  const sha = requiredBuildValue(
    typeof __KNOUX_BUILD_SHA__ === 'string' ? __KNOUX_BUILD_SHA__ : process.env.KNOUX_BUILD_SHA,
    'sha',
    /^[0-9a-f]{40}$/i,
  );
  const branch = requiredBuildValue(
    typeof __KNOUX_BUILD_BRANCH__ === 'string' ? __KNOUX_BUILD_BRANCH__ : process.env.KNOUX_BUILD_BRANCH,
    'branch',
    /^(?!unknown$|dev$).+$/i,
  );
  const builtAt = requiredBuildValue(
    typeof __KNOUX_BUILD_TIMESTAMP__ === 'string' ? __KNOUX_BUILD_TIMESTAMP__ : process.env.KNOUX_BUILD_TIMESTAMP,
    'timestamp',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
  );
  if (Number.isNaN(Date.parse(builtAt))) throw new Error('BUILD_IDENTITY_INVALID timestamp');
  return Object.freeze({
    product: 'KNOUX Player X',
    version: app.getVersion(),
    sha: sha.toLowerCase(),
    branch,
    builtAt,
    packaged: app.isPackaged,
    electronVersion: process.versions.electron,
  });
}
