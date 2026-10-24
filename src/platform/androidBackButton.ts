import { useAppStore, type ViewType } from '../store/appStore';

import { markAndroidBridgeAbsent } from './androidBridgeHealth';

/**
 * Android hardware/system back-button policy for KNOUX X.
 *
 * The Capacitor `App` plugin disables the platform default (finish activity) as
 * soon as a `backButton` listener is registered. This controller therefore owns
 * the complete policy:
 *
 *   1. Close the floating AI assistant.
 *   2. Close the mobile navigation drawer.
 *   3. Leave document fullscreen.
 *   4. Let the top-most screen interceptor consume the press (modals, guards).
 *   5. Navigate to the previously visited view.
 *   6. At the root view, require a second press within 2s before exiting.
 *
 * Reaching the root view clears the visited-view stack: the root is the
 * bottom of the Android back stack, so Back there always means "exit".
 *
 * The controller is deliberately framework-agnostic and receives its platform
 * effects through a context so that it can be verified without a device.
 */

export type AndroidBackInterceptor = () => boolean | Promise<boolean>;

export interface AndroidBackButtonContext {
  getCurrentView(): ViewType;
  setView(view: ViewType): void;
  isAIAssistantOpen(): boolean;
  closeAIAssistant(): void;
  isDrawerOpen(): boolean;
  closeDrawer(): void;
  isFullscreen(): boolean;
  exitFullscreen(): Promise<void>;
  notify(message: string): void;
  exitApp(): Promise<void>;
  now(): number;
  log(decision: string): void;
}

export interface AndroidBackButtonController {
  handleBackPress(): Promise<void>;
  recordViewChange(previous: ViewType, next: ViewType): void;
  registerInterceptor(handler: AndroidBackInterceptor): () => void;
  resetState(): void;
}

export const EXIT_CONFIRMATION_WINDOW_MS = 2_000;
export const VIEW_HISTORY_LIMIT = 25;
/** The Android root view. Reaching it starts a fresh back stack. */
export const ROOT_VIEW: ViewType = 'home';
/**
 * The controller speaks one language so its decisions stay greppable in the
 * device log; the native install layer is the only place that localizes it for
 * the user.
 */
export const BACK_TO_EXIT_MESSAGE = 'Press back again to exit KNOUX X';
const BACK_TO_EXIT_MESSAGE_AR = 'اضغط زر الرجوع مرة أخرى للخروج من KNOUX X';

interface InterceptorEntry {
  id: number;
  handler: AndroidBackInterceptor;
}

export function createAndroidBackButtonController(
  context: AndroidBackButtonContext,
): AndroidBackButtonController {
  const interceptors: InterceptorEntry[] = [];
  const viewHistory: ViewType[] = [];
  let nextInterceptorId = 1;
  let exitArmedUntil = 0;
  let handling = false;
  let suppressHistoryPush = false;

  return {
    recordViewChange(previous: ViewType, next: ViewType): void {
      if (previous === next) return;
      if (suppressHistoryPush) {
        suppressHistoryPush = false;
        return;
      }
      /* The root view is the bottom of the Android back stack. Reaching it by
       * any route (the in-app "Back to home" control, a restored session, a
       * deep link) starts a fresh stack, so the next hardware Back arms the
       * exit confirmation instead of teleporting back to a screen the user
       * left long ago. */
      if (next === ROOT_VIEW) {
        viewHistory.length = 0;
        return;
      }
      viewHistory.push(previous);
      if (viewHistory.length > VIEW_HISTORY_LIMIT) {
        viewHistory.splice(0, viewHistory.length - VIEW_HISTORY_LIMIT);
      }
    },

    registerInterceptor(handler: AndroidBackInterceptor): () => void {
      const entry: InterceptorEntry = { id: nextInterceptorId, handler };
      nextInterceptorId += 1;
      interceptors.push(entry);
      return () => {
        const index = interceptors.findIndex((item) => item.id === entry.id);
        if (index >= 0) interceptors.splice(index, 1);
      };
    },

    async handleBackPress(): Promise<void> {
      // Rapid repeat presses must never re-enter the policy while a
      // save/guard interceptor is still resolving.
      if (handling) {
        context.log('ignored-reentrant');
        return;
      }
      handling = true;
      try {
        if (context.isAIAssistantOpen()) {
          context.closeAIAssistant();
          context.log('ai-assistant-closed');
          return;
        }

        if (context.isDrawerOpen()) {
          context.closeDrawer();
          context.log('drawer-closed');
          return;
        }

        if (context.isFullscreen()) {
          try {
            await context.exitFullscreen();
          } catch (error) {
            console.warn('[KNOUX] Fullscreen exit failed during back navigation.', error);
          }
          context.log('fullscreen-exited');
          return;
        }

        for (let index = interceptors.length - 1; index >= 0; index -= 1) {
          const entry = interceptors[index];
          try {
            if (await entry.handler()) {
              context.log('interceptor-consumed');
              return;
            }
          } catch (error) {
            console.warn('[KNOUX] Android back interceptor failed; continuing policy.', error);
          }
        }

        const previous = viewHistory.pop();
        const current = context.getCurrentView();
        if (previous && previous !== current) {
          suppressHistoryPush = true;
          context.setView(previous);
          context.log(`navigated-back:${previous}`);
          return;
        }

        const now = context.now();
        if (now < exitArmedUntil) {
          exitArmedUntil = 0;
          context.log('exit-app');
          await context.exitApp();
          return;
        }

        exitArmedUntil = now + EXIT_CONFIRMATION_WINDOW_MS;
        context.notify(BACK_TO_EXIT_MESSAGE);
        context.log('exit-armed');
      } finally {
        handling = false;
      }
    },

    resetState(): void {
      interceptors.length = 0;
      viewHistory.length = 0;
      nextInterceptorId = 1;
      exitArmedUntil = 0;
      handling = false;
      suppressHistoryPush = false;
    },
  };
}

