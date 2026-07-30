/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Main Entry
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * نقطة الدخول الرئيسية لتطبيق React
 * 
 * @module Main
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// ═══════════════════════════════════════════════════════════════════════════
// تهيئة React
// ═══════════════════════════════════════════════════════════════════════════

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
