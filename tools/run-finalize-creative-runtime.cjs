const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const target = path.join(root, 'tools/finalize-creative-runtime.cjs');
let source = fs.readFileSync(target, 'utf8');

source = source.replace(
  "detail: `Version ${app.getVersion()}\\nA Knoux Product\\nCrafted by Eng. Sadek Elgazar (Knoux)`,",
  "detail: 'Version ' + app.getVersion() + '\\nA Knoux Product\\nCrafted by Eng. Sadek Elgazar (Knoux)',",
);
source = source.replace(
  "tray?.setToolTip(`KNOUX Player X — ${text}`);",
  "tray?.setToolTip('KNOUX Player X — ' + text);",
);

fs.writeFileSync(target, source, 'utf8');
require(target);

const wrapper = path.join(root, 'tools/run-finalize-creative-runtime.cjs');
if (fs.existsSync(wrapper)) fs.unlinkSync(wrapper);
