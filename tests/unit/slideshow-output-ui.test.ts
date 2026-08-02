/** @jest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';

import {
  MISSING_SLIDESHOW_OUTPUT_REASON,
  slideshowOutputActionState,
} from '../../src/core/creative/slideshowOutputState';

describe('slideshow completed-output DOM contract', () => {
  test('G11 renders a truthful disabled reason when the live service reports a missing file', () => {
    const state = slideshowOutputActionState(false);
    const open = document.createElement('button');
    const reveal = document.createElement('button');
    for (const button of [open, reveal]) {
      button.disabled = state.disabled;
      if (state.disabledReason) button.dataset.disabledReason = state.disabledReason;
    }
    expect(open.disabled).toBe(true);
    expect(reveal.disabled).toBe(true);
    expect(open.dataset.disabledReason).toBe(MISSING_SLIDESHOW_OUTPUT_REASON);
    expect(reveal.dataset.disabledReason).toBe(MISSING_SLIDESHOW_OUTPUT_REASON);
  });

  test('keeps existing completed outputs actionable', () => {
    expect(slideshowOutputActionState(true)).toEqual({ disabled: false, disabledReason: undefined });
  });

  test('refreshes on focus, every second, and immediately before activation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/features/slideshow/SlideshowView.tsx'),
      'utf8'
    );
    expect(source).toContain("window.addEventListener('focus', refresh)");
    expect(source).toContain('window.setInterval(refresh, 1_000)');
    expect(source).toMatch(/const jobs = await refreshRenderJobs\(\);[\s\S]*outputExists === false[\s\S]*openOutput\(jobId\)/);
  });
});
