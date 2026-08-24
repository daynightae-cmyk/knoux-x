const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(process.cwd(), 'tools', 'phase3a-remote-repair.cjs');
let source = fs.readFileSync(scriptPath, 'utf8');
const before = '    assetId: `asset-${id}`,';
const after = "    assetId: 'asset-' + id,";
if (!source.includes(before)) {
  throw new Error('Expected nested template literal was not found in repair runner.');
}
source = source.replace(before, after);
fs.writeFileSync(scriptPath, source, 'utf8');
require(scriptPath);
