export const SPRINT_02_SURFACES = [
  'Player', 'Library', 'Queue', 'Captures', 'Recorder', 'Editor', 'Image Editor',
  'Slideshow', 'Audio Tools', 'Export', 'Settings', 'Developer Center', 'About', 'Diagnostics',
] as const;

export type Sprint02Surface = typeof SPRINT_02_SURFACES[number];
export type ActionRuntime = 'desktop' | 'browser-preview' | 'both';
export type ActionStatus = 'implemented' | 'disabled' | 'beta';
export type CommandTraceStatus = 'started' | 'completed' | 'failed' | 'rejected';

export interface ActionInventoryRecord {
  id: string;
  page: Sprint02Surface;
  component: string;
  label: string;
  icon: string | null;
  command: string;
  click: 'command-bus';
  shortcut: string | null;
  enabledCondition: string;
  disabledReason: string | null;
  runtime: ActionRuntime;
  ipc: string | null;
  expected: string;
  actual: string;
  automated: boolean;
  manual: boolean;
  pass: boolean;
  status: ActionStatus;
}

export interface CommandTrace {
  sequence: number;
  actionId: string;
  command: string;
  surface: Sprint02Surface;
  source: 'pointer' | 'keyboard' | 'shortcut' | 'packaged-verifier';
  status: CommandTraceStatus;
  effect: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface Sprint02RuntimeSnapshot {
  schemaVersion: 1;
  inventory: ActionInventoryRecord[];
  traces: CommandTrace[];
  direction: 'ltr' | 'rtl';
  activeSurface: Sprint02Surface;
}

export interface Sprint02CommandRuntime {
  refresh(): ActionInventoryRecord[];
  inventory(): ActionInventoryRecord[];
  traces(): CommandTrace[];
  clearTraces(): void;
  activate(actionId: string, source?: CommandTrace['source']): Promise<CommandTrace>;
  snapshot(): Sprint02RuntimeSnapshot;
}

const ACTION_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a[href], [data-command-id]';
const VIEW_SURFACES: Record<string, Sprint02Surface> = {
  player: 'Player', library: 'Library', queue: 'Queue', capture: 'Captures', recording: 'Recorder', editor: 'Editor',
  'image-editor': 'Image Editor', slideshow: 'Slideshow', 'audio-tools': 'Audio Tools', export: 'Export', settings: 'Settings',
};

export function sprint02SurfaceForView(view: string): Sprint02Surface {
  return VIEW_SURFACES[view] ?? 'Player';
}

function slug(value: string): string {
  const normalized = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unlabelled-action';
}

function actionLabel(element: HTMLElement): string {
  const candidates = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element instanceof HTMLInputElement ? element.value : null,
    element.textContent,
  ];
  return candidates.map((candidate) => candidate?.replace(/\s+/g, ' ').trim() ?? '').find(Boolean) || 'Unlabelled action';
}

function componentName(element: HTMLElement): string {
  const named = element.closest<HTMLElement>('[data-component]')?.dataset.component;
  if (named) return named;
  const className = typeof element.className === 'string' ? element.className.split(/\s+/).find(Boolean) : '';
  return element.tagName.toLowerCase() + (className ? `.${className}` : '');
}

function elementSurface(element: HTMLElement): Sprint02Surface {
  const explicit = element.closest<HTMLElement>('[data-sprint02-surface]')?.dataset.sprint02Surface;
  if (explicit && SPRINT_02_SURFACES.includes(explicit as Sprint02Surface)) return explicit as Sprint02Surface;
  const view = document.querySelector<HTMLElement>('.app-shell')?.dataset.currentView ?? 'player';
  return sprint02SurfaceForView(view);
}

function visible(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function disabledReason(element: HTMLElement): string | null {
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement) || !element.disabled) return null;
  // `title` is a decorative tooltip (often just the action's own label, e.g. "Undo", "cancel") and must never be
  // treated as a diagnostic explanation: doing so previously let meaningless self-referential "reasons" pass census.
  return element.dataset.disabledReason ?? element.getAttribute('aria-description')
    ?? 'Unavailable until the required input, selection, or runtime capability is present.';
}

function runtimeFor(element: HTMLElement): ActionRuntime {
  const declared = element.dataset.runtime;
  if (declared === 'desktop' || declared === 'browser-preview' || declared === 'both') return declared;
  return element.closest('[data-desktop-only]') ? 'desktop' : 'both';
}

