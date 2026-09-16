import {
  DEFAULT_WORKSPACE_SETTINGS,
  type WorkspaceSettings,
  validateWorkspaceSettings,
} from './productCustomization';

/**
 * Runtime settings can outlive the schema that created them. Never let a
 * malformed/legacy persisted workspace crash the renderer during startup.
 */
export function normalizeRuntimeWorkspace(value: unknown): WorkspaceSettings {
  try {
    return validateWorkspaceSettings(value);
  } catch (error) {
    console.warn(
      '[KNOUX] Invalid persisted workspace; restoring safe defaults.',
      error instanceof Error ? error.message : String(error),
    );
    return structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  }
}
