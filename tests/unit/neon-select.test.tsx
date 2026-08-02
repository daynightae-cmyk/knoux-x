/** @jest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';

import { act, useState } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { NeonSelect } from '../../src/components/neon/NeonSelect';

jest.mock('framer-motion', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const MOTION_ONLY_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'whileTap',
    'whileHover',
    'whileFocus',
    'whileInView',
  ]);
  const createMotionTag = (tag: string) => {
    const Tag = React.forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>((props, ref) => {
      const { children, ...restProps } = props;
      const rest = restProps as unknown as Record<string, unknown>;
      const clean: HTMLAttributes<HTMLElement> = {};
      for (const key of Object.keys(rest)) {
        if (MOTION_ONLY_PROPS.has(key)) continue;
        (clean as Record<string, unknown>)[key] = rest[key];
      }
      const elementProps = { ...clean, ref } as React.DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      return React.createElement(tag as keyof React.ReactHTML, elementProps, children);
    });
    Tag.displayName = `Motion${tag}`;
    return Tag;
  };
  return {
    motion: {
      label: createMotionTag('label'),
      button: createMotionTag('button'),
      ul: createMotionTag('ul'),
      li: createMotionTag('li'),
    },
    AnimatePresence: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock('../../src/components/neon/neon-styles.css', () => ({}));

const OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'huge', label: 'Huge', disabled: true },
];

function NumericValueHarness() {
  const [rate, setRate] = useState(1);
  return (
    <NeonSelect
      aria-label="playback rate"
      value={String(rate)}
      options={[
        { value: '1', label: '1x' },
        { value: '2', label: '2x' },
        { value: '4', label: '4x' },
      ]}
      onChange={(next) => setRate(Number(next))}
    />
  );
}

type OutputFormat = 'mp4' | 'webm' | 'gif';

function UnionValueHarness() {
  const [format, setFormat] = useState<OutputFormat>('mp4');
  return (
    <NeonSelect
      aria-label="output format"
      value={format}
      options={[
        { value: 'mp4', label: 'MP4' },
        { value: 'webm', label: 'WebM' },
        { value: 'gif', label: 'GIF' },
      ]}
      onChange={(next) => setFormat(next as OutputFormat)}
    />
  );
}

interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
}

function renderUi(ui: ReactElement): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function triggerOf(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button.neon-select-trigger');
  if (!button) throw new Error('NeonSelect trigger button not found');
  return button as HTMLButtonElement;
}

function listboxOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="listbox"]');
}

function optionsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[role="option"]'));
}

function clickNode(node: HTMLElement): void {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function keyOn(node: HTMLElement, key: string): void {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('NeonSelect', () => {
  beforeAll(() => {
    (globalThis as unknown as Record<string, boolean>).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = jest.fn();
  });

  test('renders the selected option label and no native <select> element', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="medium" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    expect(triggerOf(container).textContent).toContain('Medium');
    expect(container.querySelector('select')).toBeNull();
    unmount();
  });

  test('opens on mouse click without changing the current value', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="medium" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    clickNode(triggerOf(container));
    expect(listboxOf(container)).not.toBeNull();
    expect(triggerOf(container).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.neon-select')?.className).toContain('neon-select--open');
    expect(triggerOf(container).textContent).toContain('Medium');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  test('opens through keyboard ArrowDown and highlights the current option', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="large" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    expect(listboxOf(container)).not.toBeNull();
    const opts = optionsOf(container);
    expect(opts[2].getAttribute('aria-selected')).toBe('true');
    expect(opts[2].className).toContain('neon-select-option--highlighted');
    unmount();
  });

  test('Enter opens the list from a closed trigger', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    expect(listboxOf(container)).toBeNull();
    keyOn(triggerOf(container), 'Enter');
    expect(listboxOf(container)).not.toBeNull();
    expect(triggerOf(container).getAttribute('aria-expanded')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  test('Space opens the list from a closed trigger', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    expect(listboxOf(container)).toBeNull();
    keyOn(triggerOf(container), ' ');
    expect(listboxOf(container)).not.toBeNull();
    expect(triggerOf(container).getAttribute('aria-expanded')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  test('navigates options with ArrowDown and ArrowUp', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'ArrowDown');
    expect(optionsOf(container)[1].className).toContain('neon-select-option--highlighted');
    keyOn(triggerOf(container), 'ArrowUp');
    expect(optionsOf(container)[0].className).toContain('neon-select-option--highlighted');
    unmount();
  });

  test('Home and End move to the first and last enabled options', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="large" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'Home');
    expect(optionsOf(container)[0].className).toContain('neon-select-option--highlighted');
    keyOn(triggerOf(container), 'End');
    expect(optionsOf(container)[2].className).toContain('neon-select-option--highlighted');
    unmount();
  });

  test('Enter selects the highlighted option and closes the list', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'Enter');
    expect(onChange).toHaveBeenCalledWith('medium');
    expect(listboxOf(container)).toBeNull();
    unmount();
  });

  test('Space selects the highlighted option and closes the list', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), ' ');
    expect(onChange).toHaveBeenCalledWith('medium');
    expect(listboxOf(container)).toBeNull();
    unmount();
  });

  test('Escape closes without changing the value', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="large" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    keyOn(triggerOf(container), 'ArrowDown');
    expect(listboxOf(container)).not.toBeNull();
    keyOn(triggerOf(container), 'Escape');
    expect(listboxOf(container)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(triggerOf(container).textContent).toContain('Large');
    unmount();
  });

  test('disabled state prevents opening, keyboard interaction and selection', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" disabled />,
    );
    const button = triggerOf(container);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    clickNode(button);
    expect(listboxOf(container)).toBeNull();
    keyOn(button, 'ArrowDown');
    expect(listboxOf(container)).toBeNull();
    keyOn(button, 'Enter');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  test('preserves aria-label and listbox semantics on trigger and popup', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={jest.fn()} options={OPTIONS} aria-label="choice size" />,
    );
    const button = triggerOf(container);
    expect(button.getAttribute('aria-label')).toBe('choice size');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    clickNode(button);
    expect(listboxOf(container)?.getAttribute('aria-label')).toBe('choice size');
    unmount();
  });

  test('renders a visible label bound to the control id', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={jest.fn()} options={OPTIONS} label="Size" />,
    );
    const label = container.querySelector('.neon-select-label');
    expect(label).not.toBeNull();
    const controlId = label?.getAttribute('for');
    expect(container.querySelector('.neon-select')?.getAttribute('id')).toBe(controlId);
    unmount();
  });

  test('returns focus to the trigger after closing', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    const button = triggerOf(container);
    button.focus();
    keyOn(button, 'ArrowDown');
    expect(listboxOf(container)).not.toBeNull();
    keyOn(button, 'Escape');
    expect(listboxOf(container)).toBeNull();
    expect(document.activeElement).toBe(button);
    unmount();
  });

  test('round-trips numeric values through value/onChange', () => {
    const { container, unmount } = renderUi(<NumericValueHarness />);
    expect(triggerOf(container).textContent).toContain('1x');
    clickNode(triggerOf(container));
    clickNode(optionsOf(container)[2]);
    expect(triggerOf(container).textContent).toContain('4x');
    unmount();
  });

  test('round-trips union-typed values through value/onChange', () => {
    const { container, unmount } = renderUi(<UnionValueHarness />);
    expect(triggerOf(container).textContent).toContain('MP4');
    clickNode(triggerOf(container));
    clickNode(optionsOf(container)[1]);
    expect(triggerOf(container).textContent).toContain('WebM');
    unmount();
  });

  test('marks the selected option state accessibly with aria-selected', () => {
    const { container, unmount } = renderUi(
      <NeonSelect value="medium" onChange={jest.fn()} options={OPTIONS} aria-label="size" />,
    );
    clickNode(triggerOf(container));
    const opts = optionsOf(container);
    expect(opts[1].getAttribute('aria-selected')).toBe('true');
    expect(opts[0].getAttribute('aria-selected')).toBe('false');
    unmount();
  });

  test('honors dir="rtl" without breaking keyboard navigation', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="small" onChange={onChange} options={OPTIONS} aria-label="size" dir="rtl" />,
    );
    expect(container.querySelector('.neon-select')?.getAttribute('dir')).toBe('rtl');
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'ArrowDown');
    keyOn(triggerOf(container), 'Enter');
    expect(onChange).toHaveBeenCalledWith('medium');
    unmount();
  });

  test('renders the neon-select theme class backed by KNOUX design tokens', () => {
    const { container, unmount } = renderUi(
      <NeonSelect
        value="small"
        onChange={jest.fn()}
        options={OPTIONS}
        aria-label="size"
        className="custom-size"
      />,
    );
    const root = container.querySelector('.neon-select');
    expect(root).not.toBeNull();
    expect(root?.className).toContain('custom-size');
    const css = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/neon/neon-styles.css'),
      'utf8',
    );
    expect(css).toMatch(/\.neon-select\s*\{/);
    expect(css).toContain('var(--knoux-');
    unmount();
  });

  test('disabled options are skipped and not selectable by click', () => {
    const onChange = jest.fn();
    const { container, unmount } = renderUi(
      <NeonSelect value="large" onChange={onChange} options={OPTIONS} aria-label="size" />,
    );
    clickNode(triggerOf(container));
    const opts = optionsOf(container);
    expect(opts[3].getAttribute('aria-disabled')).toBe('true');
    clickNode(opts[3]);
    expect(onChange).not.toHaveBeenCalled();
    expect(listboxOf(container)).not.toBeNull();
    unmount();
  });

  test('regression: application source contains no native <select> control', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          if (/<select(?=[\s/>])/.test(source)) {
            offenders.push(path.relative(srcDir, full));
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
