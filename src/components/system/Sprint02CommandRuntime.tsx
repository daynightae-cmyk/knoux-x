import { useEffect } from 'react';

import { createSprint02CommandRuntime } from '../../core/commands/sprint02CommandSystem';

export const Sprint02CommandRuntime: React.FC = () => {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.app-shell');
    if (!root) throw new Error('Sprint 02 command runtime requires the application shell.');
    const runtime = createSprint02CommandRuntime(root);
    window.__knouxSprint02 = runtime;
    const observer = new MutationObserver(() => runtime.refresh());
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-hidden', 'aria-label', 'aria-pressed', 'aria-checked', 'data-sprint02-surface'] });
    return () => { observer.disconnect(); delete window.__knouxSprint02; };
  }, []);
  return null;
};
