/**
 * KNOUX-X — D12 BRANCH SNAPSHOT STORE
 *
 * Persists immutable snapshots of a MultitrackProject at branch points,
 * alongside the derived BranchMetrics. `.knouxbranch` JSON files, atomic
 * writes, validated on load (same discipline as plan store / project
 * service). Snapshots are the ground truth for later branch comparison —
 * even after the live project has moved on.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app } from 'electron';

import type { MultitrackProject } from '../../src/core/creative/multitrackProject';
import { parseMultitrackProject } from '../../src/core/creative/multitrackProject';
import {
  computeBranchMetrics,
  type BranchMetrics,
} from '../../src/core/video-studio/ai/branch-metrics';

const BRANCH_EXTENSION = '.knouxbranch';
const MAX_BRANCH_BYTES = 56 * 1024 * 1024;
const MAX_BRANCHES_PER_PROJECT = 50;

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface StoredBranchRecord {
  branchId: string;
  projectId: string;
  projectName: string;
  label: string;
  parentBranchId: string | null;
  createdAt: string;
  metrics: BranchMetrics;
  project: MultitrackProject;
}

export class VideoBranchStore {
  private readonly directory: string;

  constructor() {
    this.directory = path.join(app.getPath('userData'), 'video-branches');
  }

  private branchPath(branchId: string): string {
    return path.join(this.directory, `${branchId}${BRANCH_EXTENSION}`);
  }

  async record(projectValue: unknown, label: string, parentBranchId?: string): Promise<StoredBranchRecord> {
    const project = parseMultitrackProject(projectValue);
    const safeLabel = typeof label === 'string' && label.trim().length > 0 && label.trim().length <= 120;
    if (!safeLabel) throw new TypeError('Branch label is invalid.');
    if (parentBranchId !== undefined && (typeof parentBranchId !== 'string' || !VALID_ID.test(parentBranchId))) {
      throw new TypeError('Parent branch id is invalid.');
    }
    const record: StoredBranchRecord = {
      branchId: randomUUID(),
      projectId: project.id,
      projectName: project.name,
      label: label.trim(),
      parentBranchId: parentBranchId ?? null,
      createdAt: new Date().toISOString(),
      metrics: computeBranchMetrics(project),
      project: parseMultitrackProject(JSON.parse(JSON.stringify(project)) as unknown),
    };
    await fs.mkdir(this.directory, { recursive: true });
    const content = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_BRANCH_BYTES) throw new RangeError('Branch snapshot exceeds the supported size limit.');
    const temporary = `${this.branchPath(record.branchId)}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.rename(temporary, this.branchPath(record.branchId));
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await this.compact(project.id);
    return record;
  }

  async list(projectId?: string): Promise<StoredBranchRecord[]> {
    try {
      const entries = await fs.readdir(this.directory, { withFileTypes: true });
      const branches: StoredBranchRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(BRANCH_EXTENSION)) continue;
        try {
          const content = await fs.readFile(path.join(this.directory, entry.name), 'utf8');
          const branch = this.validateStored(JSON.parse(content) as unknown);
          if (projectId === undefined || branch.projectId === projectId) branches.push(branch);
        } catch {
          // Invalid snapshots are skipped; they remain on disk for manual inspection.
        }
      }
      return branches.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async get(branchId: string): Promise<StoredBranchRecord | null> {
    if (typeof branchId !== 'string' || !VALID_ID.test(branchId)) throw new TypeError('Branch id is invalid.');
    try {
      const content = await fs.readFile(this.branchPath(branchId), 'utf8');
      return this.validateStored(JSON.parse(content) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(branchId: string): Promise<boolean> {
    if (typeof branchId !== 'string' || !VALID_ID.test(branchId)) throw new TypeError('Branch id is invalid.');
    try {
      await fs.rm(this.branchPath(branchId), { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private validateStored(value: unknown): StoredBranchRecord {
    if (!value || typeof value !== 'object') throw new TypeError('Branch snapshot is not an object.');
    const candidate = value as Record<string, unknown>;
    const branchId = candidate.branchId;
    const projectId = candidate.projectId;
    const projectName = candidate.projectName;
    const label = candidate.label;
    const parentBranchId = candidate.parentBranchId;
    const createdAt = candidate.createdAt;
    const projectValue = candidate.project;
    if (typeof branchId !== 'string' || !VALID_ID.test(branchId)) throw new TypeError('Stored branch id is invalid.');
    if (typeof projectId !== 'string' || typeof projectName !== 'string') throw new TypeError('Stored project identity is invalid.');
    if (typeof label !== 'string' || label.length === 0 || label.length > 120) throw new TypeError('Stored branch label is invalid.');
    if (parentBranchId !== null && (typeof parentBranchId !== 'string' || !VALID_ID.test(parentBranchId))) {
      throw new TypeError('Stored parent branch id is invalid.');
    }
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) throw new TypeError('Stored createdAt is invalid.');
    const project = parseMultitrackProject(projectValue);
    const metrics = computeBranchMetrics(project);
    return {
      branchId,
      projectId,
      projectName,
      label,
      parentBranchId,
      createdAt,
      metrics,
      project,
    };
  }

  private async compact(projectId: string): Promise<void> {
    const branches = await this.list(projectId);
    if (branches.length <= MAX_BRANCHES_PER_PROJECT) return;
    const stale = branches.slice(MAX_BRANCHES_PER_PROJECT);
    await Promise.all(stale.map((branch) => fs.rm(this.branchPath(branch.branchId), { force: true })));
  }
}