import { contextBridge } from 'electron';

import { IPC_INVOKE } from './ipc/contract';
import { invokeDesktop } from './ipc/preload-client';
import { creativeAPI } from './preload-creative';
import type { CreativeAPI } from './preload-creative';

const permissionAwareCreativeAPI = {
  ...creativeAPI,
  recording: {
    ...creativeAPI.recording,
    requestMediaPermission: (): Promise<boolean> =>
      invokeDesktop(IPC_INVOKE.CREATIVE_REQUEST_MEDIA_PERMISSION),
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
