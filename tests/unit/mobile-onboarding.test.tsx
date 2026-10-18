/** @jest-environment jsdom */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MobileOnboarding, ONBOARDING_KEY } from '../../src/components/mobile/MobileOnboarding';
import { useAppStore } from '../../src/store/appStore';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => <span>KNOUX X</span> }));

test('first-run Skip persists completion, later boots stay dismissed, replay remains available in Arabic', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  useAppStore.setState({ locale: 'en' });
  const host = document.createElement('div'); document.body.appendChild(host);
  let root = createRoot(host);
  act(() => root.render(<MobileOnboarding />));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Skip')?.click());
  expect(localStorage.getItem(ONBOARDING_KEY)).toBe('complete');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<MobileOnboarding />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => { useAppStore.setState({ locale: 'ar' }); root.render(<MobileOnboarding replay />); });
  // A fresh replay instance intentionally initializes its own visible state.
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<MobileOnboarding replay />));
  expect(host.querySelector('[dir="rtl"]')).not.toBeNull();
  expect(host.textContent).toContain('أهلًا');
  act(() => root.unmount()); host.remove();
});
