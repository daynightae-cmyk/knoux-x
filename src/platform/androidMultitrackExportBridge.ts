import type { MultitrackProject } from '../core/creative/multitrackProject';

export const ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY = 'knoux:android-active-multitrack-export';

export function writeActiveAndroidMultitrackProject(project: MultitrackProject): void {
  window.localStorage.setItem(ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY, JSON.stringify(project));
}

export function readActiveAndroidMultitrackProject(): MultitrackProject | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_ANDROID_MULTITRACK_EXPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultitrackProject;
    return parsed?.schema === 'knoux-multitrack' && Array.isArray(parsed.tracks) ? parsed : null;
  } catch {
    return null;
  }
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
      writeActiveAndroidMultitrackProject(project);
      return (base.save as (...params: unknown[]) => Promise<unknown>)(project, ...args) as ReturnType<typeof base.save>;
    },
    autosave: async (project: MultitrackProject, ...args: unknown[]) => {
      writeActiveAndroidMultitrackProject(project);
      return (base.autosave as (...params: unknown[]) => Promise<unknown>)(project, ...args) as ReturnType<typeof base.autosave>;
    },
  } as Window['knouxMultitrackAPI'];
}
