import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { app, dialog } from 'electron';
import Store from 'electron-store';

import {
  createSlideshowProject,
  parseSlideshowProject,
  type SlideshowProject,
  type SlideshowTemplate,
} from '../../src/core/creative/slideshowProject';

const PROJECT_EXTENSION = '.knouxslide';
const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
const MAX_RECENT_PROJECTS = 30;
const MAX_BACKUPS = 10;

interface SlideshowStoreSchema {
  recentProjects: string[];
  autosaveDirectory: string;
  backupDirectory: string;
  quarantineDirectory: string;
  backupIndex: Record<string, string>;
}

export interface SlideshowRecovery {
  status: 'valid' | 'corrupt';
  project: SlideshowProject | null;
  filePath: string;
  modifiedAt: string;
  quarantinePath: string | null;
  error: string | null;
  backups: SlideshowBackupInfo[];
}

export interface SlideshowBackupInfo {
  filePath: string;
  modifiedAt: string;
  bytes: number;
  sha256: string;
  project: SlideshowProject;
}

export type SlideshowOpenResult =
  | { status: 'opened'; project: SlideshowProject; filePath: string }
  | {
      status: 'corrupt';
      project: null;
      filePath: string;
      quarantinePath: string;
      error: string;
      backups: SlideshowBackupInfo[];
    };

function ensureExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION)
    ? filePath
    : `${filePath}${PROJECT_EXTENSION}`;
}

