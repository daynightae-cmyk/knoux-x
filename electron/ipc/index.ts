/**
 * Canonical IPC bootstrap for the Electron main process.
 *
 * All production handlers are registered through `setupIPCHandlers` with the
 * authoritative registry; legacy settings-only registration is intentionally
 * not used by the packaged application.
 */
export { setupIPCHandlers } from './setup';
