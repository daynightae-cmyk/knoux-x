const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

function optionalBinary(moduleName) {
  try {
    const loaded = require(moduleName);
    if (typeof loaded === 'string') return loaded;
    if (loaded && typeof loaded.path === 'string') return loaded.path;
  } catch {
    return null;
  }
  return null;
}

const icon = path.resolve(__dirname, 'assets/icons/app-icon');
const ffmpeg = optionalBinary('ffmpeg-static');
const ffprobe = optionalBinary('@derhuerst/ffprobe-static');
const bundledBrandAssets = [
  path.resolve(__dirname, 'assets/branding'),
  path.resolve(__dirname, 'assets/installer'),
];
const extraResource = [ffmpeg, ffprobe, ...bundledBrandAssets].filter(Boolean);
const squirrel = {
  name: 'KNOUX_Player_X',
  authors: 'SADEK ELGAZAR (KNOUX)',
  description: 'KNOUX Player X',
};
if (fs.existsSync(`${icon}.ico`)) squirrel.setupIcon = `${icon}.ico`;

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'KNOUX Player X',
    executableName: 'knoux-player-x',
    appBundleId: 'dev.knoux.player-x',
    ...(fs.existsSync(`${icon}.ico`) ? { icon } : {}),
    ...(extraResource.length > 0 ? { extraResource } : {}),
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: squirrel },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'], config: {} },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'electron/main-entry.ts', config: 'vite.main.config.ts' },
          { entry: 'electron/preload-entry.ts', config: 'vite.preload.config.ts' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
      },
    },
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
