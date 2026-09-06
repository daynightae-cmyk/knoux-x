/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Main Entry
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
import { SystemOverlay } from './components/system/SystemOverlay';
import { AndroidBeautyExtension } from './platform/AndroidBeautyExtension';
import { installAndroidAudioToolsBridge } from './platform/androidAudioToolsBridge';
import { installAndroidCaptureBridge } from './platform/androidCaptureBridge';
import { installAndroidFileBridge } from './platform/androidFileBridge';
import { installAndroidImageEditorBridge } from './platform/androidImageEditorBridge';
import { installAndroidRetouchModels } from './platform/androidRetouchModels';
import { installAndroidRuntimeBridge } from './platform/androidRuntimeBridge';
import { installAndroidSafBridge } from './platform/androidSafBridge';
import { installBrowserPreviewBridge } from './platform/browserPreviewBridge';

// Capacitor Android receives dedicated native-safe bridges. Desktop preload
// remains authoritative in Electron, and normal browsers keep the constrained
// preview adapter. Runtime ownership is established first, then Android-specific
// adapters decorate that contract without overwriting Electron desktop preload.
const androidRuntimeInstalled = installAndroidRuntimeBridge();
if (androidRuntimeInstalled) {
  document.documentElement.dataset.platform = 'android';
  document.title = 'KNOUX X';
  // Keep the virtual bridge as a compatibility fallback for transient browser
  // assets, then let SAF own user-selected documents so content:// permissions
  // survive activity/process restarts.
  installAndroidFileBridge();
  installAndroidSafBridge();
  installAndroidCaptureBridge();
  installAndroidAudioToolsBridge();
  installAndroidImageEditorBridge();
  installAndroidRetouchModels();
} else {
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

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <SystemOverlay />
      {androidRuntimeInstalled && <AndroidBeautyExtension />}
    </ErrorBoundary>
  </React.StrictMode>
);
