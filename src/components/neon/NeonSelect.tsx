import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './neon-styles.css';

export interface NeonSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NeonSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: NeonSelectOption[];
  label?: string;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  id?: string;
}

export const NeonSelect = forwardRef<HTMLDivElement, NeonSelectProps>(
  (
    {
      value,
      onChange,
      options,
      label,
      disabled = false,
      dir = 'auto',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      className = '',
      id,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);
    const searchRef = useRef('');
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const uniqueId = useId();
    const selectId = id ?? uniqueId;
    const listboxId = `${selectId}-listbox`;
    const selectedIndex = options.findIndex((opt) => opt.value === value);

    const close = useCallback(() => {
      setOpen(false);
      setHighlightedIndex(-1);
      searchRef.current = '';
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      triggerRef.current?.focus();
    }, []);

    const selectOption = useCallback(
      (optionValue: string) => {
        onChange(optionValue);
        close();
      },
      [onChange, close],
    );

    const toggle = useCallback(() => {
      if (disabled) return;
      setOpen((prev) => {
        if (prev) close();
        return !prev;
      });
    }, [disabled, close]);

    const moveHighlight = useCallback(
      (delta: number) => {
        setHighlightedIndex((prev) => {
          let next = prev + delta;
          while (next >= 0 && options[next]?.disabled) next += delta;
          if (next < 0) next = options.length - 1;
          while (next >= 0 && next < options.length && options[next]?.disabled) next += delta;
          if (next < 0 || next >= options.length) return prev;
          return next;
        });
      },
      [options],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        switch (event.key) {
          case 'Enter':
          case ' ':
            event.preventDefault();
            if (open) {
              const idx = highlightedIndex >= 0 ? highlightedIndex : selectedIndex;
              if (idx >= 0 && idx < options.length && !options[idx].disabled) {
                selectOption(options[idx].value);
              }
            } else {
              toggle();
            }
            break;
          case 'ArrowDown':
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
            } else {
              moveHighlight(1);
            }
            break;
          case 'ArrowUp':
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : options.length - 1);
            } else {
              moveHighlight(-1);
            }
            break;
          case 'Home':
            event.preventDefault();
            if (open) {
              const first = options.findIndex((opt) => !opt.disabled);
              setHighlightedIndex(first >= 0 ? first : -1);
            }
            break;
          case 'End':
            event.preventDefault();
            if (open) {
              const last = options.length - 1 - [...options].reverse().findIndex((opt) => !opt.disabled);
              setHighlightedIndex(last >= 0 ? last : -1);
            }
            break;
          case 'Escape':
            event.preventDefault();
            if (open) close();
            break;
          case 'Tab':
            if (open) close();
            break;
          default:
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              searchRef.current += event.key;
              if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
              searchTimeoutRef.current = setTimeout(() => {
                searchRef.current = '';
              }, 600);
              const prefix = searchRef.current.toLowerCase();
              const matchIdx = options.findIndex(
                (opt) => !opt.disabled && opt.label.toLowerCase().startsWith(prefix),
              );
              if (matchIdx >= 0) {
                setHighlightedIndex(matchIdx);
                if (!open) {
                  setOpen(true);
                }
              }
            }
            break;
        }
      },
      [disabled, open, highlightedIndex, selectedIndex, options, toggle, close, moveHighlight, selectOption],
    );

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          close();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [close]);

    useEffect(() => {
      if (open && listboxRef.current && highlightedIndex >= 0) {
        const items = listboxRef.current.querySelectorAll<HTMLLIElement>('[role="option"]');
        items[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
      }
    }, [open, highlightedIndex]);

    const selectedOption = options.find((opt) => opt.value === value);

    return (
      <div
        ref={ref}
        className={['neon-select', className, open ? 'neon-select--open' : ''].filter(Boolean).join(' ')}
        dir={dir}
        id={selectId}
      >
        {label && (
          <motion.label
            className="neon-select-label"
            htmlFor={selectId}
            initial={false}
            animate={{ color: open ? 'var(--knoux-accent)' : 'rgba(255,255,255,0.6)' }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.label>
        )}
        <div className="neon-select-trigger-wrapper">
          <motion.button
            ref={triggerRef}
            type="button"
            className="neon-select-trigger"
            onClick={toggle}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-disabled={disabled || undefined}
            whileTap={disabled ? undefined : { scale: 0.98 }}
          >
            <span className="neon-select-value">
              {selectedOption ? selectedOption.label : ''}
            </span>
            <span className="neon-select-arrow" aria-hidden="true">
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </motion.button>
          <AnimatePresence>
            {open && (
              <motion.ul
                ref={listboxRef}
                id={listboxId}
                className="neon-select-popup"
                role="listbox"
                aria-label={ariaLabel}
                initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                exit={{ opacity: 0, y: -4, scaleY: 0.96 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {options.map((option, index) => {
                  const isSelected = option.value === value;
                  const isHighlighted = index === highlightedIndex;
                  return (
                    <motion.li
                      key={option.value}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      className={[
                        'neon-select-option',
                        isSelected ? 'neon-select-option--selected' : '',
                        isHighlighted ? 'neon-select-option--highlighted' : '',
                        option.disabled ? 'neon-select-option--disabled' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => {
                        if (!option.disabled) selectOption(option.value);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      initial={false}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.02 }}
                    >
                      <span className="neon-select-option-label">{option.label}</span>
                      {isSelected && (
                        <span className="neon-select-option-check" aria-hidden="true">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      )}
                    </motion.li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  },
);

NeonSelect.displayName = 'NeonSelect';