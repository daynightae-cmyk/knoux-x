/**
 * Preload Script
 * Exposes safe IPC bridge to renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for IPC API
export interface SettingsAPI {
  get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<{ success: boolean; error?: string }>;
  delete(key: string): Promise<{ success: boolean; error?: string }>;
  getAll(): Promise<Record<string, unknown>>;
  clear(): Promise<{ success: boolean; error?: string }>;
}

export interface KnouxAPI {
  settings: SettingsAPI;
}

// Create the settings API
const settingsAPI: SettingsAPI = {
  get: (key: string, defaultValue?: unknown) =>
    ipcRenderer.invoke('settings:get', key, defaultValue),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  delete: (key: string) => ipcRenderer.invoke('settings:delete', key),
  getAll: () => ipcRenderer.invoke('settings:getAll'),
  clear: () => ipcRenderer.invoke('settings:clear'),
};

// Expose safe API to renderer
contextBridge.exposeInMainWorld('knouxAPI', {
  settings: settingsAPI,
} as KnouxAPI);

// Declare global for TypeScript
declare global {
  interface Window {
    knouxAPI: KnouxAPI;
  }
}
