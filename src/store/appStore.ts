import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewType =
  | 'player'
  | 'library'
  | 'capture'
  | 'recording'
  | 'editor'
  | 'export'
  | 'settings';
export type ThemeType = 'light' | 'dark' | 'auto';
export type LocaleType = 'en' | 'ar';

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
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      accentColor: '#8b5cf6',
      setAccentColor: (color) => set({ accentColor: color }),
      locale: 'en',
      setLocale: (locale) => set({ locale }),
      isAIAssistantOpen: false,
      toggleAIAssistant: () => set((state) => ({ isAIAssistantOpen: !state.isAIAssistantOpen })),
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
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
      partialize: (state) => ({
        theme: state.theme,
        accentColor: state.accentColor,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
      }),
    },
  ),
);
