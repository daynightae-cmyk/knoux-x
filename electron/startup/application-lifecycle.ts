export interface QuitEvent {
  preventDefault(): void;
}

export interface ApplicationLifecycleDependencies {
  onBeforeQuit(listener: (event: QuitEvent) => void): void;
  onWindowAllClosed(listener: () => void): void;
  quit(): void;
  exit(exitCode: number): void;
}

export interface ApplicationLifecycleOptions {
  platform: NodeJS.Platform;
  cleanup(): Promise<void>;
  reportCleanupFailure(error: unknown): void;
}

/**
 * Registers quit handlers before asynchronous startup begins. This preserves the
 * cleanup contract even when a quit arrives while the runtime is still booting.
 */
export function registerApplicationLifecycle(
  application: ApplicationLifecycleDependencies,
  options: ApplicationLifecycleOptions,
): void {
  application.onBeforeQuit((event) => {
    event.preventDefault();
    void options.cleanup()
      .catch((error) => options.reportCleanupFailure(error))
      .then(() => application.exit(0));
  });

  application.onWindowAllClosed(() => {
    if (options.platform !== 'darwin') application.quit();
  });
}
