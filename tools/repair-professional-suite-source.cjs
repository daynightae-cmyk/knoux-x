const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function replaceExact(relativePath, before, after) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  if (!source.includes(before)) {
    if (source.includes(after)) {
      console.log(`[SKIP] ${relativePath} already repaired.`);
      return false;
    }
    throw new Error(`Expected repair target was not found in ${relativePath}.`);
  }
  fs.writeFileSync(filePath, source.replace(before, after), 'utf8');
  console.log(`[FIX] ${relativePath}`);
  return true;
}

let changed = false;

changed = replaceExact(
  'src/features/editor/MultitrackEditorView.tsx',
  "  const selectedTrack = useMemo(() => project?.tracks.find((track) => track.id === selectedTrackId) ?? null, [project, selectedTrackId]);\n",
  '',
) || changed;

changed = replaceExact(
  'src/features/editor/MultitrackEditorView.tsx',
  "      const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);\n      const actualKind: 'video' | 'audio' | 'image' = imageExtensions.has(extension)\n        ? 'image'\n        : targetKind;\n",
  "      const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);\n      const audioExtensions = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']);\n      const actualKind: 'video' | 'audio' | 'image' = imageExtensions.has(extension)\n        ? 'image'\n        : audioExtensions.has(extension) ? 'audio' : 'video';\n",
) || changed;

changed = replaceExact(
  'src/features/editor/MultitrackEditorView.tsx',
  "              selectedItem.kind === 'audio' ? (\n                <div className=\"multitrack-audio-preview\"><AudioLines size={58} /><strong>{selectedItem.name}</strong><audio ref={(node) => { previewRef.current = node; }} src={previewUrl} onEnded={() => setPreviewPlaying(false)} /></div>\n              ) : (\n                <video ref={(node) => { previewRef.current = node; }} src={previewUrl} muted={selectedItem.kind === 'image'} onEnded={() => setPreviewPlaying(false)} />\n              )\n",
  "              selectedItem.kind === 'audio' ? (\n                <div className=\"multitrack-audio-preview\"><AudioLines size={58} /><strong>{selectedItem.name}</strong><audio ref={(node) => { previewRef.current = node; }} src={previewUrl} onEnded={() => setPreviewPlaying(false)} /></div>\n              ) : selectedItem.kind === 'image' ? (\n                <img src={previewUrl} alt={selectedItem.name} />\n              ) : (\n                <video ref={(node) => { previewRef.current = node; }} src={previewUrl} onEnded={() => setPreviewPlaying(false)} />\n              )\n",
) || changed;

changed = replaceExact(
  'src/core/creative/multitrackProject.ts',
  "  if (sorted.length === 0) return fallback;\n  if (position <= sorted[0].time) return sorted[0].value;\n  if (position >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;\n",
  "  if (sorted.length === 0) return fallback;\n  if (position <= sorted[0].time) {\n    const first = sorted[0];\n    if (first.time <= 0) return first.value;\n    const progress = easingProgress(position / first.time, first.easing);\n    return fallback + (first.value - fallback) * progress;\n  }\n  if (position >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;\n",
) || changed;

changed = replaceExact(
  'src/core/creative/multitrackProject.ts',
  "  const [selected] = normalized.splice(index, 1);\n  normalized.splice(destination, 0, selected);\n  return normalizeTrackOrder(normalized);\n",
  "  const [selected] = normalized.splice(index, 1);\n  normalized.splice(destination, 0, selected);\n  return normalized.map((track, order) => ({ ...track, order }));\n",
) || changed;

changed = replaceExact(
  'electron/ipc/slideshow-runtime.ts',
  "import { authorizedMediaPaths } from '../security/path-registry';\n\nimport { SlideshowProjectService } from '../creative/slideshow-project-service';\nimport { SlideshowRenderService } from '../creative/slideshow-render-service';\n",
  "import { SlideshowProjectService } from '../creative/slideshow-project-service';\nimport { SlideshowRenderService } from '../creative/slideshow-render-service';\nimport { authorizedMediaPaths } from '../security/path-registry';\n",
) || changed;

changed = replaceExact(
  'src/features/slideshow/SlideshowView.tsx',
  "  }, [duration, previewPlaying]);\n",
  "  }, [duration, previewPlaying, previewTime]);\n",
) || changed;

changed = replaceExact(
  'src/features/audio-tools/AudioToolsView.tsx',
  '<input type="range" orient="vertical" min="-20" max="20" step="0.5"',
  '<input type="range" min="-20" max="20" step="0.5"',
) || changed;

changed = replaceExact(
  'electron/creative/audio-tools-service.ts',
  "import { app, dialog, powerSaveBlocker } from 'electron';\n",
  "import { dialog, powerSaveBlocker } from 'electron';\n",
) || changed;

console.log(changed ? '[PASS] Professional suite source repairs applied.' : '[PASS] No pending professional suite source repairs.');
