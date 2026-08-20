/**
 * KNOUX-X — D11 APPROVED EDIT PLAN STORE
 *
 * Persists approved EditPlan records as immutable JSON outside the project
 * file itself (the project stays a pure operation graph; plans are audit +
 * replay records). Atomic writes; records are validated through
 * parseEditPlan on load before ever reaching replay.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { app } from 'electron';

import type { MultitrackProject } from '../../src/core/creative/multitrackProject';
import { parseEditPlan, type EditPlanRecord } from '../../src/core/video-studio/ai/edit-plan';

const PLAN_EXTENSION = '.knouxplan';
const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 200;

export interface StoredEditPlanRecord extends EditPlanRecord {
  recordId: string;
  sourceProjectSha256: string | null;
}

export function fullSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class EditPlanStore {
  private readonly directory: string;

  constructor() {
    this.directory = path.join(app.getPath('userData'), 'edit-plans');
  }

  planPath(recordId: string): string {
    return path.join(this.directory, `${recordId}${PLAN_EXTENSION}`);
  }

  /**
   * Records an approved plan for a source project. Computes the full
   * SHA-256 of the canonical project JSON for authoritative identity
   * (spec §3.1). Returns the stored record.
   */
  async record(project: MultitrackProject, planValue: unknown): Promise<StoredEditPlanRecord> {
    const plan = parseEditPlan(planValue);
    const record: StoredEditPlanRecord = {
      ...plan,
      recordId: randomUUID(),
      approvedAt: new Date().toISOString(),
      execution: { appliedAt: null, outputProjectFingerprint: null, applied: false, error: null },
      sourceProjectSha256: fullSha256(JSON.stringify(project)),
    };
    await fs.mkdir(this.directory, { recursive: true });
    const content = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_PLAN_BYTES) throw new RangeError('Edit plan record exceeds the supported size limit.');
    const temporary = `${this.planPath(record.recordId)}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.rename(temporary, this.planPath(record.recordId));
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await this.compact();
    return record;
  }

  async list(): Promise<StoredEditPlanRecord[]> {
    try {
      const entries = await fs.readdir(this.directory, { withFileTypes: true });
      const records: StoredEditPlanRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(PLAN_EXTENSION)) continue;
        try {
          const content = await fs.readFile(path.join(this.directory, entry.name), 'utf8');
          const parsed = JSON.parse(content) as unknown;
          records.push(this.validateStored(parsed));
        } catch {
          // Invalid records are skipped; they remain on disk for manual inspection.
        }
      }
      return records.sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  /** Returns the stored record if the source project matches its SHA-256. */
  async findApplicable(project: MultitrackProject): Promise<StoredEditPlanRecord | null> {
    const sha = fullSha256(JSON.stringify(project));
    const records = await this.list();
    return records.find((record) => record.sourceProjectSha256 === sha) ?? null;
  }

  async get(recordId: string): Promise<StoredEditPlanRecord | null> {
    const safe = typeof recordId === 'string' && /^[0-9a-f-]{8,64}$/.test(recordId);
    if (!safe) throw new TypeError('Edit plan record id is invalid.');
    try {
      const content = await fs.readFile(this.planPath(recordId), 'utf8');
      return this.validateStored(JSON.parse(content) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(recordId: string): Promise<boolean> {
    const safe = typeof recordId === 'string' && /^[0-9a-f-]{8,64}$/.test(recordId);
    if (!safe) throw new TypeError('Edit plan record id is invalid.');
    try {
      await fs.rm(this.planPath(recordId), { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** Marks a record as executed with the produced project fingerprint. */
  async markApplied(recordId: string, outputProjectFingerprint: string): Promise<StoredEditPlanRecord | null> {
    const current = await this.get(recordId);
    if (!current) return null;
    const updated: StoredEditPlanRecord = {
      ...current,
      execution: {
        appliedAt: new Date().toISOString(),
        outputProjectFingerprint,
        applied: true,
        error: null,
      },
    };
    const content = `${JSON.stringify(updated, null, 2)}\n`;
    const temporary = `${this.planPath(recordId)}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.rename(temporary, this.planPath(recordId));
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return updated;
  }

  private validateStored(value: unknown): StoredEditPlanRecord {
    const plan = parseEditPlan(value);
    const record = value as StoredEditPlanRecord;
    if (typeof record.recordId !== 'string' || !/^[0-9a-f-]{8,64}$/.test(record.recordId)) throw new TypeError('Stored record id is invalid.');
    if (typeof record.approvedAt !== 'string' || Number.isNaN(Date.parse(record.approvedAt))) throw new TypeError('Stored approvedAt is invalid.');
    if (record.sourceProjectSha256 !== null && typeof record.sourceProjectSha256 !== 'string') throw new TypeError('Stored sourceProjectSha256 is invalid.');
    return { ...plan, ...record };
  }

  private async compact(): Promise<void> {
    const records = await this.list();
    if (records.length <= MAX_RECORDS) return;
    const stale = records.slice(MAX_RECORDS);
    await Promise.all(stale.map((record) => fs.rm(this.planPath(record.recordId), { force: true })));
  }
}