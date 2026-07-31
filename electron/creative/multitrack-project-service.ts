import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, dialog } from 'electron';
import Store from 'electron-store';

import { parseEditProject } from '../../src/core/creative/editProject';
import {
  createMultitrackProject,
  migrateLegacyClips,
  parseMultitrackProject,
  type MultitrackProject,
} from '../../src/core/creative/multitrackProject';

const PROJECT_EXTENSION = '.knouxedit';
const MAX_PROJECT_BYTES = 48 * 1024 * 1024;
const MAX_RECENT_PROJECTS = 30;
const MAX_BACKUPS = 10;

interface MultitrackStoreSchema {
  recentProjects: string[];
  autosaveDirectory: string;
  backupDirectory: string;
}

export interface MultitrackRecovery {
  project: MultitrackProject;
  filePath: string;
  modifiedAt: string;
}

function ensureExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION) ? filePath : `${filePath}${PROJECT_EXTENSION}`;
}

function safeProjectName(name: string): string {
  const normalized = name.normalize('NFC').trim();
  if (normalized.length === 0 || normalized.length > 160) throw new RangeError('Project name must contain 1-160 characters.');
  return normalized;
}

function parseCompatibleProject(value: unknown): MultitrackProject {
  try {
    return parseMultitrackProject(value);
  } catch (multitrackError) {
    try {
      const legacy = parseEditProject(value);
      return migrateLegacyClips(
        legacy.id,
        legacy.name,
        legacy.createdAt,
        legacy.updatedAt,
        legacy.clips,
      );
    } catch {
      throw multitrackError;
    }
  }
}

function serializedProject(project: MultitrackProject): string {
  const validated = parseMultitrackProject(project);
  validated.updatedAt = new Date().toISOString();
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export class MultitrackProjectService {
  private readonly store: Store<MultitrackStoreSchema>;

  constructor() {
    const root = app.getPath('userData');
    this.store = new Store<MultitrackStoreSchema>({
      name: 'multitrack-projects',
      defaults: {
        recentProjects: [],
        autosaveDirectory: path.join(root, 'multitrack-autosave'),
        backupDirectory: path.join(root, 'multitrack-backups'),
      },
    });
  }

  create(name: string): MultitrackProject {
    return createMultitrackProject(randomUUID(), safeProjectName(name));
  }

  async open(): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean } | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open KNOUX multitrack project',
      filters: [{ name: 'KNOUX Edit Project', extensions: ['knouxedit'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.read(result.filePaths[0], true);
  }

  async openRecent(filePath: string): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean }> {
    const resolved = path.resolve(filePath);
    const recent = await this.recent();
    if (!recent.includes(resolved)) throw new Error('Project is not in the recent KNOUX multitrack project list.');
    return this.read(resolved, true);
  }

  async save(project: MultitrackProject, filePath?: string, saveAs = false): Promise<string | null> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) throw new RangeError('Project exceeds the supported size limit.');

    let destination = filePath ? path.resolve(filePath) : null;
    if (!destination || saveAs) {
      const result = await dialog.showSaveDialog({
        title: 'Save KNOUX multitrack project',
        defaultPath: destination ?? `${safeProjectName(project.name)}${PROJECT_EXTENSION}`,
        filters: [{ name: 'KNOUX Edit Project', extensions: ['knouxedit'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      destination = path.resolve(result.filePath);
    }
    destination = ensureExtension(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await this.backupExisting(destination, project.id);
    await this.atomicWrite(destination, content);
    await this.remember(destination);
    await this.removeAutosave(project.id);
    return destination;
  }

  async autosave(project: MultitrackProject): Promise<string> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) throw new RangeError('Project exceeds the supported autosave size limit.');
    const directory = this.store.get('autosaveDirectory');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${project.id}${PROJECT_EXTENSION}.autosave`);
    await this.atomicWrite(destination, content);
    return destination;
  }

  async recoveries(): Promise<MultitrackRecovery[]> {
    const directory = this.store.get('autosaveDirectory');
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const results: MultitrackRecovery[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(`${PROJECT_EXTENSION}.autosave`)) continue;
        const filePath = path.join(directory, entry.name);
        try {
          const opened = await this.read(filePath, false);
          const stats = await fs.stat(filePath);
          results.push({ project: opened.project, filePath, modifiedAt: stats.mtime.toISOString() });
        } catch {
          // Invalid recovery files remain available for manual inspection but are not exposed as valid projects.
        }
      }
      return results.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async recent(): Promise<string[]> {
    const stored = this.store.get('recentProjects');
    const existing: string[] = [];
    for (const filePath of stored) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile() && stats.size > 0 && stats.size <= MAX_PROJECT_BYTES) existing.push(path.resolve(filePath));
      } catch {
        // Stale entries are removed below.
      }
    }
    if (existing.length !== stored.length) this.store.set('recentProjects', existing);
    return existing;
  }

  clearRecent(): void {
    this.store.set('recentProjects', []);
  }

  private async read(
    filePath: string,
    remember: boolean,
  ): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean }> {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PROJECT_BYTES) {
      throw new RangeError('Project file is empty or exceeds the supported size limit.');
    }
    const content = await fs.readFile(resolved, 'utf8');
    const raw = JSON.parse(content) as unknown;
    const migrated = !raw || typeof raw !== 'object' || (raw as { schema?: unknown }).schema !== 'knoux-multitrack';
    const project = parseCompatibleProject(raw);
    if (remember) await this.remember(resolved);
    return { project, filePath: resolved, migrated };
  }

  private async atomicWrite(destination: string, content: string): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async backupExisting(destination: string, projectId: string): Promise<void> {
    try {
      const stats = await fs.stat(destination);
      if (!stats.isFile() || stats.size <= 0) return;
      const directory = path.join(this.store.get('backupDirectory'), projectId);
      await fs.mkdir(directory, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(directory, `${timestamp}${PROJECT_EXTENSION}.backup`);
      await fs.copyFile(destination, backup);
      const entries = (await fs.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(`${PROJECT_EXTENSION}.backup`))
        .sort((left, right) => right.name.localeCompare(left.name));
      await Promise.all(entries.slice(MAX_BACKUPS).map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async remember(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const recent = this.store.get('recentProjects').filter((entry) => path.resolve(entry) !== resolved);
    this.store.set('recentProjects', [resolved, ...recent].slice(0, MAX_RECENT_PROJECTS));
  }

  private async removeAutosave(projectId: string): Promise<void> {
    const autosave = path.join(this.store.get('autosaveDirectory'), `${projectId}${PROJECT_EXTENSION}.autosave`);
    await fs.rm(autosave, { force: true });
  }
}
