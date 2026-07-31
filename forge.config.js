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

const projectNodeModules = path.resolve(__dirname, 'node_modules');

function packageRoot(packageName, searchPath = __dirname) {
  return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [searchPath] }));
}

function copyRuntimeDependencyTree(packageName, buildPath, copiedRoots = new Set(), searchPath) {
  const source = packageRoot(packageName, searchPath);
  if (copiedRoots.has(source)) return;
  copiedRoots.add(source);

  const relative = path.relative(projectNodeModules, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Runtime dependency ${packageName} resolved outside project node_modules: ${source}`);
  }

  const destination = path.join(buildPath, 'node_modules', relative);
  if (path.resolve(source) !== path.resolve(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true, dereference: true });
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies)) {
    try {
      copyRuntimeDependencyTree(dependency, buildPath, copiedRoots, source);
    } catch (error) {
      if (manifest.optionalDependencies?.[dependency]) continue;
      throw error;
    }
  }
}

function packageNativeRuntime(buildPath, _electronVersion, _platform, _arch, callback) {
  try {
    copyRuntimeDependencyTree('better-sqlite3', buildPath);
    const packagedManifest = path.join(buildPath, 'node_modules', 'better-sqlite3', 'package.json');
    if (!fs.existsSync(packagedManifest)) {
      throw new Error(`better-sqlite3 was not copied into the packaged application: ${packagedManifest}`);
    }
    console.log(`[KNOUX package] Native SQLite runtime copied to ${packagedManifest}`);
    callback();
  } catch (error) {
    callback(error);
  }
}

const icon = path.resolve(__dirname, 'assets/icons/app-icon');
const ffmpeg = optionalBinary('ffmpeg-static');
const ffprobe = optionalBinary('@derhuerst/ffprobe-static');
const bundledBrandAssets = [
  path.resolve(__dirname, 'assets/branding'),
  path.resolve(__dirname, 'assets/installer'),
  path.resolve(__dirname, 'splash.html'),
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
    asar: {
      unpack: '**/*.node',
    },
    name: 'KNOUX Player X',
    executableName: 'knoux-player-x',
    appBundleId: 'dev.knoux.player-x',
    ...(fs.existsSync(`${icon}.ico`) ? { icon } : {}),
    ...(extraResource.length > 0 ? { extraResource } : {}),
    afterPrune: [packageNativeRuntime],
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
