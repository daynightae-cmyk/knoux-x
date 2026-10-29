import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Clock3,
  Download,
  Lock,
  Pin,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { registerAndroidBackInterceptor } from '../../platform/androidBackButton';
import { getPlatformCapabilities, type PlatformCapabilities } from '../../platform/platformCapabilities';
import { useAppStore, type ViewType } from '../../store/appStore';
import { useMobileCopy } from '../../components/mobile/KnouxControlKit';

import {
  AudioExtractorTool,
  ColourPickerTool,
  FrameExtractorTool,
  GridSplitterTool,
  PhotoInspectorTool,
  PhotoMergeTool,
  ResolutionCalculatorTool,
} from './MobileToolPanels';
import {
  TOOL_CATEGORIES,
  TOOL_ENTRIES,
  capabilityState,
  type ToolEntry,
  type ToolPanelId,
} from './mobileToolsCatalog';

import './mobileToolsHub.css';

/**
 * KNOUX-X — ANDROID TOOLS HUB
 *
 * This is the answer to "why install five apps". It is not a list of buttons:
 * every service is a card that shows what it does, whether this exact device can
 * run it right now (read from the live capability report, never assumed), and it
 * can be pinned, found by typing in either language, and remembered by use.
 *
 * Panel tools open in place; route tools hand over to the real workspace. No card
 * points at something that does not exist — the catalog contract test enforces it.
 */

const PINNED_KEY = 'knoux:android:pinned-tools:v1';
const USED_KEY = 'knoux:android:tool-usage:v1';

type HubOverlay = null | 'search' | 'notifications';

const PANEL_COMPONENTS: Record<ToolPanelId, React.FC> = {
  frames: FrameExtractorTool,
  metadata: PhotoInspectorTool,
  palette: ColourPickerTool,
  grid: GridSplitterTool,
  merge: PhotoMergeTool,
  audioExtract: AudioExtractorTool,
  resolution: ResolutionCalculatorTool,
};

function readPinned(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}

function readUsage(): Record<string, number> {
  try {
    const value = JSON.parse(window.localStorage.getItem(USED_KEY) || '{}');
    return value && typeof value === 'object' ? value as Record<string, number> : {};
  } catch { return {}; }
}

