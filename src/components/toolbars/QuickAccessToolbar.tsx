import { useEffect, useMemo, useState } from 'react';
import { Camera, Circle, FolderOpen, Library, Play, Share2 } from 'lucide-react';

import {
  DEFAULT_QUICK_ACCESS_TOOLBAR,
  type KnouxCommandId,
  type QuickAccessToolbarSettings,
  type WorkspaceSettings,
} from '../../core/settings/applicationSettings';
import { useAppStore } from '../../store/appStore';
import { NeonButton } from '../neon/NeonButton';

const labels: Partial<Record<KnouxCommandId, string>> = {
  'open-file': 'Open',
  'open-library-folder': 'Add Library',
  'play-pause': 'Play / Pause',
  screenshot: 'Screenshot',
  'region-capture': 'Region',
  'record-start-stop': 'Record',
  export: 'Export',
};

function icon(command: KnouxCommandId): React.ReactNode {
  switch (command) {
    case 'open-file': return <FolderOpen size={15} />;
    case 'open-library-folder': return <Library size={15} />;
    case 'play-pause': return <Play size={15} />;
    case 'screenshot':
    case 'region-capture': return <Camera size={15} />;
    case 'record-start-stop': return <Circle size={15} />;
    default: return <Share2 size={15} />;
  }
}

export const QuickAccessToolbar: React.FC = () => {
  const currentView = useAppStore((state) => state.currentView);
  const [settings, setSettings] = useState<QuickAccessToolbarSettings>(structuredClone(DEFAULT_QUICK_ACCESS_TOOLBAR));
  const [workspaceId, setWorkspaceId] = useState('player');

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.knouxAPI.settings.get('quickAccessToolbar', DEFAULT_QUICK_ACCESS_TOOLBAR),
      window.knouxAPI.settings.get('workspace'),
    ]).then(([toolbar, workspace]) => {
      if (!active) return;
      setSettings(toolbar as QuickAccessToolbarSettings);
      setWorkspaceId((workspace as WorkspaceSettings).selectedWorkspace);
    });
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key === 'quickAccessToolbar') setSettings(value as QuickAccessToolbarSettings);
      if (key === 'workspace') setWorkspaceId((value as WorkspaceSettings).selectedWorkspace);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const commands = useMemo(() => {
    const selected = settings.workspaceCommands[workspaceId] ?? settings.order;
    return selected.filter((command) => !settings.hidden.includes(command));
  }, [settings.hidden, settings.order, settings.workspaceCommands, workspaceId]);

  const move = async (command: KnouxCommandId, direction: -1 | 1): Promise<void> => {
    const index = settings.order.indexOf(command);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= settings.order.length) return;
    const order = [...settings.order];
    [order[index], order[destination]] = [order[destination], order[index]];
    await window.knouxAPI.settings.set('quickAccessToolbar', { ...settings, order });
  };

  if (!settings.visible) return null;
  const floating = settings.location === 'floating' || settings.mode === 'floating';
  return (
    <nav
      className={`quick-access-toolbar mode-${settings.mode} size-${settings.size} location-${settings.location}`}
      data-component="QuickAccessToolbar"
      data-sprint02-surface={currentView === 'capture' ? 'Captures' : currentView === 'recording' ? 'Recorder' : undefined}
      aria-label="Quick Access Toolbar"
      style={floating ? { left: settings.position.x, top: settings.position.y } : undefined}
    >
      {commands.map((command) => (
        <NeonButton
          key={command}
          size="sm"
          variant="ghost"
          leftIcon={icon(command)}
          data-action-id={`quick-access.${command}`}
          data-command-id={command}
          data-expected-effect={`Dispatch ${command} through the shared command controller.`}
          aria-label={labels[command] ?? command}
          title={`${labels[command] ?? command} · Alt+Arrow reorders`}
          onClick={() => window.dispatchEvent(new CustomEvent('knoux:execute-command', { detail: { command, source: 'quick-access' } }))}
          onKeyDown={(event) => {
            if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const logical = document.documentElement.dir === 'rtl' ? -1 : 1;
            const direction: -1 | 1 = event.key === 'ArrowLeft'
              ? (logical === 1 ? -1 : 1)
              : (logical === 1 ? 1 : -1);
            void move(command, direction);
          }}
        >
          {settings.mode === 'compact' ? null : (labels[command] ?? command)}
        </NeonButton>
      ))}
    </nav>
  );
};
