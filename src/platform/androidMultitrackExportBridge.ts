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

export function installAndroidMultitrackExportBridge(): void {
  if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxMultitrackAPI !== 'object') return;
  const base = window.knouxMultitrackAPI;
  const decorate = <T extends { project: MultitrackProject } | MultitrackProject | null>(value: T): T => {
    if (!value) return value;
    const project = 'project' in value ? value.project : value;
    if (project?.schema === 'knoux-multitrack') writeActiveAndroidMultitrackProject(project);
    return value;
  };

  window.knouxMultitrackAPI = {
    ...base,
    create: async (...args: Parameters<typeof base.create>) => decorate(await base.create(...args)),
    open: async (...args: Parameters<typeof base.open>) => decorate(await base.open(...args)),
    openRecent: async (...args: Parameters<typeof base.openRecent>) => decorate(await base.openRecent(...args)),
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
