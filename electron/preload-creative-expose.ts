import { contextBridge, ipcRenderer } from 'electron';

import { creativeAPI } from './preload-creative';
import type { CreativeAPI } from './preload-creative';

const permissionAwareCreativeAPI = {
  ...creativeAPI,
  recording: {
    ...creativeAPI.recording,
    requestMediaPermission: (): Promise<boolean> =>
      ipcRenderer.invoke('creative:request-media-permission'),
  },
};

contextBridge.exposeInMainWorld('knouxCreativeAPI', permissionAwareCreativeAPI);

export type PermissionAwareCreativeAPI = CreativeAPI & {
  recording: CreativeAPI['recording'] & {
    requestMediaPermission(): Promise<boolean>;
  };
};

declare global {
  interface Window {
    knouxCreativeAPI: PermissionAwareCreativeAPI;
  }
}