export const MobileToolsHub: React.FC = () => {
  const copy = useMobileCopy();
  const ar = useAppStore((state) => state.locale) === 'ar';
  const setView = useAppStore((state) => state.setView);
  const notifications = useAppStore((state) => state.notifications);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ToolEntry['category'] | 'all' | 'pinned'>('all');
  const [openPanel, setOpenPanel] = useState<ToolEntry | null>(null);
  const [pinned, setPinned] = useState<string[]>(() => readPinned());
  const [usage, setUsage] = useState<Record<string, number>>(() => readUsage());
  const [overlay, setOverlay] = useState<HubOverlay>(null);
  const [capabilities] = useState<PlatformCapabilities>(() => getPlatformCapabilities());

  useEffect(() => {
    if (!overlay) return undefined;
    return registerAndroidBackInterceptor(() => {
      setOverlay(null);
      return true;
    });
  }, [overlay]);

  // Hardware back leaves an open panel before it leaves the hub.
  useEffect(() => {
    if (!openPanel) return undefined;
    return registerAndroidBackInterceptor(() => {
      setOpenPanel(null);
      return true;
    });
  }, [openPanel]);

  const togglePin = useCallback((id: string): void => {
    setPinned((current) => {
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
      try { window.localStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* storage refused */ }
      return next;
    });
  }, []);

  const launch = useCallback((entry: ToolEntry): void => {
    setUsage((current) => {
      const next = { ...current, [entry.id]: (current[entry.id] ?? 0) + 1 };
      try { window.localStorage.setItem(USED_KEY, JSON.stringify(next)); } catch { /* storage refused */ }
      return next;
    });
    if (entry.target.kind === 'panel') {
      setOpenPanel(entry);
      return;
    }
    setView(entry.target.view as ViewType);
  }, [setView]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TOOL_ENTRIES.filter((entry) => {
      if (category === 'pinned' && !pinned.includes(entry.id)) return false;
      if (category !== 'all' && category !== 'pinned' && entry.category !== category) return false;
      if (!needle) return true;
      const haystack = `${entry.label} ${entry.blurb} ${entry.tags.join(' ')}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [category, pinned, query]);

  const recents = useMemo(() => {
    const ranked = Object.entries(usage).sort((left, right) => right[1] - left[1]).slice(0, 4);
    return ranked.map(([id]) => TOOL_ENTRIES.find((entry) => entry.id === id)).filter((entry): entry is ToolEntry => Boolean(entry));
  }, [usage]);

  const Panel = openPanel && openPanel.target.kind === 'panel' ? PANEL_COMPONENTS[openPanel.target.panel] : null;

  return (
    <section className="knoux-mobile-creative-surface kmth-hub" data-component="MobileToolsHub" dir={ar ? 'rtl' : 'ltr'}>
      <header className="kmth-topbar">
        <button type="button" className="kmc-round-button kx-back" aria-label={copy('Back')} onClick={() => setView('home')}>
          <ArrowLeft size={20} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={32} />
          <div>
            <strong>KNOUX <span>X</span></strong>
            <small>{copy('All tools')}</small>
          </div>
        </div>
        <div className="kmc-topbar-actions">
          <button type="button" className="kmc-round-button" aria-label={copy('Search tools')} onClick={() => setOverlay('search')}>
            <Search size={18} />
          </button>
          <button type="button" className="kmc-round-button" aria-label={copy('Notifications')} onClick={() => setOverlay('notifications')}>
            <Bell size={18} />
            {notifications.length > 0 && <i className="kmth-badge">{Math.min(9, notifications.length)}</i>}
          </button>
        </div>
      </header>

      <div className="kmth-masthead">
        <span>{copy('EVERY SERVICE, ONE PLACE')}</span>
        <h1>{copy('Tools')} <em>{copy('Your creative toolkit')}</em></h1>
        <p>{copy('Everything on this device')} · {TOOL_ENTRIES.length} {copy('All tools').toLowerCase()}</p>
      </div>

      <label className="kmth-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy('Search tools')}
          aria-label={copy('Search tools')}
        />
        {query && <button type="button" aria-label={copy('Clear')} onClick={() => setQuery('')}><X size={15} /></button>}
      </label>

      <div className="kmth-cats" role="tablist" aria-label={copy('Tools')}>
        <button type="button" role="tab" aria-selected={category === 'all'} data-active={category === 'all'} onClick={() => setCategory('all')}>{copy('See everything')}</button>
        <button type="button" role="tab" aria-selected={category === 'pinned'} data-active={category === 'pinned'} onClick={() => setCategory('pinned')}><Pin size={13} aria-hidden="true" /> {copy('Pinned')}</button>
        {TOOL_CATEGORIES.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={category === entry.id} data-active={category === entry.id} onClick={() => setCategory(entry.id)}>
            {copy(entry.label)}
          </button>
        ))}
      </div>

      {recents.length > 0 && category === 'all' && !query && (
        <div className="kmth-rail">
          <div className="kmth-rail-head"><Clock3 size={14} aria-hidden="true" /><strong>{copy('Recent')}</strong></div>
          <div className="kmth-rail-row">
            {recents.map((entry) => {
              const Icon = entry.icon;
              return (
                <button key={entry.id} type="button" className="kmth-mini" onClick={() => launch(entry)}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{copy(entry.label)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="kmth-grid">
        {filtered.map((entry) => {
          const Icon = entry.icon;
          const capability = entry.capability ? capabilityState(capabilities[entry.capability]) : { state: 'supported' as const, reason: undefined };
          const isPinned = pinned.includes(entry.id);
          return (
            <article
              key={entry.id}
              className="kmth-card"
              data-accent={entry.accent}
              data-featured={entry.featured ? 'true' : 'false'}
              data-state={capability.state}
            >
              <div className="kmth-card-glow" aria-hidden="true" />
              <button type="button" className="kmth-card-pin" aria-pressed={isPinned} aria-label={isPinned ? copy('Pinned') : copy('Pin')} onClick={() => togglePin(entry.id)}>
                <Pin size={14} />
              </button>
              <button type="button" className="kmth-card-hit" onClick={() => launch(entry)} disabled={capability.state === 'off'}>
                <span className="kmth-card-icon"><Icon size={entry.featured ? 26 : 21} strokeWidth={1.6} /></span>
                <strong>{copy(entry.label)}</strong>
                <small>{copy(entry.blurb)}</small>
                <span className="kmth-card-foot">
                  <em data-state={capability.state}>
                    {capability.state === 'supported' ? copy('Runs on this device')
                      : capability.state === 'permission' ? copy('Needs a permission')
                        : capability.state === 'degraded' ? copy('Not available here')
                          : copy('Unsupported')}
                  </em>
                  <ChevronRight className="kx-forward" size={16} aria-hidden="true" />
                </span>
              </button>
              {capability.reason && <p className="kmth-card-reason">{capability.reason}</p>}
            </article>
          );
        })}
        {filtered.length === 0 && (
          <p className="kmth-empty"><Sparkles size={18} aria-hidden="true" /> {copy('No file selected')}</p>
        )}
      </div>

      {openPanel && Panel && (
        <div className="kmth-sheet" role="dialog" aria-modal="true" aria-label={copy(openPanel.label)}>
          <div className="kmth-sheet-inner">
            <button type="button" className="kmth-sheet-close" aria-label={copy('Close')} onClick={() => setOpenPanel(null)}><X size={18} /></button>
            <Panel />
          </div>
        </div>
      )}

      {overlay && (
        <div className="kmth-overlay" role="dialog" aria-modal="true" onClick={() => setOverlay(null)}>
          <div className="kmth-overlay-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="kmth-overlay-head">
              <strong>{overlay === 'search' ? copy('Search tools') : copy('Notifications')}</strong>
              <button type="button" aria-label={copy('Close')} onClick={() => setOverlay(null)}><X size={18} /></button>
            </div>
            {overlay === 'search' && (
              <>
                <label className="kmth-search">
                  <Search size={17} aria-hidden="true" />
                  <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy('Search tools')} aria-label={copy('Search tools')} />
                </label>
                <div className="kmth-overlay-list">
                  {filtered.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button key={entry.id} type="button" onClick={() => { setOverlay(null); launch(entry); }}>
                        <Icon size={19} aria-hidden="true" />
                        <span><strong>{copy(entry.label)}</strong><small>{copy(entry.blurb)}</small></span>
                        <ChevronRight className="kx-forward" size={16} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {overlay === 'notifications' && (
              <div className="kmth-overlay-list">
                {notifications.length === 0 ? (
                  <p className="kmth-empty"><Bell size={18} aria-hidden="true" /> {copy('Nothing to preview yet')}</p>
                ) : (
                  notifications.map((notification) => (
                    <button key={notification.id} type="button" onClick={() => removeNotification(notification.id)}>
                      <Download size={19} aria-hidden="true" />
                      <span><strong>{notification.title}</strong><small>{notification.message}</small></span>
                      <X size={16} aria-hidden="true" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="kmth-footer">
        <Lock size={14} aria-hidden="true" />
        <span>{copy('Nothing leaves your phone.')}</span>
      </div>
    </section>
  );
};

export default MobileToolsHub;
