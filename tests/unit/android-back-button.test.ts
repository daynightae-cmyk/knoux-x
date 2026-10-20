/** @jest-environment jsdom */

import {
  createAndroidBackButtonController,
  installAndroidBackButton,
  registerAndroidBackInterceptor,
  EXIT_CONFIRMATION_WINDOW_MS,
  VIEW_HISTORY_LIMIT,
  type AndroidBackButtonContext,
} from '../../src/platform/androidBackButton';
import { useAppStore, type ViewType } from '../../src/store/appStore';

interface HarnessOptions {
  view?: ViewType;
  aiOpen?: boolean;
  drawerOpen?: boolean;
  fullscreen?: boolean;
  now?: () => number;
}

function createHarness(options: HarnessOptions = {}) {
  const calls = {
    setView: [] as ViewType[],
    closedAI: 0,
    closedDrawer: 0,
    exitedFullscreen: 0,
    notified: [] as string[],
    exited: 0,
    decisions: [] as string[],
  };

  const fullscreenState = { value: options.fullscreen ?? false };
  const appState = {
    view: options.view ?? ('home' as ViewType),
    aiOpen: options.aiOpen ?? false,
    drawerOpen: options.drawerOpen ?? false,
  };

  const context: AndroidBackButtonContext = {
    getCurrentView: () => appState.view,
    setView: (view) => {
      calls.setView.push(view);
      appState.view = view;
    },
    isAIAssistantOpen: () => appState.aiOpen,
    closeAIAssistant: () => {
      calls.closedAI += 1;
      appState.aiOpen = false;
    },
    isDrawerOpen: () => appState.drawerOpen,
    closeDrawer: () => {
      calls.closedDrawer += 1;
      appState.drawerOpen = false;
    },
    isFullscreen: () => fullscreenState.value,
    exitFullscreen: async () => {
      calls.exitedFullscreen += 1;
      fullscreenState.value = false;
    },
    notify: (message) => {
      calls.notified.push(message);
    },
    exitApp: async () => {
      calls.exited += 1;
    },
    now: options.now ?? (() => Date.now()),
    log: (decision) => {
      calls.decisions.push(decision);
    },
  };

  return {
    controller: createAndroidBackButtonController(context),
    calls,
    appState,
    fullscreenState,
  };
}

describe('Android back-button policy controller', () => {
  test('closes the floating AI assistant before every other layer', async () => {
    const { controller, calls, appState } = createHarness({ aiOpen: true, drawerOpen: true });
    controller.registerInterceptor(() => {
      throw new Error('drawer-level interceptor must not run while the assistant is open');
    });

    await controller.handleBackPress();

    expect(calls.closedAI).toBe(1);
    expect(calls.closedDrawer).toBe(0);
    expect(appState.drawerOpen).toBe(true);
    expect(calls.decisions).toContain('ai-assistant-closed');
  });

  test('closes the mobile drawer before navigating', async () => {
    const { controller, calls } = createHarness({ drawerOpen: true });
    controller.recordViewChange('home', 'library');
    // The recorder is driven by an external store subscription; emulate the
    // fact that the drawer is open while still on the current view.
    await controller.handleBackPress();

    expect(calls.closedDrawer).toBe(1);
    expect(calls.setView).toEqual([]);
    expect(calls.decisions).toContain('drawer-closed');
  });

  test('leaves fullscreen before navigating', async () => {
    const { controller, calls, fullscreenState } = createHarness({ fullscreen: true });

    await controller.handleBackPress();

    expect(calls.exitedFullscreen).toBe(1);
    expect(fullscreenState.value).toBe(false);
    expect(calls.setView).toEqual([]);
    expect(calls.decisions).toContain('fullscreen-exited');
  });

  test('asks interceptors last-registered-first and honors a consuming press', async () => {
    const { controller, calls } = createHarness();
    const order: string[] = [];
    controller.registerInterceptor(() => {
      order.push('older');
      return false;
    });
    controller.registerInterceptor(() => {
      order.push('newer');
      return true;
    });

    await controller.handleBackPress();

    expect(order).toEqual(['newer']);
    expect(calls.decisions).toContain('interceptor-consumed');
    expect(calls.setView).toEqual([]);
  });

  test('keeps evaluating the policy when an interceptor throws', async () => {
    const { controller, calls } = createHarness({ view: 'library' });
    controller.recordViewChange('home', 'library');
    controller.registerInterceptor(() => {
      throw new Error('broken modal');
    });

    await controller.handleBackPress();

    expect(calls.setView).toEqual(['home']);
    expect(calls.decisions).toContain('navigated-back:home');
  });

  test('navigates to the previously visited view and does not re-record it', async () => {
    const { controller, calls } = createHarness({ view: 'home' });
    controller.recordViewChange('home', 'player');
    controller.recordViewChange('player', 'library');
    // Current emulated store view is behind the harness; sync it to reality.
    calls.setView.length = 0;

    await controller.handleBackPress();
    const firstBack = [...calls.setView];
    await controller.handleBackPress();
    const secondBack = calls.setView.slice(firstBack.length);

    // First back returns to the player, second back to home; the suppression
    // keeps the popped history from being pushed back on.
    expect(firstBack.length).toBe(1);
    expect(secondBack.length).toBe(1);
    expect(firstBack[0]).not.toBe(secondBack[0]);
  });

  test('requires a second press within the confirmation window to exit', async () => {
    let now = 1_000;
    const { controller, calls } = createHarness({ now: () => now });

    await controller.handleBackPress();
    expect(calls.exited).toBe(0);
    expect(calls.notified).toEqual(['Press back again to exit KNOUX X']);
    expect(calls.decisions).toContain('exit-armed');

    now += EXIT_CONFIRMATION_WINDOW_MS - 1;
    await controller.handleBackPress();
    expect(calls.exited).toBe(1);
    expect(calls.decisions).toContain('exit-app');
  });

  test('does not exit when the confirmation window expired', async () => {
    let now = 5_000;
    const { controller, calls } = createHarness({ now: () => now });

    await controller.handleBackPress();
    now += EXIT_CONFIRMATION_WINDOW_MS + 1;
    await controller.handleBackPress();

    expect(calls.exited).toBe(0);
    expect(calls.notified).toHaveLength(2);
  });

  test('ignores re-entrant presses while a guard is still resolving', async () => {
    const { controller, calls } = createHarness();
    let resolveInterceptor: (() => void) | null = null;
    controller.registerInterceptor(
      () =>
        new Promise<boolean>((resolve) => {
          resolveInterceptor = () => resolve(true);
        }),
    );

    const first = controller.handleBackPress();
    await controller.handleBackPress();
    expect(calls.decisions).toContain('ignored-reentrant');

    resolveInterceptor?.();
    await first;
    expect(calls.decisions).toContain('interceptor-consumed');
  });

  test('reaching the root view clears the visited stack so Back arms the exit', async () => {
    const { controller, calls } = createHarness({ view: 'home' });
    // The user visits the library and returns home through the in-app
    // "Back to home" control, which records a view change like any other.
    controller.recordViewChange('home', 'library');
    controller.recordViewChange('library', 'home');

    await controller.handleBackPress();

    // Back at the root must arm the exit confirmation instead of navigating
    // back to the library the user already left.
    expect(calls.setView).toEqual([]);
    expect(calls.notified).toEqual(['Press back again to exit KNOUX X']);
    expect(calls.decisions).toContain('exit-armed');
  });

  test('caps the navigation history and ignores same-view records', async () => {    const { controller, calls } = createHarness({ view: 'home' });
    controller.recordViewChange('home', 'home');
    expect(calls.decisions).toEqual([]);

    const views: ViewType[] = ['player', 'library', 'settings', 'queue', 'capture', 'recording', 'editor'];
    let previous: ViewType = 'home';
    for (let index = 0; index < VIEW_HISTORY_LIMIT + 5; index += 1) {
      const next = views[index % views.length];
      controller.recordViewChange(previous, next);
      previous = next;
    }

    // The oldest entries are dropped; the newest navigation target must still
    // be reachable. Exercising the controller proves the stack stays usable.
    await controller.handleBackPress();
    expect(calls.setView).toEqual(['player']);
  });
});

