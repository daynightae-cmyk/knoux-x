const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function validateRepair(relativePath, forbidden, required = []) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(`Pending historical source repair remains in ${relativePath}. Commit the intended source before running quality gates.`);
    }
  }
  for (const token of required) {
    if (!source.includes(token)) throw new Error(`Expected repaired source was not found in ${relativePath}: ${token}`);
  }
  console.log(`[PASS] ${relativePath} historical repair is committed.`);
}

validateRepair(
  'src/features/editor/MultitrackEditorView.tsx',
  ["  const selectedTrack = useMemo(() => project?.tracks.find((track) => track.id === selectedTrackId) ?? null, [project, selectedTrackId]);\n"],
);

validateRepair(
  'src/features/editor/MultitrackEditorView.tsx',
  ["      const actualKind: 'video' | 'audio' | 'image' = imageExtensions.has(extension)\n        ? 'image'\n        : targetKind;\n"],
  [
    'const probe = await window.knouxCreativeAPI.export.probe(selected.filePath);',
    "stream.codec_type === 'video'",
    "stream.codec_type === 'audio'",
  ],
);

validateRepair(
  'src/features/editor/MultitrackEditorView.tsx',
  ['<video ref={(node) => { previewRef.current = node; }} src={previewUrl} muted={selectedItem.kind === \'image\'}'],
  ['<img src={previewUrl} alt={selectedItem.name} />'],
);

validateRepair(
  'src/core/creative/multitrackProject.ts',
  ['  if (position <= sorted[0].time) return sorted[0].value;\n'],
  ['return fallback + (first.value - fallback) * progress;'],
);

validateRepair(
  'src/core/creative/multitrackProject.ts',
  ['  return normalizeTrackOrder(normalized);\n'],
  ['return normalized.map((track, order) => ({ ...track, order }));'],
);

validateRepair(
  'electron/ipc/slideshow-runtime.ts',
  ["import { authorizedMediaPaths } from '../security/path-registry';\n\nimport { SlideshowProjectService"],
  [
    "import { SlideshowProjectService } from '../creative/slideshow-project-service';\nimport { SlideshowRenderService } from '../creative/slideshow-render-service';\nimport { SlideshowAssetService",
    "import { authorizedMediaPaths } from '../security/path-registry';",
  ],
);

validateRepair(
  'src/features/slideshow/SlideshowView.tsx',
  ['  }, [duration, previewPlaying]);\n'],
  ['  }, [duration, previewPlaying, previewTime];'],
);

validateRepair(
  'src/features/audio-tools/AudioToolsView.tsx',
  ['orient="vertical"'],
  ['type="range" min="-20" max="20" step="0.5"'],
);

validateRepair(
  'electron/creative/audio-tools-service.ts',
  ["import { app, dialog, powerSaveBlocker } from 'electron';"],
  ["import { dialog, powerSaveBlocker } from 'electron';"],
);

validateRepair(
  'src/features/settings/SettingsView.tsx',
  ['<Globe2'],
  ['<MonitorCog', "updateSetting('brightness', Number(event.target.value))", "updateSetting('contrast', Number(event.target.value))"],
);

console.log('[PASS] No pending professional suite source repairs.');