import React, { useEffect, useRef, useState } from 'react';

import { registerAndroidBackInterceptor } from '../../platform/androidBackButton';

export interface MobilePromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm(value: string): void;
  onCancel(): void;
}

/**
 * In-app single-line prompt.
 *
 * `window.prompt()` is not implemented by the Android WebView: the call
 * returns null and the calling action silently does nothing, which left
 * "New project" as a dead button on the phone. This dialog keeps the naming
 * step inside the app, follows the mobile visual language and lets the
 * hardware Back button close it instead of navigating the app.
 */
export const MobilePromptDialog: React.FC<MobilePromptDialogProps> = ({
  open,
  title,
  label,
  defaultValue = '',
  confirmLabel = 'Create',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setValue(defaultValue);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return undefined;
    return registerAndroidBackInterceptor(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="kx-prompt-backdrop" onClick={onCancel}>
      <div
        className="kx-prompt"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <label className="kx-prompt-field">
          <span>{label}</span>
          <input
            ref={inputRef}
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const trimmed = value.trim();
                if (trimmed) onConfirm(trimmed);
              }
            }}
          />
        </label>
        <div className="kx-prompt-actions">
          <button type="button" className="kx-prompt-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className="kx-prompt-confirm"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
