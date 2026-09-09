const resolved = require.resolve('@derhuerst/ffprobe-static');
const loaded = require(resolved);

if (typeof loaded === 'string') {
  require.cache[resolved].exports = { path: loaded };
} else if (!loaded || typeof loaded !== 'object' || typeof loaded.path !== 'string') {
  throw new Error('@derhuerst/ffprobe-static did not expose a usable binary path.');
}

require('./run-packaged-timeline-export-e2e.cjs');
