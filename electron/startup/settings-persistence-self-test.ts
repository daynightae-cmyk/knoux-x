import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { app } from 'electron';

import { SettingsManager } from '../../src/core/services/settings/SettingsManager';
import {
  APPLICATION_SETTINGS_SCHEMA_VERSION,
  DEFAULT_APPLICATION_SETTINGS,
  type ApplicationSettings,
} from '../../src/core/settings/applicationSettings';

interface SettingsSelfTestEvidence {
  product: 'KNOUX Player X';
  success: boolean;
  mode: 'settings-persistence';
  packaged: boolean;
  applicationVersion: string;
  executable: string;
  schemaVersion: number;
  settingsHash: string;
  exportHash: string;
  checks: string[];
  corruptBackups: number;
  temporaryRoot: string;
  temporaryRootRemoved: boolean;
  error?: string;
  completedAt: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} did not survive persistence.`);
}

async function writeEvidence(evidencePath: string, evidence: SettingsSelfTestEvidence): Promise<void> {
  if (!path.isAbsolute(evidencePath) || path.extname(evidencePath).toLowerCase() !== '.json') {
    throw new Error('Settings self-test evidence must be an absolute JSON path.');
  }
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, evidencePath);
}

async function executeSettingsPersistenceScenario(root: string): Promise<SettingsSelfTestEvidence> {
  const storagePath = path.join(root, 'settings', 'application-settings.json');
  const customized: Pick<ApplicationSettings,
    'language' | 'theme' | 'defaultVolume' | 'brightness' | 'contrast'
    | 'recordingToolbar' | 'quickAccessToolbar' | 'shortcuts' | 'workspace' | 'recordingConfiguration'> = {
      language: 'ar',
      theme: 'obsidian-violet',
      defaultVolume: 0.37,
      brightness: 118,
      contrast: 91,
      recordingToolbar: {
        order: ['stop', 'start', 'pause', 'resume', 'cancel', 'screenshot', 'select-region', 'microphone', 'system-audio', 'camera-overlay', 'countdown', 'marker', 'open-output'],
        hidden: ['camera-overlay', 'marker'],
        visible: true,
        mode: 'floating',
        size: 'large',
        location: 'floating',
        position: { x: 360, y: 180 },
        alwaysOnTop: true,
        hideFromCapture: true,
      },
      quickAccessToolbar: {
        ...structuredClone(DEFAULT_APPLICATION_SETTINGS.quickAccessToolbar),
        mode: 'floating',
        location: 'floating',
        size: 'large',
        position: { x: 420, y: 96 },
        hidden: ['export'],
        workspaceCommands: { production: ['record-start-stop', 'record-pause-resume', 'screenshot'] },
      },
      shortcuts: DEFAULT_APPLICATION_SETTINGS.shortcuts.map((binding) => binding.command === 'open-file'
        ? { ...binding, accelerator: 'Ctrl+Alt+KeyO' }
        : binding.command === 'theater-mode' ? { ...binding, enabled: false } : binding),
      workspace: {
        ...structuredClone(DEFAULT_APPLICATION_SETTINGS.workspace),
        moduleOrder: ['player', 'recording', 'capture', 'editor', 'library', 'queue', 'image-editor', 'slideshow', 'audio-tools', 'export', 'settings'],
        hiddenModules: ['queue'],
        sidebarWidth: 348,
        timelineHeight: 436,
        panelSizes: { inspector: 384, mediaBin: 310, preview: 640 },
        collapsedSections: ['recording-advanced'],
        selectedWorkspace: 'production',
        lastOpenedSection: 'recording',
      },
      recordingConfiguration: {
        sourceId: 'screen:1',
        captureMode: 'player',
        resolution: '1080p',
        frameRate: 60,
        videoBitrate: 'quality',
        audioBitrate: 256,
        microphone: true,
        systemAudio: true,
        cameraOverlay: true,
        countdown: 5,
        outputFolder: 'C:\\KNOUX-Captures',
        filenameTemplate: 'KNOUX-{source}-{date}-{time}',
        webmCodec: 'vp9',
      },
    };
  const checks: string[] = [];

  const firstRun = new SettingsManager(storagePath);
  await firstRun.initialize();
  for (const [key, value] of Object.entries(customized)) await firstRun.set(key, value);
  await firstRun.shutdown();
  checks.push('atomic-save');

  const reopened = new SettingsManager(storagePath);
  await reopened.initialize();
  for (const [key, expected] of Object.entries(customized)) {
    assertDeepEqual(await reopened.get(key), expected, key);
  }
  checks.push('restart-restore');

  const exported = await reopened.export();
  await reopened.reset();
  assertDeepEqual(await reopened.getAll().then(({ volume: _volume, ...settings }) => settings), DEFAULT_APPLICATION_SETTINGS, 'reset');
  checks.push('reset-defaults');
  await reopened.import(exported);
  for (const [key, expected] of Object.entries(customized)) {
    assertDeepEqual(await reopened.get(key), expected, `${key} import`);
  }
  await reopened.shutdown();
  checks.push('import-export-round-trip');

  await fs.writeFile(storagePath, '{corrupt-json', 'utf8');
  const recovered = new SettingsManager(storagePath);
  await recovered.initialize();
  for (const [key, expected] of Object.entries(customized)) {
    assertDeepEqual(await recovered.get(key), expected, `${key} backup recovery`);
  }
  await recovered.shutdown();
  const corruptBackups = (await fs.readdir(path.dirname(storagePath))).filter((name) => name.includes('.corrupt-')).length;
  if (corruptBackups !== 1) throw new Error('Corrupt settings were not quarantined exactly once.');
  checks.push('corrupt-settings-backup-recovery');

  const temporaryFiles = (await fs.readdir(path.dirname(storagePath))).filter((name) => name.endsWith('.tmp'));
  if (temporaryFiles.length !== 0) throw new Error('Atomic settings writes left temporary files behind.');
  checks.push('no-temporary-files');

  const persisted = await fs.readFile(storagePath, 'utf8');
  return {
    product: 'KNOUX Player X',
    success: true,
    mode: 'settings-persistence',
    packaged: app.isPackaged,
    applicationVersion: app.getVersion(),
    executable: app.getPath('exe'),
    schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION,
    settingsHash: digest(persisted),
    exportHash: digest(exported),
    checks,
    corruptBackups,
    temporaryRoot: root,
    temporaryRootRemoved: false,
    completedAt: new Date().toISOString(),
  };
}

export async function runSettingsPersistenceSelfTest(evidencePath: string): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-settings-persistence-'));
  let evidence: SettingsSelfTestEvidence;
  let scenarioError: unknown;
  let cleanupError: unknown;
  try {
    evidence = await executeSettingsPersistenceScenario(root);
  } catch (error) {
    scenarioError = error;
    evidence = {
      product: 'KNOUX Player X',
      success: false,
      mode: 'settings-persistence',
      packaged: app.isPackaged,
      applicationVersion: app.getVersion(),
      executable: app.getPath('exe'),
      schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION,
      settingsHash: '',
      exportHash: '',
      checks: [],
      corruptBackups: 0,
      temporaryRoot: root,
      temporaryRootRemoved: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      completedAt: new Date().toISOString(),
    };
  } finally {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
    }
  }
  evidence.temporaryRootRemoved = cleanupError === undefined;
  if (cleanupError !== undefined) evidence.error = `${evidence.error ? `${evidence.error}; ` : ''}cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
  evidence.completedAt = new Date().toISOString();
  await writeEvidence(evidencePath, evidence);
  if (scenarioError) throw scenarioError;
  if (cleanupError) throw cleanupError;
}
