import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string): string => fs.readFileSync(path.resolve(relative), 'utf8');

test('the renderer never keeps the vault PIN or the session token in storage', () => {
  const bridge = read('src/platform/androidVault.ts');
  expect(bridge).not.toContain('localStorage');
  expect(bridge).not.toContain('sessionStorage');
  expect(bridge).not.toContain('setItem');
  expect(bridge).toContain('setVaultSessionToken');
  expect(bridge).toContain('forgetVaultSession');
  expect(bridge).toContain('watchVaultAutoLock');
});

test('the vault view never writes a PIN to storage either', () => {
  const view = read('src/features/vault/MobileVaultView.tsx');
  expect(view).not.toContain('localStorage');
  expect(view).not.toContain('sessionStorage');
  expect(view).toContain('vaultCreate({ pin }');
  expect(view).toContain('vaultUnlock({ pin }');
});

test('the vault keeps the original until the user confirms the deletion', () => {
  const view = read('src/features/vault/MobileVaultView.tsx');
  // The import never touches the original.
  expect(view).not.toMatch(/vaultImport[\s\S]{0,400}deleteFile/);
  // The original deletion is a separate, explicit confirmation.
  expect(view).toContain('confirmDeleteOriginal');
  expect(view).toContain('Delete the original');
  expect(view).toContain('Keep the original');
  expect(view).toContain('The encrypted copy is verified');
});

test('a vault operation that needs the system picker holds the session open', () => {
  const view = read('src/features/vault/MobileVaultView.tsx');
  const bridge = read('src/platform/androidVault.ts');
  // The picker pauses the app, so the session has to be held for the import
  // and the export, and the hold has to be released again.
  expect(view).toContain('holdVaultSession()');
  expect(view).toContain('releaseVaultSession()');
  expect(bridge).toContain('vaultHold');
  expect(bridge).toContain('isVaultSessionHeld');
});

test('the vault reports the real key protection level and index state', () => {
  const view = read('src/features/vault/MobileVaultView.tsx');
  const bridge = read('src/platform/androidVault.ts');
  // The device decides the level; the UI never claims hardware backing itself.
  expect(bridge).toContain('keySecurityLevel');
  expect(bridge).toContain('indexState');
  expect(view).toContain('keySecurityLevel');
  expect(view).toContain("'trusted-environment'");
  expect(view).toContain('software');
  expect(view).not.toContain('hardware-backed');
});

test('the vault reports retained encrypted files and decrypted cache copies', () => {
  const view = read('src/features/vault/MobileVaultView.tsx');
  const bridge = read('src/platform/androidVault.ts');
  expect(bridge).toContain('filesRetained');
  expect(bridge).toContain('cachedPlaintextRetained');
  expect(view).toContain('filesRetained');
  expect(view).toContain('cachedPlaintextRetained');
});

test('the vault is reachable from the navigation and the router', () => {
  const drawer = read('src/components/mobile/MobileGlassDrawer.tsx');
  const app = read('src/App.tsx');
  const store = read('src/store/appStore.ts');
  expect(drawer).toContain("view: 'vault'");
  expect(app).toContain("case 'vault'");
  expect(store).toContain("| 'vault'");
});
