import { app } from 'electron';

import type { BuildIdentity } from './ipc/contract';
import { validateBuildMetadata } from './build-metadata-policy';

declare const __KNOUX_BUILD_SHA__: string;
declare const __KNOUX_BUILD_BRANCH__: string;
declare const __KNOUX_BUILD_TIMESTAMP__: string;

export function getBuildIdentity(): BuildIdentity {
  const metadata = validateBuildMetadata({
    sha: typeof __KNOUX_BUILD_SHA__ === 'string' ? __KNOUX_BUILD_SHA__ : process.env.KNOUX_BUILD_SHA,
    branch: typeof __KNOUX_BUILD_BRANCH__ === 'string' ? __KNOUX_BUILD_BRANCH__ : process.env.KNOUX_BUILD_BRANCH,
    timestamp: typeof __KNOUX_BUILD_TIMESTAMP__ === 'string' ? __KNOUX_BUILD_TIMESTAMP__ : process.env.KNOUX_BUILD_TIMESTAMP,
  });
  return Object.freeze({
    product: 'KNOUX Player X',
    version: app.getVersion(),
    sha: metadata.sha,
    branch: metadata.branch,
    builtAt: metadata.timestamp,
    packaged: app.isPackaged,
    electronVersion: process.versions.electron,
  });
}
