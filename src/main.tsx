/**
 * ═══════════════════════════════════════════════════════════════════════
 * Knoux X™ - Main Entry
 * ═══════════════════════════════════════════════════════════════════════
 *
 * نقطة الدخول الرئيسية لتطبيق React
 *
 * @module Main
 * @author KNOUX Development Team
 * @version 1.1.0
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/system/ErrorBoundary';
import { AndroidOptionalRuntime } from './platform/AndroidOptionalRuntime';
import { installAndroidAudioToolsBridge } from './platform/androidAudioToolsBridge';
import { installAndroidCaptureBridge } from './platform/androidCaptureBridge';
import { installAndroidFileBridge } from './platform/androidFileBridge';
import { installAndroidImageEditorBridge } from './platform/androidImageEditorBridge';
import { installAndroidMultitrackExportBridge } from './platform/androidMultitrackExportBridge';
import { installAndroidRetouchModels } from './platform/androidRetouchModels';
import { installAndroidRuntimeBridge } from './platform/androidRuntimeBridge';
import { installAndroidSafBridge } from './platform/androidSafBridge';
import { installAndroidSlideshowRenderBridge } from './platform/androidSlideshowRenderBridge';
import { installBrowserPreviewBridge } from './platform/browserPreviewBridge';
import './styles/premium-daylight-rebrand.css';

const SystemOverlay = React.lazy(async () => {
  const module = await import('./components/system/SystemOverlay');
  return { default: module.SystemOverlay };
});

// Test-only packaged Windows Retouch E2E: dynamically imported ONLY when the
// renderer boots with `?knouxRetouchE2E=1` (driven by the real packaged app
// under the explicit `--retouch-e2e` main-process flag). Normal boots never
// load it. It exercises the same production retouch modules Video Studio uses.
try {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('knouxRetouchE2E') === '1') {
    void import('./retouch-e2e/packaged-retouch-e2e').then((module) => module.maybeStartPackagedRetouchE2E());
  }
} catch {
  // E2E bootstrap must never break normal product startup.
}

// Capacitor Android receives dedicated native-safe bridges. Desktop preload
// remains authoritative in Electron, and normal browsers keep the constrained
// preview adapter. Runtime ownership is established first, then Android-specific
// adapters decorate that contract without overwriting Electron desktop preload.
const androidRuntimeInstalled = installAndroidRuntimeBridge();
const query = new URLSearchParams(window.location.search);
const androidDiagnosticsEnabled = query.get('knouxDiagnostics') === '1';

if (androidRuntimeInstalled) {
  document.documentElement.dataset.platform = 'android';
  document.documentElement.dataset.runtime = 'android';
  document.title = 'Knoux X';
  // Keep the virtual bridge as a compatibility fallback for transient browser
  // assets, then let SAF own user-selected documents so content:// permissions
  // survive activity/process restarts.
  installAndroidFileBridge();
  installAndroidSafBridge();
  installAndroidCaptureBridge();
  installAndroidAudioToolsBridge();
  installAndroidImageEditorBridge();
  installAndroidRetouchModels();
  installAndroidMultitrackExportBridge();
  installAndroidSlideshowRenderBridge();
} else {
  document.documentElement.dataset.runtime = 'desktop';
  installBrowserPreviewBridge();
}

// ═══════════════════════════════════════════════════════════════════════════
// تهيئة React
// ═══════════════════════════════════════════════════════════════════════════

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('KNOUX root element was not found.');
}

const root = createRoot(rootElement);
const productTree = (
  <ErrorBoundary>
    <App />
    {androidRuntimeInstalled && <AndroidOptionalRuntime />}
    {(!androidRuntimeInstalled || androidDiagnosticsEnabled) && (
      <React.Suspense fallback={null}>
        <SystemOverlay />
      </React.Suspense>
    )}
  </ErrorBoundary>
);

// StrictMode is valuable for desktop development, but its duplicate development
// effects are needless work in the Android WebView debug build used on devices.
root.render(androidRuntimeInstalled ? productTree : <React.StrictMode>{productTree}</React.StrictMode>);
