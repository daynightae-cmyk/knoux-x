/**
 * Settings IPC Handlers
 * Manages persistent application settings storage using electron-store
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import Store from 'electron-store';

export interface SettingsSchema {
  'ai.apiKey'?: string;
  'ai.model'?: string;
  'player.lastPath'?: string;
  'player.volume'?: number;
  'ui.theme'?: 'light' | 'dark';
}

const store = new Store<SettingsSchema>({
  name: 'knoux-settings',
  schema: {
    'ai.apiKey': { type: 'string' },
    'ai.model': { type: 'string' },
    'player.lastPath': { type: 'string' },
    'player.volume': { type: 'number' },
    'ui.theme': { enum: ['light', 'dark'] },
  },
});

export function setupSettingsHandlers(): void {
  // Get a setting value
  ipcMain.handle(
    'settings:get',
    (_event: IpcMainInvokeEvent, key: string, defaultValue?: unknown) => {
      try {
        const value = store.get(key as keyof SettingsSchema);
        return value ?? defaultValue;
      } catch (error) {
        console.error(`Failed to get setting ${key}:`, error);
        return defaultValue;
      }
    }
  );

  // Set a setting value
  ipcMain.handle(
    'settings:set',
    (_event: IpcMainInvokeEvent, key: string, value: unknown) => {
      try {
        store.set(key as keyof SettingsSchema, value as never);
        return { success: true };
      } catch (error) {
        console.error(`Failed to set setting ${key}:`, error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Delete a setting
  ipcMain.handle('settings:delete', (_event: IpcMainInvokeEvent, key: string) => {
    try {
      store.delete(key as keyof SettingsSchema);
      return { success: true };
    } catch (error) {
      console.error(`Failed to delete setting ${key}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get all settings
  ipcMain.handle('settings:getAll', (_event: IpcMainInvokeEvent) => {
    try {
      return store.store;
    } catch (error) {
      console.error('Failed to get all settings:', error);
      return {};
    }
  });

  // Clear all settings
  ipcMain.handle('settings:clear', (_event: IpcMainInvokeEvent) => {
    try {
      store.clear();
      return { success: true };
    } catch (error) {
      console.error('Failed to clear settings:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