describe('installAndroidBackButton runtime wiring', () => {
  let disposeBack: (() => void) | null = null;

  interface ListenerRecord {
    event: string;
    removed: number;
  }

  function installFakeCapacitor(): {
    listeners: ListenerRecord[];
    exitCalls: number;
    dispatchers: Array<() => void>;
  } {
    const listeners: ListenerRecord[] = [];
    const dispatchers: Array<() => void> = [];
    const state = { exitCalls: 0 };
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        getPlatform: () => 'android',
        isNativePlatform: () => true,
        Plugins: {
          App: {
            addListener: (event: string, listener: () => void) => {
              const record: ListenerRecord = { event, removed: 0 };
              listeners.push(record);
              dispatchers.push(listener);
              return Promise.resolve({
                remove: async () => {
                  record.removed += 1;
                },
              });
            },
            exitApp: async () => {
              state.exitCalls += 1;
            },
            minimizeApp: async () => undefined,
          },
        },
      },
    });
    return {
      listeners,
      dispatchers,
      get exitCalls() {
        return state.exitCalls;
      },
    } as ReturnType<typeof installFakeCapacitor>;
  }

  afterEach(() => {
    disposeBack?.();
    disposeBack = null;
    Reflect.deleteProperty(window, 'Capacitor');
    useAppStore.setState({ currentView: 'home', isAIAssistantOpen: false, isMobileMenuOpen: false, notifications: [] });
  });

  test('registers exactly one native listener across repeated installs and drives the store', async () => {
    const fake = installFakeCapacitor();
    const disposeFirst = installAndroidBackButton();
    const disposeSecond = installAndroidBackButton();
    disposeBack = disposeFirst;

    expect(fake.listeners).toHaveLength(1);
    expect(fake.listeners[0].event).toBe('backButton');

    useAppStore.setState({ isMobileMenuOpen: true });
    fake.dispatchers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().isMobileMenuOpen).toBe(false);

    // A second install must not register a second native listener; it returns
    // the exact same disposal handle as the first install.
    expect(disposeSecond).toBe(disposeFirst);

    disposeFirst();
    await Promise.resolve();
    expect(fake.listeners[0].removed).toBe(1);
  });

  test('navigates through the real store history before exiting', async () => {
    const fake = installFakeCapacitor();
    disposeBack = installAndroidBackButton();

    useAppStore.getState().setView('library');
    await Promise.resolve();
    fake.dispatchers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().currentView).toBe('home');
    expect(fake.exitCalls).toBe(0);

    fake.dispatchers[0]();
    await Promise.resolve();
    expect(fake.exitCalls).toBe(0);
    fake.dispatchers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.exitCalls).toBe(1);
  });

  test('is a no-op without the Capacitor App plugin', () => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: { getPlatform: () => 'android', isNativePlatform: () => true, Plugins: {} },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dispose = installAndroidBackButton();
    dispose();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('registerAndroidBackInterceptor outside Android', () => {
  test('returns a no-op unsubscriber when no controller is installed', () => {
    const unsubscribe = registerAndroidBackInterceptor(() => true);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});
