import type { MultitrackProject } from '../core/creative/multitrackProject';

export const ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY = 'knoux:android-active-multitrack-export';

export interface ActiveAndroidMultitrackEnvelope {
  project: MultitrackProject;
  persistedAt: string;
  persistenceToken: string;
}

function projectToken(project: MultitrackProject): string {
  const material = JSON.stringify(project);
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${project.id}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function writeActiveAndroidMultitrackProject(project: MultitrackProject): ActiveAndroidMultitrackEnvelope {
  const envelope: ActiveAndroidMultitrackEnvelope = {
    project,
    persistedAt: new Date().toISOString(),
    persistenceToken: projectToken(project),
  };
  window.localStorage.setItem(ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY, JSON.stringify(envelope));
  return envelope;
}

export function readActiveAndroidMultitrackEnvelope(): ActiveAndroidMultitrackEnvelope | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveAndroidMultitrackEnvelope | MultitrackProject;
    if ('project' in parsed && parsed.project?.schema === 'knoux-multitrack' && Array.isArray(parsed.project.tracks)) {
      return parsed as ActiveAndroidMultitrackEnvelope;
    }
    // One-way migration for the previous bare-project cache. It remains usable,
    // but receives a persistence token before the next export surface reads it.
    const legacy = parsed as MultitrackProject;
    if (legacy?.schema === 'knoux-multitrack' && Array.isArray(legacy.tracks)) {
      return writeActiveAndroidMultitrackProject(legacy);
    }
    return null;
  } catch {
    return null;
  }
}

export function readActiveAndroidMultitrackProject(): MultitrackProject | null {
  return readActiveAndroidMultitrackEnvelope()?.project ?? null;
}

export function clearActiveAndroidMultitrackProject(): void {
  window.localStorage.removeItem(ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY);
}

function projectFromUnknown(value: unknown): MultitrackProject | null {
  if (!value || typeof value !== 'object') return null;
  const direct = value as Partial<MultitrackProject>;
  if (direct.schema === 'knoux-multitrack' && Array.isArray(direct.tracks)) {
    return value as MultitrackProject;
  }
  if ('project' in value) {
    const wrapped = (value as { project?: unknown }).project;
    if (wrapped && typeof wrapped === 'object') {
      const candidate = wrapped as Partial<MultitrackProject>;
      if (candidate.schema === 'knoux-multitrack' && Array.isArray(candidate.tracks)) {
        return wrapped as MultitrackProject;
      }
    }
  }
  return null;
}

function decorateResult<T>(value: T): T {
  const project = projectFromUnknown(value);
  if (project) writeActiveAndroidMultitrackProject(project);
  return value;
}

export function installAndroidMultitrackExportBridge(): void {
  if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxMultitrackAPI !== 'object') return;
  const base = window.knouxMultitrackAPI;

  window.knouxMultitrackAPI = {
    ...base,
    create: async (...args: Parameters<typeof base.create>) => decorateResult(await base.create(...args)),
    open: async (...args: Parameters<typeof base.open>) => decorateResult(await base.open(...args)),
    openRecent: async (...args: Parameters<typeof base.openRecent>) => decorateResult(await base.openRecent(...args)),
    save: async (project: MultitrackProject, ...args: unknown[]) => {
      const result = await (base.save as (...params: unknown[]) => Promise<unknown>)(project, ...args);
      // Export eligibility is published only AFTER the underlying persistence
      // request resolves successfully. A rejected/failed save cannot publish a
      // newer unpersisted timeline snapshot.
      if (result) writeActiveAndroidMultitrackProject(project);
      return result as Awaited<ReturnType<typeof base.save>>;
    },
    autosave: async (project: MultitrackProject, ...args: unknown[]) => {
      const result = await (base.autosave as (...params: unknown[]) => Promise<unknown>)(project, ...args);
      if (result !== false && result !== null && result !== undefined) writeActiveAndroidMultitrackProject(project);
      return result as Awaited<ReturnType<typeof base.autosave>>;
    },
  } as Window['knouxMultitrackAPI'];
}
