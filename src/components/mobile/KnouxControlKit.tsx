import React, { useCallback, useMemo, useRef } from 'react';
import { Check, type LucideIcon } from 'lucide-react';

import { useAppStore } from '../../store/appStore';

import { mobileCopy } from './mobileCopyCatalog';

import './knouxControlKit.css';

/**
 * KNOUX-X — MOBILE CONTROL KIT
 *
 * Every creative surface on Android (video inspector, photo editor, tools)
 * needs the same handful of controls, and on a phone a control that is 30px tall
 * or hides its value is a control nobody uses. These primitives are shared so
 * the three surfaces cannot drift apart visually, and so a slider gesture maps to
 * exactly one undo step instead of one hundred.
 */

export function useMobileCopy(): (text: string) => string {
  const locale = useAppStore((state) => state.locale);
  return useCallback((text: string) => mobileCopy(text, locale), [locale]);
}

export function useIsArabic(): boolean {
  return useAppStore((state) => state.locale) === 'ar';
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Renders a centre notch and reports bipolar values with a sign. */
  bipolar?: boolean;
  /** Suffixed to the read-out, e.g. '%' or '×'. */
  unit?: string;
  /** Fixed decimals for the read-out; auto when omitted. */
  decimals?: number;
  icon?: LucideIcon;
  /** Value the control returns to when the read-out is tapped. */
  defaultValue?: number;
  /** Stable identity for one drag gesture; identical keys coalesce in undo. */
  gesture?: string;
  disabled?: boolean;
  onChange(value: number, gesture?: string): void;
  onReset?(): void;
}

function readOut(value: number, step: number, decimals: number | undefined, bipolar: boolean, unit: string): string {
  const places = decimals ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const text = value.toFixed(places);
  return `${bipolar && value > 0 ? '+' : ''}${text}${unit}`;
}

export const KnouxSlider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  bipolar = false,
  unit = '',
  decimals,
  icon: Icon,
  defaultValue,
  gesture,
  disabled = false,
  onChange,
  onReset,
}) => {
  const copy = useMobileCopy();
  /** Where the painted bar sits: from the start, or from zero for bipolar. */
  const fill = useMemo(() => {
    const span = max - min;
    if (span <= 0) return { start: 0, width: 0 };
    const position = Math.max(0, Math.min(100, ((value - min) / span) * 100));
    if (!bipolar) return { start: 0, width: position };
    const centre = Math.max(0, Math.min(100, ((0 - min) / span) * 100));
    return { start: Math.min(centre, position), width: Math.abs(position - centre) };
  }, [bipolar, max, min, value]);

  return (
    <div className="kck-slider" data-bipolar={bipolar ? 'true' : 'false'} data-disabled={disabled ? 'true' : 'false'}>
      <div className="kck-slider-head">
        <label htmlFor={`${gesture ?? label}-slider`}>
          {Icon ? <Icon size={13} aria-hidden="true" /> : null}
          <span>{copy(label)}</span>
        </label>
        <button
          type="button"
          className="kck-value"
          disabled={disabled || defaultValue === undefined}
          title={defaultValue === undefined ? undefined : copy('Reset')}
          onClick={() => {
            if (defaultValue === undefined) return;
            if (onReset) onReset();
            else onChange(defaultValue, gesture);
          }}
        >
          {readOut(value, step, decimals, bipolar, unit)}
        </button>
      </div>
      <div className="kck-slider-track">
        {bipolar && <i className="kck-slider-centre" aria-hidden="true" />}
        <i
          className="kck-slider-fill"
          style={{ width: `${fill.width}%`, insetInlineStart: `${fill.start}%` }}
          aria-hidden="true"
        />
        <input
          id={`${gesture ?? label}-slider`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value), gesture)}
          aria-valuetext={readOut(value, step, decimals, bipolar, unit)}
        />
      </div>
    </div>
  );
};

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedProps<T extends string | number> {
  label?: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  gesture?: string;
  disabled?: boolean;
  onChange(value: T): void;
}

