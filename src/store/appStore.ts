import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { KnouxThemeId } from '../theme/knouxThemeCatalog';

export type ViewType =
  | 'player'
  | 'library'
  | 'queue'
  | 'capture'
  | 'recording'
  | 'editor'
  | 'image-editor'
  | 'export'
  | 'settings';
export type ThemeType = KnouxThemeId;
export type LocaleType = 'en' | 'ar';
export type SidebarMode = 'expanded' | 'compact';

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
  motionEnabled: boolean;
  setMotionEnabled(enabled: boolean): void;
  notifications: AppNotification[];
  addNotification(notification: Omit<AppNotification, 'id'>): void;
  removeNotification(id: string): void;
  isLoading: boolean;
  setLoading(loading: boolean): void;
  loadingMessage: string;
  setLoadingMessage(message: string): void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentView: 'player',
      setView: (view) => set({ currentView: view }),
      theme: 'deep-black',
      setTheme: (theme) => set({ theme }),
      accentColor: '#8b5cf6',
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
    }),
    {
      name: 'knoux-app-store',
      version: 4,
      partialize: (state) => ({
        theme: state.theme,
        accentColor: state.accentColor,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
        sidebarMode: state.sidebarMode,
        sidebarWidth: state.sidebarWidth,
        motionEnabled: state.motionEnabled,
      }),
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as Partial<AppState> & { theme?: string };
        const legacyThemes: Record<string, ThemeType> = {
          dark: 'deep-black',
          light: 'system-light',
          auto: 'system-dark',
        };
        return {
          ...state,
          theme: legacyThemes[state.theme ?? ''] ?? (state.theme as ThemeType | undefined) ?? 'deep-black',
        } as AppState;
      },
    },
  ),
);
