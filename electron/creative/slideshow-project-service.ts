import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
}

export interface SlideshowRecovery {
  project: SlideshowProject;
  filePath: string;
  modifiedAt: string;
}

function ensureExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION) ? filePath : `${filePath}${PROJECT_EXTENSION}`;
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
      },
    });
  }

  create(name: string, template: SlideshowTemplate): SlideshowProject {
    return createSlideshowProject(randomUUID(), name, template);
  }

  async open(): Promise<{ project: SlideshowProject; filePath: string } | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open KNOUX slideshow project',
      filters: [{ name: 'KNOUX Slideshow Project', extensions: ['knouxslide'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.read(result.filePaths[0], true);
  }

  async openRecent(filePath: string): Promise<{ project: SlideshowProject; filePath: string }> {
    const resolved = path.resolve(filePath);
    const recent = await this.recent();
    if (!recent.includes(resolved)) throw new Error('Project is not in the recent KNOUX slideshow list.');
    return this.read(resolved, true);
  }

  async save(project: SlideshowProject, filePath?: string, saveAs = false): Promise<string | null> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) throw new RangeError('Slideshow project exceeds the supported size limit.');
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
    await this.backupExisting(destination, project.id);
    await this.atomicWrite(destination, content);
    await this.remember(destination);
    await this.removeAutosave(project.id);
    return destination;
  }

  async autosave(project: SlideshowProject): Promise<string> {
    const content = serializedProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) throw new RangeError('Slideshow project exceeds the autosave size limit.');
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
          results.push({ project: opened.project, filePath, modifiedAt: stats.mtime.toISOString() });
        } catch {
          // Invalid autosaves are intentionally omitted from recovery choices.
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

  private async read(filePath: string, remember: boolean): Promise<{ project: SlideshowProject; filePath: string }> {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PROJECT_BYTES) throw new RangeError('Slideshow file is empty or exceeds the supported size limit.');
    const project = parseSlideshowProject(JSON.parse(await fs.readFile(resolved, 'utf8')) as unknown);
    if (remember) await this.remember(resolved);
    return { project, filePath: resolved };
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
    await fs.rm(path.join(this.store.get('autosaveDirectory'), `${projectId}${PROJECT_EXTENSION}.autosave`), { force: true });
  }
}
