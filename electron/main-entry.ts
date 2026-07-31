/* eslint-disable import/order -- startup imports are intentionally kept explicit and minimal before the instance lock. */
import { app } from 'electron';
import log from 'electron-log';

import started from 'electron-squirrel-startup';

import { startSingleInstanceEntry } from './startup/single-instance';

function terminateProcess(exitCode: number): never {
  app.exit(exitCode);
  process.exit(exitCode);
}

startSingleInstanceEntry({
  squirrelStartup: started,
  requestLock: () => app.requestSingleInstanceLock(),
  onSecondInstance: (listener) => {
    app.on('second-instance', (_event, argv) => listener(argv));
  },
  bootstrap: async () => {
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