export function KnouxSegmented<T extends string | number>({ label, value, options, disabled = false, onChange }: SegmentedProps<T>): React.JSX.Element {
  const copy = useMobileCopy();
  return (
    <div className="kck-segmented" role="group" aria-label={label ? copy(label) : undefined}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            className="kck-segment"
            data-active={active ? 'true' : 'false'}
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={14} aria-hidden="true" /> : null}
            <span>{copy(option.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface ChipGroupProps<T extends string> {
  label?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  disabled?: boolean;
  onChange(value: T): void;
}

export function KnouxChipGroup<T extends string>({ label, value, options, disabled = false, onChange }: ChipGroupProps<T>): React.JSX.Element {
  const copy = useMobileCopy();
  return (
    <div className="kck-chips" role="group" aria-label={label ? copy(label) : undefined}>
      {label ? <span className="kck-group-label">{copy(label)}</span> : null}
      <div className="kck-chip-row">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="kck-chip"
            data-active={option.value === value ? 'true' : 'false'}
            disabled={disabled}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            <strong>{copy(option.label)}</strong>
            {option.hint ? <small>{copy(option.hint)}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  icon?: LucideIcon;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

export const KnouxToggleRow: React.FC<ToggleRowProps> = ({ label, hint, checked, icon: Icon, disabled = false, onChange }) => {
  const copy = useMobileCopy();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="kck-toggle"
      data-on={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="kck-toggle-label">
        {Icon ? <Icon size={15} aria-hidden="true" /> : null}
        <strong>{copy(label)}</strong>
        {hint ? <small>{copy(hint)}</small> : null}
      </span>
      <span className="kck-toggle-switch" aria-hidden="true"><i /></span>
    </button>
  );
};

export interface ActionProps {
  label: string;
  icon?: LucideIcon;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
}

export const KnouxAction: React.FC<ActionProps> = ({ label, icon: Icon, tone = 'default', disabled = false, pressed = false, onClick }) => {
  const copy = useMobileCopy();
  return (
    <button
      type="button"
      className={`kck-action kck-action--${tone}`}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {Icon ? <Icon size={15} aria-hidden="true" /> : null}
      <span>{copy(label)}</span>
    </button>
  );
};

export interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'search';
  inputMode?: 'text' | 'numeric' | 'decimal';
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export const KnouxField: React.FC<FieldProps> = ({ label, value, placeholder, type = 'text', inputMode, min, max, step, suffix, disabled = false, onChange }) => {
  const copy = useMobileCopy();
  return (
    <label className="kck-field">
      <span>{copy(label)}</span>
      <span className="kck-field-input">
        <input
          type={type === 'number' ? 'number' : type}
          inputMode={inputMode}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder ? copy(placeholder) : undefined}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <em>{copy(suffix)}</em> : null}
      </span>
    </label>
  );
};

export interface ColorFieldProps {
  label: string;
  value: string;
  swatches?: readonly string[];
  onChange(value: string): void;
}

const DEFAULT_SWATCHES = ['#ffffff', '#000000', '#7828e8', '#55dff5', '#d4af37', '#f36983', '#43d6a0', 'transparent'];

export const KnouxColorField: React.FC<ColorFieldProps> = ({ label, value, swatches = DEFAULT_SWATCHES, onChange }) => {
  const copy = useMobileCopy();
  return (
    <div className="kck-color">
      <span className="kck-group-label">{copy(label)}</span>
      <div className="kck-color-row">
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="kck-swatch"
            data-swatch={swatch}
            data-active={swatch === value ? 'true' : 'false'}
            aria-label={`${copy(label)} ${swatch}`}
            aria-pressed={swatch === value}
            style={swatch === 'transparent' ? undefined : { background: swatch }}
            onClick={() => onChange(swatch)}
          >
            {swatch === value ? <Check size={12} aria-hidden="true" /> : null}
          </button>
        ))}
        <label className="kck-color-custom">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#7828e8'} onChange={(event) => onChange(event.target.value)} aria-label={copy(label)} />
          <span>{value}</span>
        </label>
      </div>
    </div>
  );
};

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export interface TabStripProps<T extends string> {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange(value: T): void;
  ariaLabel: string;
}

export function KnouxTabStrip<T extends string>({ tabs, value, onChange, ariaLabel }: TabStripProps<T>): React.JSX.Element {
  const copy = useMobileCopy();
  const scroller = useRef<HTMLDivElement | null>(null);
  return (
    <div className="kck-tabs" role="tablist" aria-label={copy(ariaLabel)} ref={scroller}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            className="kck-tab"
            onClick={() => onChange(tab.value)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{copy(tab.label)}</span>
            {tab.badge ? <i className="kck-tab-badge">{tab.badge}</i> : null}
          </button>
        );
      })}
    </div>
  );
}

export const KnouxPanelNotice: React.FC<{ tone?: 'info' | 'warn' | 'danger'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <p className={`kck-notice kck-notice--${tone}`} role="status">{children}</p>
);

export const KnouxGroupLabel: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => {
  const copy = useMobileCopy();
  return (
    <div className="kck-group-head">
      <strong>{children}</strong>
      {hint ? <small>{copy(hint)}</small> : null}
    </div>
  );
};
