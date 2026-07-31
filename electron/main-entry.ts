/* eslint-disable @typescript-eslint/no-var-requires -- the raw trace must run before any application import. */
const fs = require('node:fs') as typeof import('node:fs');

function reportRawStartup(event: string, detail = ''): void {
  const message = `[knoux-startup] pid=${process.pid} event=${event}${detail ? ` ${detail}` : ''}`;
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // A detached Windows GUI launch can have no writable stderr stream.
  }
  const traceFile = process.env.KNOUX_STARTUP_TRACE_FILE;
  if (traceFile) {
    try {
      fs.appendFileSync(traceFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
      // Startup tracing is diagnostic-only and must never block the application.
    }
  }
}

reportRawStartup('module-enter');

function failStartup(error: unknown): never {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  reportRawStartup('startup-import-failed', detail);
  process.exit(1);
}

try {
  // Electron's built-in CommonJS module must be loaded with require(). A dynamic
  // ESM import can resolve the npm shim instead of the main-process API.
  const { app } = require('electron') as typeof import('electron');
  const log = require('electron-log') as typeof import('electron-log').default;
  const started = require('electron-squirrel-startup') as boolean;
  reportRawStartup('external-imports-loaded');

  void import('./startup/single-instance').then(({ startSingleInstanceEntry }) => {
    reportRawStartup('startup-imports-loaded');

    const reportStartup = (event: string, detail = ''): void => {
      reportRawStartup(event, detail);
      log.info(`[knoux-startup] pid=${process.pid} event=${event}${detail ? ` ${detail}` : ''}`);
    };
    const terminateProcess = (exitCode: number): never => {
      reportStartup('exit', `code=${exitCode}`);
      process.exit(exitCode);
    };

    startSingleInstanceEntry({
      squirrelStartup: started,
      requestLock: () => {
        reportStartup('single-instance-lock-attempt');
        const acquired = app.requestSingleInstanceLock();
        reportStartup('single-instance-lock', `acquired=${acquired} argv=${JSON.stringify(process.argv)}`);
        return acquired;
      },
      onSecondInstance: (listener) => {
        app.on('second-instance', (_event, argv) => {
          reportStartup('second-instance-received', `argv=${JSON.stringify(argv)}`);
          listener(argv);
        });
      },
      bootstrap: async () => {
        reportStartup('primary-bootstrap');
        await import('./media-tool-env');
        const { startPrimaryApplication } = await import('./main');
        return startPrimaryApplication(process.argv);
      },
      exit: terminateProcess,
      onFatal: (error) => {
        log.error('Failed to start KNOUX Player X', error);
        terminateProcess(1);
      },
    });
  }).catch(failStartup);
} catch (error: unknown) {
  failStartup(error);
}
