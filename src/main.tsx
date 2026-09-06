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
import { installAndroidRuntimeBridge } from './platform/androidRuntimeBridge';
import { installBrowserPreviewBridge } from './platform/browserPreviewBridge';

// Capacitor Android receives a dedicated native-safe bridge. Desktop preload
// remains authoritative in Electron, and normal browsers keep the constrained
// preview adapter. This ordering prevents Android from being misidentified as
// a Windows desktop runtime or an incomplete web preview.
const androidRuntimeInstalled = installAndroidRuntimeBridge();
if (!androidRuntimeInstalled) installBrowserPreviewBridge();

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
    </ErrorBoundary>
  </React.StrictMode>
);
