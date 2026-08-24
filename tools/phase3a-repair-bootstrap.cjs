const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(process.cwd(), 'tools', 'phase3a-remote-repair.cjs');
let source = fs.readFileSync(scriptPath, 'utf8');

const nestedTemplateBefore = '    assetId: `asset-${id}`,';
const nestedTemplateAfter = "    assetId: 'asset-' + id,";
if (!source.includes(nestedTemplateBefore)) {
  throw new Error('Expected nested template literal was not found in repair runner.');
}
source = source.replace(nestedTemplateBefore, nestedTemplateAfter);

const importPatchBefore = `  "import { useImageStudioStore } from '../store/imageStudioStore';\\n",\n  "import { useImageStudioStore } from '../store/imageStudioStore';\\nimport {\\n  clientPointToCanvasDocument,\\n  findTopmostVisibleLayerAtPoint,\\n  isStrokeRetouchType,\\n} from './imageStudioCanvasInteraction';\\n",`;
const importPatchAfter = `  "import { applyRetouchToBuffer } from '../retouch/retouchPreviewBridge';\\n",\n  "import { applyRetouchToBuffer } from '../retouch/retouchPreviewBridge';\\n\\nimport {\\n  clientPointToCanvasDocument,\\n  findTopmostVisibleLayerAtPoint,\\n  isStrokeRetouchType,\\n} from './imageStudioCanvasInteraction';\\n",`;
if (!source.includes(importPatchBefore)) {
  throw new Error('Expected Canvas import insertion block was not found in repair runner.');
}
source = source.replace(importPatchBefore, importPatchAfter);

fs.writeFileSync(scriptPath, source, 'utf8');
require(scriptPath);
