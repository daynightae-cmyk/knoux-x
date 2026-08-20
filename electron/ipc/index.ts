/**
 * Electron IPC Setup
 * Initializes all IPC handlers for main process
 */

import { setupSettingsHandlers } from './settings-handlers';

export function setupIpcHandlers(): void {
  // Initialize all IPC handler groups
  setupSettingsHandlers();
}
