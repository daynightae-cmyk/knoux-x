import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import { app, dialog } from 'electron';
import Store from 'electron-store';

import {
  EDIT_PROJECT_VERSION,
  EditProject,
  parseEditProject,
} from '../../src/core/creative/editProject';

const PROJECT_EXTENSION = '.knouxedit';
const MAX_RECENT_PROJECTS = 20;
const MAX_PROJECT_BYTES = 32 * 1024 * 1024;

interface ProjectStoreSchema {
  recentProjects: string[];
  autosaveDirectory: string;
}

export interface NewProjectRequest {
  name: string;
}

export interface SaveProjectRequest {
  project: EditProject;
  filePath?: string;
  saveAs?: boolean;
}

function ensureProjectExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION) ? filePath : `${filePath}${PROJECT_EXTENSION}`;
}

function serializeProject(project: EditProject): string {
  const validated = parseEditProject(project);
  validated.updatedAt = new Date().toISOString();
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export class ProjectService {
  private readonly store: Store<ProjectStoreSchema>;

  constructor() {
    const autosaveDirectory = path.join(app.getPath('userData'), 'editor-autosave');
    this.store = new Store<ProjectStoreSchema>({
      name: 'creative-projects',
      defaults: { recentProjects: [], autosaveDirectory },
    });
  }

  createProject(request: NewProjectRequest): EditProject {
    const name = request.name.normalize('NFC').trim();
    if (name.length === 0 || name.length > 160) {
      throw new RangeError('Project name must contain 1-160 characters.');
    }
    const now = new Date().toISOString();
    return {
      version: EDIT_PROJECT_VERSION,
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      clips: [],
      markers: [],
    };
  }

  async openProject(): Promise<{ project: EditProject; filePath: string } | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open KNOUX edit project',
      filters: [{ name: 'KNOUX Edit Project', extensions: ['knouxedit'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.readProject(result.filePaths[0]);
  }

  async openRecent(filePath: string): Promise<{ project: EditProject; filePath: string }> {
    const resolved = path.resolve(filePath);
    const recent = await this.getRecentProjects();
    if (!recent.includes(resolved)) throw new Error('Project is not in the recent KNOUX project list.');
    return this.readProject(resolved);
  }

  async saveProject(request: SaveProjectRequest): Promise<string | null> {
    const content = serializeProject(request.project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) {
      throw new RangeError('Project exceeds the supported size limit.');
    }

    let destination = request.filePath ? path.resolve(request.filePath) : null;
    if (!destination || request.saveAs) {
      const result = await dialog.showSaveDialog({
        title: 'Save KNOUX edit project',
        defaultPath: destination ?? `${request.project.name}${PROJECT_EXTENSION}`,
        filters: [{ name: 'KNOUX Edit Project', extensions: ['knouxedit'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      destination = path.resolve(result.filePath);
    }

    destination = ensureProjectExtension(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await this.atomicWrite(destination, content);
    await this.remember(destination);
    await this.removeAutosave(request.project.id);
    return destination;
  }

  async autosave(project: EditProject): Promise<string> {
    const content = serializeProject(project);
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_BYTES) {
      throw new RangeError('Project exceeds the supported autosave size limit.');
    }
    const directory = this.store.get('autosaveDirectory');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${project.id}${PROJECT_EXTENSION}.autosave`);
    await this.atomicWrite(destination, content);
    return destination;
  }

  async recoverAutosaves(): Promise<Array<{ project: EditProject; filePath: string }>> {
    const directory = this.store.get('autosaveDirectory');
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const recovered: Array<{ project: EditProject; filePath: string }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(`${PROJECT_EXTENSION}.autosave`)) continue;
        const filePath = path.join(directory, entry.name);
        try {
          recovered.push(await this.readProject(filePath, false));
        } catch {
          // Keep malformed autosaves on disk for manual recovery, but do not expose them as valid.
        }
      }
      return recovered.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async getRecentProjects(): Promise<string[]> {
    const recent = this.store.get('recentProjects');
    const existing: string[] = [];
    for (const filePath of recent) {
      try {
        await fs.access(filePath);
        existing.push(filePath);
      } catch {
        // Remove stale entries below.
      }
    }
    if (existing.length !== recent.length) this.store.set('recentProjects', existing);
    return existing;
  }

  async clearRecentProjects(): Promise<void> {
    this.store.set('recentProjects', []);
  }

  private async readProject(filePath: string, remember = true): Promise<{ project: EditProject; filePath: string }> {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PROJECT_BYTES) {
      throw new RangeError('Project file is empty or exceeds the supported size limit.');
    }
    const content = await fs.readFile(resolved, 'utf8');
    const project = parseEditProject(JSON.parse(content) as unknown);
    if (remember) await this.remember(resolved);
    return { project, filePath: resolved };
  }

  private async atomicWrite(destination: string, content: string): Promise<void> {
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'w' });
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async remember(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const recent = this.store.get('recentProjects').filter((entry) => entry !== resolved);
    this.store.set('recentProjects', [resolved, ...recent].slice(0, MAX_RECENT_PROJECTS));
  }

  private async removeAutosave(projectId: string): Promise<void> {
    const autosave = path.join(this.store.get('autosaveDirectory'), `${projectId}${PROJECT_EXTENSION}.autosave`);
    await fs.rm(autosave, { force: true });
  }
}
