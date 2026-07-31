/* eslint-disable import/order -- startup imports are intentionally kept explicit and minimal before the instance lock. */
import { app } from 'electron';
import log from 'electron-log';

import started from 'electron-squirrel-startup';

import { startSingleInstanceEntry } from './startup/single-instance';

function reportStartup(event: string, detail = ''): void {
  const message = `[knoux-startup] pid=${process.pid} event=${event}${detail ? ` ${detail}` : ''}`;
  process.stderr.write(`${message}\n`);
  log.info(message);
}

function terminateProcess(exitCode: number): never {
  reportStartup('exit', `code=${exitCode}`);
  process.exit(exitCode);
}

startSingleInstanceEntry({
  squirrelStartup: started,
  requestLock: () => {
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
