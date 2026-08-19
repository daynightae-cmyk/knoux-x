import {
  IMAGE_STUDIO_SCHEMA,
  IMAGE_STUDIO_SCHEMA_VERSION,
  type ImageStudioDocument,
} from '../document/schema';
import { parseImageStudioDocument } from '../document/document';

/**
 * Schema migration framework for KNOUX Image Studio documents.
 *
 * Documents carry a `schemaVersion`; older versions are upgraded through
 * a registry of {from -> to} steps, each of which is a pure transform on
 * the raw document object. Every applied step is recorded in
 * `migrationHistory` so the exact upgrade path is auditable.
 *
 * The current schema is version 1 (IMAGE_STUDIO_SCHEMA_VERSION), so no
 * forward migrations are registered yet — the registry is the seam future
 * schema changes will use, and it is exercised by tests with a synthetic
 * registry.
 */

export interface MigrationStep {
  from: number;
  to: number;
  apply: (document: unknown) => unknown;
}

export class SchemaMigrationRegistry {
  private readonly steps = new Map<string, MigrationStep>();

  register(step: MigrationStep): void {
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to) || step.to !== step.from + 1)
      throw new RangeError('Migration steps must advance by exactly one version.');
    const key = this.key(step.from, step.to);
    if (this.steps.has(key)) throw new Error(`Migration ${key} is already registered.`);
    this.steps.set(key, step);
  }

  private key(from: number, to: number): string {
    return `${from}->${to}`;
  }

  has(from: number, to: number): boolean {
    return this.steps.has(this.key(from, to));
  }

  /** Return the ordered chain of steps to reach `target` from `from`. */
  chain(from: number, target: number): MigrationStep[] {
    const result: MigrationStep[] = [];
    let current = from;
    let guard = 0;
    while (current < target) {
      const step = this.steps.get(this.key(current, current + 1));
      if (!step) throw new Error(`No migration registered for ${current} -> ${current + 1}.`);
      result.push(step);
      current = step.to;
      if (++guard > 100) throw new Error('Migration chain is too long.');
    }
    return result;
  }
}

export interface MigrateOptions {
  registry?: SchemaMigrationRegistry;
}

export interface MigrateResult {
  document: ImageStudioDocument;
  applied: Array<{ from: number; to: number; appliedAt: string }>;
  upToDate: boolean;
}

/**
 * Upgrade a raw document payload to the current schema version, validating
 * the result at the end. Throws for unknown/older-schema payloads that
 * cannot be upgraded.
 */
export function migrateDocument(value: unknown, options: MigrateOptions = {}): MigrateResult {
  if (!value || typeof value !== 'object')
    throw new TypeError('Image Studio document must be an object.');
  const raw = value as Record<string, unknown>;
  if (raw.schema !== IMAGE_STUDIO_SCHEMA)
    throw new TypeError('Payload is not a KNOUX Image Studio document.');
  const current = raw.schemaVersion;
  if (typeof current !== 'number' || !Number.isInteger(current))
    throw new TypeError('Document schema version is invalid.');
  const target = IMAGE_STUDIO_SCHEMA_VERSION;
  if (current > target) throw new Error(`Document is from a newer schema (v${current}); upgrade the app.`);
  if (current === target) {
    const document = parseImageStudioDocument(value);
    return { document, applied: [], upToDate: true };
  }
  const registry = options.registry ?? new SchemaMigrationRegistry();
  const steps = registry.chain(current, target);
  const applied: Array<{ from: number; to: number; appliedAt: string }> = [];
  let payload: unknown = value;
  for (const step of steps) {
    payload = step.apply(payload);
    applied.push({ from: step.from, to: step.to, appliedAt: new Date().toISOString() });
  }
  const document = parseImageStudioDocument(payload);
  document.migrationHistory = [...document.migrationHistory, ...applied];
  return { document, applied, upToDate: true };
}

/** Convenience: migrate already-parsed legacy payloads (schemaVersion 0 flat image). */
export function migrateToCurrent(
  value: unknown,
  options: MigrateOptions = {}
): ImageStudioDocument {
  return migrateDocument(value, options).document;
}
