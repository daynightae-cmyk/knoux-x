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
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [searchPath] }));
  } catch (manifestError) {
    try {
      let current = path.dirname(require.resolve(packageName, { paths: [searchPath] }));
      while (current !== path.dirname(current)) {
        const manifestPath = path.join(current, 'package.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest.name === packageName) return current;
        }
        current = path.dirname(current);
      }
    } catch {
      // Preserve the original, more precise resolution error below.
    }
    throw manifestError;
  }
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

function copyInstalledScope(scopeName, buildPath) {
  const source = path.join(projectNodeModules, scopeName);
  if (!fs.existsSync(source)) return [];
  const destination = path.join(buildPath, 'node_modules', scopeName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true, dereference: true });
  return fs.readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function requirePackagedManifest(buildPath, packageName) {
  const manifestPath = path.join(buildPath, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${packageName} was not copied into the packaged application: ${manifestPath}`);
  }
  return manifestPath;
}

function listRuntimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...listRuntimeFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function packageNativeRuntime(buildPath, _electronVersion, platform, arch, callback) {
  try {
    const copiedRoots = new Set();
    copyRuntimeDependencyTree('better-sqlite3', buildPath, copiedRoots);
    copyRuntimeDependencyTree('sharp', buildPath, copiedRoots);
    const installedImagePackages = copyInstalledScope('@img', buildPath)
      .filter((name) => name.startsWith('sharp-'));

    const sqliteManifest = requirePackagedManifest(buildPath, 'better-sqlite3');
    const sharpManifest = requirePackagedManifest(buildPath, 'sharp');
    const sharpPlatformRoot = path.join(buildPath, 'node_modules', '@img');
    const expectedRuntime = platform === 'win32' ? `sharp-win32-${arch}` : null;
    const windowsRuntime = expectedRuntime && installedImagePackages.includes(expectedRuntime)
      ? expectedRuntime
      : null;
    if (!windowsRuntime) {
      throw new Error(`Sharp Windows ${arch} runtime package is missing from ${sharpPlatformRoot}: ${installedImagePackages.join(', ') || 'none'}`);
    }

    const windowsRuntimeRoot = path.join(sharpPlatformRoot, windowsRuntime);
    const runtimeFiles = listRuntimeFiles(windowsRuntimeRoot);
    const nativeBinaries = runtimeFiles.filter((filePath) => filePath.endsWith('.node'));
    const runtimeLibraries = runtimeFiles.filter((filePath) => filePath.toLowerCase().endsWith('.dll'));
    if (nativeBinaries.length === 0) {
      throw new Error(`Sharp Windows native binary is missing from ${windowsRuntimeRoot}`);
    }

    console.log(`[KNOUX package] Native SQLite runtime copied to ${sqliteManifest}`);
    console.log(`[KNOUX package] Sharp runtime copied to ${sharpManifest}`);
    console.log(`[KNOUX package] Sharp platform packages: ${installedImagePackages.join(', ')}`);
    console.log(`[KNOUX package] Sharp native binaries: ${nativeBinaries.map((filePath) => path.basename(filePath)).join(', ')}`);
    console.log(`[KNOUX package] Sharp runtime libraries: ${runtimeLibraries.map((filePath) => path.basename(filePath)).join(', ') || 'embedded'}`);
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
      unpack: '**/*.{node,dll}',
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
