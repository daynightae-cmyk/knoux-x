/**
 * KNOUX-X — WINDOW STATE PERSISTENCE (directive §5)
 *
 * Restores the last size/position/maximized state, but only when the saved
 * rectangle still intersects a connected display. State lives under userData
 * and is written atomically; a corrupt file falls back to defaults instead of
 * blocking startup.
 */
import fs from 'node:fs';
import path from 'node:path';

import { app, screen, type BrowserWindow, type Rectangle } from 'electron';

interface WindowStateFile {
  bounds?: Rectangle;
  maximized?: boolean;
}

const STATE_FILE = 'window-state.json';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_VISIBLE_PIXELS = 120;

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function isValidRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Rectangle;
  return [rect.x, rect.y, rect.width, rect.height].every((part) => Number.isInteger(part))
    && rect.width >= 800 && rect.height >= 600
    && rect.width <= 10000 && rect.height <= 10000;
}

function intersectsDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX >= MIN_VISIBLE_PIXELS && overlapY >= MIN_VISIBLE_PIXELS;
  });
}

export interface RestoredWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export function loadWindowState(): RestoredWindowState {
  const fallback: RestoredWindowState = {
    bounds: { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    maximized: false,
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as WindowStateFile;
    if (!isValidRectangle(parsed.bounds) || !intersectsDisplay(parsed.bounds)) return fallback;
    return { bounds: parsed.bounds, maximized: parsed.maximized === true };
  } catch {
    return fallback;
  }
}

export function saveWindowState(window: BrowserWindow): void {
  if (!window || window.isDestroyed()) return;
  const payload: WindowStateFile = {
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    maximized: window.isMaximized(),
  };
  try {
    const destination = statePath();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tmp = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, destination);
  } catch {
    /* Window state is a convenience; never block or crash on save failure. */
  }
}

export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; saveWindowState(window); }, 500);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    saveWindowState(window);
  });
}
