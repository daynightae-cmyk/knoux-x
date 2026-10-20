import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { KnouxThemeId } from '../theme/knouxThemeCatalog';
import {
  ANDROID_THEME_MIGRATION_VERSION,
  defaultThemeForRuntime,
  detectRuntimeEdition,
  resolvePersistedTheme,
} from '../theme/themeRuntime';

export {
  ANDROID_DEFAULT_THEME,
  ANDROID_THEME_MIGRATION_VERSION,
  DESKTOP_DEFAULT_THEME,
  defaultThemeForRuntime,
  detectRuntimeEdition,
  resolvePersistedTheme,
  type RuntimeEdition,
} from '../theme/themeRuntime';

export type ViewType =
  | 'home'
  | 'player'
  | 'library'
  | 'queue'
  | 'capture'
  | 'recording'
  | 'editor'
  | 'image-editor'
  | 'image-studio'
  | 'image-tools'
  | 'slideshow'
  | 'audio-tools'
  | 'export'
  | 'settings';
export type ThemeType = KnouxThemeId;
export type LocaleType = 'en' | 'ar';
export type SidebarMode = 'expanded' | 'compact';

export const PLATFORM_INITIAL_VIEWS = {
  desktop: { currentView: 'player' as ViewType },
  android: { currentView: 'home' as ViewType },
} as const;

export function initialViewForPlatform(platform: keyof typeof PLATFORM_INITIAL_VIEWS): ViewType {
  return PLATFORM_INITIAL_VIEWS[platform].currentView;
}

export interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration?: number;
}

export interface AppState {
  currentView: ViewType;
  setView(view: ViewType): void;
  theme: ThemeType;
  setTheme(theme: ThemeType): void;
  accentColor: string;
  setAccentColor(color: string): void;
  locale: LocaleType;
  setLocale(locale: LocaleType): void;
  isAIAssistantOpen: boolean;
  toggleAIAssistant(): void;
  isSidebarOpen: boolean;
  toggleSidebar(): void;
  sidebarMode: SidebarMode;
  setSidebarMode(mode: SidebarMode): void;
  sidebarWidth: number;
  setSidebarWidth(width: number): void;
  isMobileMenuOpen: boolean;
  setMobileMenuOpen(open: boolean): void;
  toggleMobileMenu(): void;
  motionEnabled: boolean;
  setMotionEnabled(enabled: boolean): void;
  notifications: AppNotification[];
  addNotification(notification: Omit<AppNotification, 'id'>): void;
  removeNotification(id: string): void;
  isLoading: boolean;
  setLoading(loading: boolean): void;
  loadingMessage: string;
  setLoadingMessage(message: string): void;
  isHomeReady: boolean;
  setHomeReady(ready: boolean): void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentView: initialViewForPlatform(detectRuntimeEdition()),
      setView: (view) => set({ currentView: view }),
      theme: defaultThemeForRuntime(detectRuntimeEdition()),
      setTheme: (theme) => set({ theme }),
      accentColor: '#7828e8',
      setAccentColor: (color) => set({ accentColor: color }),
      locale: 'en',
      setLocale: (locale) => set({ locale }),
      isAIAssistantOpen: false,
      toggleAIAssistant: () => set((state) => ({ isAIAssistantOpen: !state.isAIAssistantOpen })),
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      sidebarMode: 'expanded',
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      sidebarWidth: 252,
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.max(220, Math.min(360, sidebarWidth)) }),
      isMobileMenuOpen: false,
      setMobileMenuOpen: (isMobileMenuOpen) => set({ isMobileMenuOpen }),
      toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),
      motionEnabled: true,
      setMotionEnabled: (motionEnabled) => set({ motionEnabled }),
      notifications: [],
      addNotification: (notification) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => ({
          notifications: [...state.notifications, { ...notification, id }],
        }));
        if (notification.duration !== 0) {
          window.setTimeout(() => get().removeNotification(id), notification.duration ?? 5000);
        }
      },
      removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((notification) => notification.id !== id),
      })),
      isLoading: false,
      setLoading: (loading) => set({ isLoading: loading }),
      loadingMessage: '',
      setLoadingMessage: (message) => set({ loadingMessage: message }),
      isHomeReady: false,
      setHomeReady: (isHomeReady) => set({ isHomeReady }),
    }),
    {
      name: 'knoux-app-store',
      version: ANDROID_THEME_MIGRATION_VERSION,
      partialize: (state) => ({
        theme: state.theme,
        accentColor: state.accentColor,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
        sidebarMode: state.sidebarMode,
        sidebarWidth: state.sidebarWidth,
        motionEnabled: state.motionEnabled,
      }),
      migrate: (persistedState: unknown, persistedVersion: number) => {
        const state = (persistedState ?? {}) as Partial<AppState> & { theme?: string };
        return {
          ...state,
          isMobileMenuOpen: false,
          theme: resolvePersistedTheme(state.theme, detectRuntimeEdition(), persistedVersion),
        } as AppState;
      },
    },
  ),
);
