import React, { useEffect, useState } from 'react';

import {
  DEFAULT_SHORTCUTS,
  normalizeAccelerator,
  validateShortcutBindings,
  type KnouxCommandId,
  type ShortcutBinding,
} from '../../core/settings/productCustomization';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';

function eventAccelerator(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(event.code === 'Space' ? 'Space' : event.code);
  return normalizeAccelerator(parts.join('+'));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export const CommandShortcutController: React.FC = () => {
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>(DEFAULT_SHORTCUTS);
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const value = await window.knouxAPI.settings.get('shortcuts', DEFAULT_SHORTCUTS);
        if (active) setShortcuts(validateShortcutBindings(value));
      } catch {
        if (active) setShortcuts(structuredClone(DEFAULT_SHORTCUTS));
      }
    };
    void load();
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key !== 'shortcuts') return;
      try { setShortcuts(validateShortcutBindings(value)); } catch { /* invalid settings never replace active bindings */ }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const dispatchCommand = (command: KnouxCommandId): void => {
      window.dispatchEvent(new CustomEvent('knoux:command', { detail: { command } }));
    };

    const execute = async (command: KnouxCommandId): Promise<void> => {
      const player = usePlayerStore.getState();
      switch (command) {
        case 'play-pause': player.isPlaying ? player.pause() : player.play(); return;
        case 'stop': player.stop(); return;
        case 'seek-backward': player.seek(player.currentTime - 5); return;
        case 'seek-forward': player.seek(player.currentTime + 5); return;
        case 'frame-step-backward': player.seek(player.currentTime - (1 / 30)); return;
        case 'frame-step-forward': player.seek(player.currentTime + (1 / 30)); return;
        case 'mute': player.toggleMute(); return;
        case 'volume-up': player.setVolume(player.volume + 0.05); return;
        case 'volume-down': player.setVolume(player.volume - 0.05); return;
        case 'fullscreen': await window.knouxAPI.window.setFullscreen(!(await window.knouxAPI.window.isFullscreen())); return;
        case 'open-file': {
          const selected = await window.knouxCreativeAPI.media.open();
          if (selected) {
            const probe = await window.knouxCreativeAPI.export.probe(selected.filePath);
            if (!probe.streams?.some((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
              throw new Error('The selected file contains no playable audio or video stream.');
            }
            player.setCurrentMedia(selected.filePath);
            setView('player');
          }
          return;
        }
        case 'record-start-stop':
        case 'record-pause-resume':
          setView('recording');
          window.setTimeout(() => dispatchCommand(command), 0);
          return;
        case 'region-capture':
          setView('capture');
          window.setTimeout(() => dispatchCommand(command), 0);
          return;
        case 'split-clip':
        case 'trim-in':
        case 'trim-out':
        case 'undo':
        case 'redo':
        case 'save':
          setView('editor');
          window.setTimeout(() => dispatchCommand(command), 0);
          return;
        case 'export': setView('export'); return;
        default: break;
      }
      dispatchCommand(command);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.repeat) return;
      const accelerator = eventAccelerator(event);
      const binding = shortcuts.find((entry) => entry.enabled && normalizeAccelerator(entry.accelerator) === accelerator);
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      void execute(binding.command).catch((reason) => addNotification({
        type: 'error',
        title: 'Command failed',
        message: reason instanceof Error ? reason.message : 'The requested command could not be completed.',
      }));
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [addNotification, setView, shortcuts]);

  return null;
};
