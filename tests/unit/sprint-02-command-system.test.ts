/** @jest-environment jsdom */

import { createSprint02CommandRuntime, SPRINT_02_SURFACES } from '../../src/core/commands/sprint02CommandSystem';

describe('Sprint 02 DOM action command runtime', () => {
  test('binds an actual DOM action to exactly one command trace and observable effect', async () => {
    document.body.innerHTML = '<div class="app-shell" data-current-view="player"><main><button aria-label="Play">Play</button></main></div>';
    const button = document.querySelector('button')!;
    let effects = 0;
    button.addEventListener('click', () => { effects += 1; button.setAttribute('aria-pressed', 'true'); });
    const runtime = createSprint02CommandRuntime(document.querySelector('.app-shell')!);
    runtime.refresh();
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(effects).toBe(1);
    expect(runtime.traces()).toHaveLength(1);
    expect(runtime.traces()[0]).toMatchObject({ actionId: 'player.play', command: 'dom.player.play', status: 'completed' });
    expect(runtime.inventory()[0]).toMatchObject({ click: 'command-bus', automated: true, manual: false, pass: true });
  });

  test('records disabled reason without dispatch', async () => {
    document.body.innerHTML = '<div class="app-shell" data-current-view="recording"><button disabled data-disabled-reason="Device Missing">Start</button></div>';
    const runtime = createSprint02CommandRuntime(document.querySelector('.app-shell')!);
    const record = runtime.inventory()[0];
    expect(record).toMatchObject({ page: 'Recorder', status: 'disabled', disabledReason: 'Device Missing', pass: true });
    document.querySelector<HTMLButtonElement>('button')!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.traces()).toHaveLength(0);
  });

  test('declares the complete fourteen-surface census', () => {
    expect(SPRINT_02_SURFACES).toHaveLength(14);
    expect(new Set(SPRINT_02_SURFACES).size).toBe(14);
  });
});
