import { Menu } from 'electron';

export function createApplicationMenu(): void {
  // Phase 4: Remove visible File / View / Help native chrome.
  // Commands preserved in KNOUX in-app surfaces (mobile drawer, keyboard shortcuts, command bus).
  Menu.setApplicationMenu(null);
}
