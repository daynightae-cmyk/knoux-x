/* eslint-disable import/order -- platform resolvers classify these two bundled startup packages differently. */
import log from 'electron-log';
import started from 'electron-squirrel-startup';

export { log, started };
