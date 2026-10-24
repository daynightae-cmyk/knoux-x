const { randomUUID } = require('node:crypto');

// withSession can restart this case after it has already deleted its QA video.
// Restore only verified fixture bytes, and never reuse a previous addition's name.
function prepareMediaDiscoveryAttempt(adb, expectedSha256, makeId = randomUUID) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Discovery fixture SHA-256 is invalid.');
  const source = '/sdcard/Download/KNOUX-QA.mp4';
  const removed = '/sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4';
  const exists = file => {
    try { adb('shell', 'test', '-e', file); return true; } catch { return false; }
  };
  const hash = file => {
    const value = /^([a-f0-9]{64})\b/i.exec(adb('shell', 'sha256sum', file).trim())?.[1]?.toLowerCase();
    if (!value) throw new Error(`Cannot verify discovery fixture: ${file}`);
    return value;
  };
  if (hash(source) !== expectedSha256) throw new Error('Device discovery source does not match the staged QA fixture.');
  let restored = false;
  if (!exists(removed)) {
    // -n also protects an unexpected file created between the existence check and copy.
    adb('shell', 'cp', '-n', source, removed);
    restored = true;
  }
  if (hash(removed) !== expectedSha256) throw new Error('Discovery destination contains different bytes; refusing to overwrite it.');
  if (restored) adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${removed}`);
  const id = makeId();
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Discovery attempt identifier is invalid.');
  const addedName = `KNOUX-Discovery-New-${id}.mp4`;
  const addedPath = `/sdcard/Movies/KNOUX-Discovery/${addedName}`;
  if (exists(addedPath)) throw new Error('Discovery addition already exists; refusing to reuse previous evidence.');
  return { source, removed, restored, addedName, addedPath, sha256: expectedSha256 };
}

module.exports = { prepareMediaDiscoveryAttempt };
