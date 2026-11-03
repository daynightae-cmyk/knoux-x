import React, { useCallback, useState } from 'react';
import { Check, Download, ShieldCheck, Sparkles, X } from 'lucide-react';

import { KnouxAction, KnouxPanelNotice, useMobileCopy } from '../../components/mobile/KnouxControlKit';

/**
 * KNOUX-X — MOBILE TOOL SCAFFOLD
 *
 * The shell every mini tool shares: what it does, what to pick, what happened,
 * and where the result went. Keeping it in one place means a new tool cannot
 * forget the privacy line or the failure state, which is where "all-in-one"
 * apps usually look sloppy.
 */

export type ToolPhase = 'idle' | 'working' | 'ready' | 'done' | 'error';

export interface ToolScaffoldProps {
  title: string;
  blurb: string;
  icon: React.ReactNode;
  phase: ToolPhase;
  /** Label for the pick button; omitted when the tool has no input file. */
  pickLabel?: string;
  onPick?(): void;
  pickedName?: string | null;
  /** Main action, e.g. "Grab frame" or "Cut into 9 tiles". */
  actionLabel?: string;
  onAction?(): void;
  actionDisabled?: boolean;
  status?: string | null;
  statusTone?: 'info' | 'warn' | 'danger';
  children?: React.ReactNode;
  resultSlot?: React.ReactNode;
}

const PHASE_LABEL: Record<ToolPhase, string> = {
  idle: 'Ready',
  working: 'Processing',
  ready: 'Ready',
  done: 'Success',
  error: 'Failed',
};

export const ToolScaffold: React.FC<ToolScaffoldProps> = ({
  title,
  blurb,
  icon,
  phase,
  pickLabel,
  onPick,
  pickedName,
  actionLabel,
  onAction,
  actionDisabled = false,
  status,
  statusTone = 'info',
  children,
  resultSlot,
}) => {
  const copy = useMobileCopy();
  return (
    <section className="kmt-tool" data-component="ToolScaffold" data-phase={phase} aria-busy={phase === 'working'}>
      <header className="kmt-tool-head">
        <span className="kmt-tool-icon">{icon}</span>
        <div>
          <strong>{copy(title)}</strong>
          <small>{copy(blurb)}</small>
        </div>
        <span className="kmt-tool-phase" data-phase={phase}>{copy(PHASE_LABEL[phase])}</span>
      </header>

      <div className="kmt-tool-body">
        {(pickLabel && onPick) && (
          <div className="kmt-tool-pick">
            <KnouxAction label={pickLabel} icon={Sparkles} tone="primary" onClick={onPick} disabled={phase === 'working'} />
            {pickedName ? (
              <span className="kmt-tool-file"><bdi>{pickedName}</bdi><Download size={13} aria-hidden="true" /></span>
            ) : (
              <span className="kmt-tool-file is-empty">{copy('No file selected')}</span>
            )}
          </div>
        )}

        {children}

        {(actionLabel && onAction) && (
          <div className="kmt-tool-actions">
            <KnouxAction label={actionLabel} icon={Check} tone="primary" onClick={onAction} disabled={actionDisabled || phase === 'working'} />
          </div>
        )}

        {status && <KnouxPanelNotice tone={statusTone}>{status}</KnouxPanelNotice>}
        {resultSlot}
      </div>

      <footer className="kmt-tool-privacy">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>{copy('Runs entirely offline')}</span>
      </footer>
    </section>
  );
};

/** Small numeric/text row shared by the tools. */
export const ToolStatusLine: React.FC<{ tone?: 'info' | 'warn' | 'danger'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <p className={`kmt-status kmt-status--${tone}`} role="status">{children}</p>
);

/** Chip used for the many small toggles across tools. */
export const ToolToggleChip: React.FC<{ label: string; active: boolean; onClick(): void }> = ({ label, active, onClick }) => {
  const copy = useMobileCopy();
  return (
    <button type="button" className="kmt-chip" data-active={active ? 'true' : 'false'} aria-pressed={active} onClick={onClick}>
      {active ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
      <span>{copy(label)}</span>
    </button>
  );
};

/**
 * Busy-state hook: tools are async and a phone user must see which stage failed.
 * Kept here so every panel reports the same shape of error.
 */
export function useToolRunner(): {
  phase: ToolPhase;
  status: string | null;
  tone: 'info' | 'warn' | 'danger';
  run(action: () => Promise<string>, busyLabel: string): Promise<void>;
  setBusy(label: string): void;
  reset(): void;
} {
  const copy = useMobileCopy();
  const [phase, setPhase] = useState<ToolPhase>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<'info' | 'warn' | 'danger'>('info');

  const run = useCallback(async (action: () => Promise<string>, busyLabel: string): Promise<void> => {
    setPhase('working');
    setTone('info');
    setStatus(copy(busyLabel));
    try {
      const message = await action();
      setStatus(message);
      setPhase('done');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy('Failed'));
      setTone('danger');
      setPhase('error');
    }
  }, [copy]);

  const setBusy = useCallback((label: string): void => {
    setPhase('working');
    setStatus(copy(label));
  }, [copy]);

  const reset = useCallback((): void => {
    setPhase('idle');
    setStatus(null);
    setTone('info');
  }, []);

  return { phase, status, tone, run, setBusy, reset };
}
