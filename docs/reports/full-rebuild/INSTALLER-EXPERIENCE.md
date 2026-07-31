# KNOUX Installer Experience

Updated: 2026-07-31

## Decision

The Windows release continues to use Electron Forge's Squirrel maker. Squirrel does not provide a stable custom slideshow surface tied to real install progress, so the nine official screens are implemented with **fallback option C**: a first-run setup tour shown after installation when KNOUX Player X launches.

The project does not claim that these screens appear while Squirrel copies files.

## First-run behavior

- All nine PNG files are bundled locally and never fetched from the web.
- Exactly one image is visible at a time.
- Images use `object-fit: contain` on a coordinated dark background without stretching.
- The tour includes an accurate slide counter, deterministic progress, Back, Next, Skip, and Finish actions.
- English and Arabic copy and RTL-aware arrow-key navigation are included.
- `prefers-reduced-motion` removes the image and progress animations.
- Completion is stored locally; Settings > About can reopen the tour.
- The final screen identifies the product and developer without opening an external link.

## Asset integrity

`tools/validate-brand-assets.cjs` validates the PNG signature, dimensions, alpha channel, source SHA-256, duplicate hashes, and the committed manifest at `assets/branding/asset-manifest.json`.

The Windows workflow runs `npm run brand:verify` before native-module rebuild, packaging, or installer creation. Vite and Electron Forge bundle the source PNG bytes without recompression.

## Release evidence still required

- A green Windows package/runtime workflow at the final branch head.
- Successful packaged Open With and single-instance handling.
- Artifact upload with executable, installer, FFmpeg, and FFprobe hashes.
- Manual clean-install, upgrade/data-retention, uninstall, and high-DPI checks on Windows 10 and Windows 11.