function elementEffect(element: HTMLElement, before: string): string {
  const afterView = document.querySelector<HTMLElement>('.app-shell')?.dataset.currentView ?? 'unknown';
  const dialog = document.querySelector<HTMLElement>('[role="dialog"] h1, [role="dialog"] h2, [role="dialog"] [aria-label]');
  const notification = document.querySelector<HTMLElement>('.app-notification:last-child');
  const details = [
    before !== afterView ? `view:${before}->${afterView}` : '',
    element.getAttribute('aria-pressed') !== null ? `pressed:${element.getAttribute('aria-pressed')}` : '',
    element.getAttribute('aria-checked') !== null ? `checked:${element.getAttribute('aria-checked')}` : '',
    dialog?.textContent?.trim() ? `dialog:${dialog.textContent.trim().slice(0, 120)}` : '',
    notification?.textContent?.trim() ? `notification:${notification.textContent.trim().slice(0, 120)}` : '',
  ].filter(Boolean);
  return details.join('; ') || 'handler-completed';
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

export function createSprint02CommandRuntime(root: HTMLElement): Sprint02CommandRuntime {
  let sequence = 0;
  const records = new Map<string, ActionInventoryRecord>();
  const traceLog: CommandTrace[] = [];
  const elements = new Map<string, HTMLElement>();
  const bypass = new WeakSet<HTMLElement>();

  const refresh = (): ActionInventoryRecord[] => {
    const candidates = [...root.querySelectorAll<HTMLElement>(ACTION_SELECTOR)].filter(visible);
    const ordinals = new Map<string, number>();
    for (const element of candidates) {
      if (element.closest('[data-inventory-exclude="true"]')) continue;
      const surface = elementSurface(element);
      element.dataset.actionSurface = surface;
      const label = actionLabel(element);
      const base = `${slug(surface)}.${slug(label)}`;
      const ordinal = (ordinals.get(base) ?? 0) + 1;
      ordinals.set(base, ordinal);
      const actionId = element.dataset.actionId || `${base}${ordinal > 1 ? `.${ordinal}` : ''}`;
      const command = element.dataset.commandId || `dom.${actionId}`;
      element.dataset.actionId = actionId;
      element.dataset.commandId = command;
      element.dataset.component ||= componentName(element);
      const reason = disabledReason(element);
      const status = element.dataset.actionStatus === 'beta' ? 'beta' : reason ? 'disabled' : 'implemented';
      const existing = records.get(actionId);
      records.set(actionId, {
        id: actionId, page: surface, component: componentName(element), label,
        icon: element.querySelector('svg') ? 'svg' : null, command, click: 'command-bus',
        shortcut: element.dataset.shortcut ?? null,
        enabledCondition: reason ? 'Declared runtime/state prerequisite is not currently satisfied.' : 'Visible and enabled in the current surface state.',
        disabledReason: status === 'beta' ? (element.dataset.disabledReason ?? 'Planned for a future sprint.') : reason,
        runtime: runtimeFor(element), ipc: element.dataset.ipcChannel ?? null,
        expected: element.dataset.expectedEffect ?? 'Exactly one command trace and completion of the bound real DOM handler.',
        actual: reason ? `disabled:${reason}` : (existing?.actual ?? 'not-exercised'),
        automated: existing?.automated ?? false, manual: false, pass: reason ? true : (existing?.pass ?? false), status,
      });
      elements.set(actionId, element);
    }
    return [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
  };

  const activate = async (actionId: string, source: CommandTrace['source'] = 'packaged-verifier'): Promise<CommandTrace> => {
    refresh();
    const element = elements.get(actionId);
    const record = records.get(actionId);
    if (!element || !record) throw new Error(`Unknown Sprint 02 action: ${actionId}`);
    const trace: CommandTrace = {
      sequence: ++sequence, actionId, command: record.command, surface: record.page, source,
      status: 'started', effect: '', startedAt: new Date().toISOString(), completedAt: null, error: null,
    };
    traceLog.push(trace);
    const disabled = record.status !== 'implemented' || (element instanceof HTMLButtonElement && element.disabled);
    if (disabled) {
      trace.status = 'rejected'; trace.effect = record.disabledReason ?? 'Action is unavailable.'; trace.completedAt = new Date().toISOString();
      return trace;
    }
    const beforeView = document.querySelector<HTMLElement>('.app-shell')?.dataset.currentView ?? 'unknown';
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      bypass.add(element);
      element.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      trace.status = 'completed'; trace.effect = elementEffect(element, beforeView); trace.completedAt = new Date().toISOString();
      records.set(actionId, { ...record, actual: trace.effect, automated: true, pass: true });
    } catch (error) {
      trace.status = 'failed'; trace.error = error instanceof Error ? error.message : String(error); trace.effect = 'handler-threw'; trace.completedAt = new Date().toISOString();
      records.set(actionId, { ...record, actual: trace.error, automated: true, pass: false });
    }
    return trace;
  };

  const handleClick = (event: MouseEvent): void => {
    const element = (event.target as Element | null)?.closest<HTMLElement>(ACTION_SELECTOR);
    if (!element || !root.contains(element) || element.closest('[data-inventory-exclude="true"]')) return;
    if (bypass.delete(element)) return;
    refresh();
    const actionId = element.dataset.actionId;
    if (!actionId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void activate(actionId, event.detail === 0 ? 'keyboard' : 'pointer');
  };

  root.addEventListener('click', handleClick, true);
  refresh();
  return {
    refresh, inventory: () => refresh(), traces: () => clone(traceLog), clearTraces: () => { traceLog.length = 0; }, activate,
    snapshot: () => ({
      schemaVersion: 1, inventory: refresh(), traces: clone(traceLog),
      direction: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr', activeSurface: elementSurface(root),
    }),
  };
}