function serializedProject(project: SlideshowProject): string {
  const validated = parseSlideshowProject(project);
  validated.updatedAt = new Date().toISOString();
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export class SlideshowProjectService {
  private readonly store: Store<SlideshowStoreSchema>;

  constructor() {
    const root = app.getPath('userData');
    this.store = new Store<SlideshowStoreSchema>({
      name: 'slideshow-projects',
      defaults: {
        recentProjects: [],
        autosaveDirectory: path.join(root, 'slideshow-autosave'),
        backupDirectory: path.join(root, 'slideshow-backups'),
        quarantineDirectory: path.join(root, 'slideshow-quarantine'),
        backupIndex: {},
      },
    });
  }

  create(name: string, template: SlideshowTemplate): SlideshowProject {
    return createSlideshowProject(randomUUID(), name, template);
  }

  async open(): Promise<SlideshowOpenResult | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open KNOUX slideshow project',
      filters: [{ name: 'KNOUX Slideshow Project', extensions: ['knouxslide'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.openPath(result.filePaths[0], true);
  }

  async openRecent(filePath: string): Promise<SlideshowOpenResult> {
    const resolved = path.resolve(filePath);
    const recent = await this.recent();
    if (!recent.includes(resolved))
      throw new Error('Project is not in the recent KNOUX slideshow list.');
    return this.openPath(resolved, true);
  }

  async save(project: SlideshowProject, filePath?: string, saveAs = false): Promise<string | null> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES)
      throw new RangeError('Slideshow project exceeds the supported size limit.');
    let destination = filePath ? path.resolve(filePath) : null;
    if (!destination || saveAs) {
      const result = await dialog.showSaveDialog({
        title: 'Save KNOUX slideshow project',
        defaultPath: destination ?? `${project.name}${PROJECT_EXTENSION}`,
        filters: [{ name: 'KNOUX Slideshow Project', extensions: ['knouxslide'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      destination = path.resolve(result.filePath);
    }
    destination = ensureExtension(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const backup = await this.backupExisting(destination, project.id);
    await this.atomicWrite(destination, content);
    if (backup) await this.pruneBackups(path.dirname(backup));
    await this.remember(destination);
    await this.removeAutosave(project.id);
    return destination;
  }

  async autosave(project: SlideshowProject): Promise<string> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES)
      throw new RangeError('Slideshow project exceeds the autosave size limit.');
    const directory = this.store.get('autosaveDirectory');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${project.id}${PROJECT_EXTENSION}.autosave`);
    await this.atomicWrite(destination, content);
    return destination;
  }

  async recoveries(): Promise<SlideshowRecovery[]> {
    const directory = this.store.get('autosaveDirectory');
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const results: SlideshowRecovery[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(`${PROJECT_EXTENSION}.autosave`)) continue;
        const filePath = path.join(directory, entry.name);
        try {
          const opened = await this.read(filePath, false);
          const stats = await fs.stat(filePath);
          results.push({
            status: 'valid',
            project: opened.project,
            filePath,
            modifiedAt: stats.mtime.toISOString(),
            quarantinePath: null,
            error: null,
            backups: [],
          });
        } catch (error) {
          const stats = await fs.stat(filePath);
          const quarantinePath = await this.quarantineCopy(filePath);
          results.push({
            status: 'corrupt',
            project: null,
            filePath,
            modifiedAt: stats.mtime.toISOString(),
            quarantinePath,
            error: error instanceof Error ? error.message : 'Autosave is corrupt.',
            backups: [],
          });
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
        if (stats.isFile() && stats.size > 0 && stats.size <= MAX_PROJECT_BYTES)
          existing.push(path.resolve(filePath));
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

  async recoverBackup(
    originalPath: string,
    quarantinePath: string,
    backupPath: string
  ): Promise<{ project: SlideshowProject; filePath: string }> {
    const original = path.resolve(originalPath);
    const quarantine = path.resolve(quarantinePath);
    const backup = path.resolve(backupPath);
    this.requireInside(
      quarantine,
      this.store.get('quarantineDirectory'),
      'Slideshow quarantine path'
    );
    this.requireInside(backup, this.store.get('backupDirectory'), 'Slideshow backup path');
    const quarantined = await fs.readFile(quarantine);
    if (quarantined.byteLength === 0) throw new Error('Quarantined slideshow is empty.');
    const content = await fs.readFile(backup, 'utf8');
    const project = parseSlideshowProject(JSON.parse(content) as unknown);
    await this.atomicWrite(original, content);
    await this.remember(original);
    return { project, filePath: original };
  }

  private async read(
    filePath: string,
    remember: boolean
  ): Promise<{ project: SlideshowProject; filePath: string }> {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PROJECT_BYTES)
      throw new RangeError('Slideshow file is empty or exceeds the supported size limit.');
    const project = parseSlideshowProject(
      JSON.parse(await fs.readFile(resolved, 'utf8')) as unknown
    );
    if (remember) await this.remember(resolved);
    return { project, filePath: resolved };
  }

  private async openPath(filePath: string, remember: boolean): Promise<SlideshowOpenResult> {
    const resolved = path.resolve(filePath);
    try {
      const opened = await this.read(resolved, remember);
      return { status: 'opened', ...opened };
    } catch (error) {
      const stats = await fs.stat(resolved);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PROJECT_BYTES) throw error;
      const quarantinePath = await this.quarantineCopy(resolved);
      const backups = await this.validBackups(resolved);
      return {
        status: 'corrupt',
        project: null,
        filePath: resolved,
        quarantinePath,
        error: error instanceof Error ? error.message : 'Slideshow project is corrupt.',
        backups,
      };
    }
  }

  private async atomicWrite(destination: string, content: string): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const previous = `${destination}.${process.pid}.${randomUUID()}.previous`;
    let movedPrevious = false;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      try {
        await fs.rename(destination, previous);
        movedPrevious = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.rename(temporary, destination);
      if (movedPrevious) await fs.rm(previous, { force: true });
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (movedPrevious) {
        await fs.rm(destination, { force: true });
        await fs.rename(previous, destination);
      }
      throw error;
    }
  }

  private async backupExisting(destination: string, projectId: string): Promise<string | null> {
    try {
      const stats = await fs.stat(destination);
      if (!stats.isFile() || stats.size <= 0) return null;
      const existing = await fs.readFile(destination, 'utf8');
      parseSlideshowProject(JSON.parse(existing) as unknown);
      const directory = path.join(this.store.get('backupDirectory'), projectId);
      await fs.mkdir(directory, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(
        directory,
        `${timestamp}-${randomUUID()}${PROJECT_EXTENSION}.backup`
      );
      await this.atomicWrite(backup, existing);
      const index = this.store.get('backupIndex');
      this.store.set('backupIndex', { ...index, [path.resolve(destination)]: projectId });
      return backup;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    }
  }

  private async pruneBackups(directory: string): Promise<void> {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(`${PROJECT_EXTENSION}.backup`))
      .sort((left, right) => right.name.localeCompare(left.name));
    await Promise.all(
      entries
        .slice(MAX_BACKUPS)
        .map((entry) => fs.rm(path.join(directory, entry.name), { force: true }))
    );
  }

  private async validBackups(destination: string): Promise<SlideshowBackupInfo[]> {
    const projectId = this.store.get('backupIndex')[path.resolve(destination)];
    if (!projectId) return [];
    const directory = path.join(this.store.get('backupDirectory'), projectId);
    try {
      const entries = (await fs.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(`${PROJECT_EXTENSION}.backup`))
        .sort((left, right) => right.name.localeCompare(left.name));
      const backups: SlideshowBackupInfo[] = [];
      for (const entry of entries.slice(0, MAX_BACKUPS)) {
        const filePath = path.join(directory, entry.name);
        try {
          const bytes = await fs.readFile(filePath);
          const project = parseSlideshowProject(JSON.parse(bytes.toString('utf8')) as unknown);
          const stats = await fs.stat(filePath);
          backups.push({
            filePath,
            modifiedAt: stats.mtime.toISOString(),
            bytes: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            project,
          });
        } catch {
          // Invalid backup files are not offered as recoverable versions.
        }
      }
      return backups;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async quarantineCopy(filePath: string): Promise<string> {
    const directory = this.store.get('quarantineDirectory');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(
      directory,
      `${path.basename(filePath)}.${new Date().toISOString().replace(/[:.]/g, '-')}.${randomUUID()}.corrupt`
    );
    await fs.copyFile(filePath, destination);
    return destination;
  }

  private requireInside(candidate: string, root: string, name: string): void {
    const relative = path.relative(path.resolve(root), candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error(`${name} is outside the managed directory.`);
  }

  private async remember(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const recent = this.store
      .get('recentProjects')
      .filter((entry) => path.resolve(entry) !== resolved);
    this.store.set('recentProjects', [resolved, ...recent].slice(0, MAX_RECENT_PROJECTS));
  }

  private async removeAutosave(projectId: string): Promise<void> {
    await fs.rm(
      path.join(this.store.get('autosaveDirectory'), `${projectId}${PROJECT_EXTENSION}.autosave`),
      { force: true }
    );
  }
}
