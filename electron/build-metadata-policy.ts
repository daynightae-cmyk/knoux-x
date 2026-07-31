export interface RawBuildMetadata {
  sha?: string;
  branch?: string;
  timestamp?: string;
}

function requiredBuildValue(value: string | undefined, label: string, pattern: RegExp): string {
  if (!value || !pattern.test(value)) throw new Error(`BUILD_IDENTITY_INVALID ${label}`);
  return value;
}

export function validateBuildMetadata(input: RawBuildMetadata): Required<RawBuildMetadata> {
  const sha = requiredBuildValue(input.sha, 'sha', /^[0-9a-f]{40}$/i).toLowerCase();
  const branch = requiredBuildValue(input.branch, 'branch', /^(?!(?:unknown|dev|development|placeholder)$).+$/i);
  const timestamp = requiredBuildValue(input.timestamp, 'timestamp', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error('BUILD_IDENTITY_INVALID timestamp');
  return { sha, branch, timestamp };
}