let installedController: AndroidBackButtonController | null = null;
let installedDispose: (() => void) | null = null;

/**
 * Components with an open modal/dialog or an unsaved-work guard register here.
 * The most recently registered interceptor is asked first. Returning `true`
 * consumes the press; returning `false` lets the global policy continue.
 *
 * Outside the Android native runtime this is a no-op so that desktop code can
 * register unconditionally.
 */
export function registerAndroidBackInterceptor(handler: AndroidBackInterceptor): () => void {
  if (!installedController) return () => undefined;
  return installedController.registerInterceptor(handler);
}

export interface AndroidBackButtonRuntime {
  addListener(
    eventName: 'backButton',
    listenerFunc: (event: { canGoBack?: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
  exitApp?(): Promise<void>;
  minimizeApp?(): Promise<void>;
}

function resolveBridgePlugin(): AndroidBackButtonRuntime | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.Capacitor;
  if (!bridge || bridge.getPlatform?.() !== 'android') return null;
  if (bridge.isNativePlatform && bridge.isNativePlatform() === false) return null;
  return (bridge.Plugins?.App as AndroidBackButtonRuntime | undefined) ?? null;
}

/**
 * Installs the single native listener (idempotent) and keeps the controller
 * synchronized with the zustand view store. No listener is ever registered
 * for desktop/web-preview runtimes.
 */
export function installAndroidBackButton(): () => void {
  if (installedDispose) return installedDispose;

  const plugin = resolveBridgePlugin();
  if (!plugin || typeof plugin.addListener !== 'function') {
    console.warn(
      '[KNOUX] @capacitor/app backButton runtime is unavailable; hardware back keeps the platform default.',
    );
    markAndroidBridgeAbsent(
      'back-button',
      'The Capacitor App plugin is not in this build, so hardware back keeps the platform default.',
    );
    return () => undefined;
  }

  const controller = createAndroidBackButtonController({
    getCurrentView: () => useAppStore.getState().currentView,
    setView: (view) => useAppStore.getState().setView(view),
    isAIAssistantOpen: () => useAppStore.getState().isAIAssistantOpen,
    closeAIAssistant: () => {
      const state = useAppStore.getState();
      if (state.isAIAssistantOpen) state.toggleAIAssistant();
    },
    isDrawerOpen: () => useAppStore.getState().isMobileMenuOpen,
    closeDrawer: () => useAppStore.getState().setMobileMenuOpen(false),
    isFullscreen: () =>
      typeof document !== 'undefined' && document.fullscreenElement != null,
    exitFullscreen: async () => {
      if (
        typeof document !== 'undefined' &&
        typeof document.exitFullscreen === 'function' &&
        document.fullscreenElement != null
      ) {
        await document.exitFullscreen();
      }
    },
    notify: (message) => {
      const state = useAppStore.getState();
      state.addNotification({
        type: 'info',
        title: 'KNOUX X',
        message: state.locale === 'ar' && message === BACK_TO_EXIT_MESSAGE
          ? BACK_TO_EXIT_MESSAGE_AR
          : message,
        duration: EXIT_CONFIRMATION_WINDOW_MS,
      });
    },
    exitApp: async () => {
      if (typeof plugin.exitApp === 'function') {
        try {
          await plugin.exitApp();
          return;
        } catch (error) {
          console.warn('[KNOUX] App.exitApp failed; trying minimizeApp.', error);
        }
      }
      if (typeof plugin.minimizeApp === 'function') await plugin.minimizeApp();
    },
    now: () => Date.now(),
    log: (decision) => console.info('KNOUX_ANDROID_BACK_DECISION', decision),
  });

  installedController = controller;
  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    controller.recordViewChange(previous.currentView, state.currentView);
  });

  let listenerHandle: { remove(): Promise<void> } | null = null;
  let disposed = false;
  const registration = plugin.addListener('backButton', () => {
    void controller.handleBackPress();
  });
  void Promise.resolve(registration)
    .then((handle) => {
      if (disposed) {
        void handle.remove().catch(() => undefined);
        return;
      }
      listenerHandle = handle;
    })
    .catch((error: unknown) => {
      console.warn('[KNOUX] Failed to register the Android back-button listener.', error);
    });

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribeStore();
    if (listenerHandle) void listenerHandle.remove().catch(() => undefined);
    if (installedController === controller) installedController = null;
    if (installedDispose === dispose) installedDispose = null;
  };

  installedDispose = dispose;
  console.info('KNOUX_ANDROID_BACK_LISTENER_READY');
  return dispose;
}
