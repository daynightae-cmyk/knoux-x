/** @jest-environment jsdom */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { MobilePromptDialog } from '../../src/components/mobile/MobilePromptDialog';

function renderDialog(props: Partial<React.ComponentProps<typeof MobilePromptDialog>> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const merged = {
    open: true,
    title: 'Project name',
    label: 'Project name',
    defaultValue: 'Knoux X Mobile Slideshow',
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    ...props,
  };
  act(() => root.render(<MobilePromptDialog {...merged} />));
  return { host, root, merged };
}

test('the prompt confirms the trimmed name and stays inside the app', () => {
  const { host, root, merged } = renderDialog();

  const dialog = host.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.getAttribute('aria-modal')).toBe('true');
  expect(host.querySelector('input')?.value).toBe('Knoux X Mobile Slideshow');

  const input = host.querySelector('input') as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '  KNOUX QA  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Create')?.click());

  expect(merged.onConfirm).toHaveBeenCalledWith('KNOUX QA');
  expect((merged.onConfirm as jest.Mock).mock.calls[0][0]).not.toBe('  KNOUX QA  ');
  act(() => root.unmount());
  host.remove();
});

test('cancelling reports the cancellation instead of a name', () => {
  const { host, root, merged } = renderDialog();

  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')?.click());

  expect(merged.onCancel).toHaveBeenCalledTimes(1);
  expect(merged.onConfirm).not.toHaveBeenCalled();
  act(() => root.unmount());
  host.remove();
});

test('a closed prompt renders nothing at all', () => {
  const { host, root } = renderDialog({ open: false });

  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.unmount());
  host.remove();
});
