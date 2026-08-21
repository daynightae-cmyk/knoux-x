/**
 * Compatibility entry point for settings IPC registration.
 *
 * Production startup registers this surface through `setupIPCHandlers`. This
 * exported adapter keeps legacy imports on the same authoritative registry,
 * rather than creating a second electron-store-backed IPC implementation.
 */
import type { SystemOrchestrator } from '../../src/core/orchestrator/SystemOrchestrator';

import type { IpcRegistrar } from './registry';
import { registerSettingsHandlers } from './setup';

export function setupSettingsHandlers(registry: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  registerSettingsHandlers(registry, orchestrator);
}
