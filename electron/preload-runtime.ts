import { contextBridge } from 'electron';

import { DESKTOP_RUNTIME_DESCRIPTOR } from './ipc/contract';

contextBridge.exposeInMainWorld('knouxRuntime', DESKTOP_RUNTIME_DESCRIPTOR);
