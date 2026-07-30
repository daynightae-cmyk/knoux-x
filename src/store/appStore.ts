/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - App Store
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مخزن حالة التطبيق - إدارة حالة واجهة المستخدم
 * 
 * @module Store
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export type ViewType = 'player' | 'library' | 'settings';
export type ThemeType = 'light' | 'dark' | 'auto';

export interface AppState {
  // View
  currentView: ViewType;
  setView: (view: ViewType) => void;

  // Theme
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;

  // UI State
  isAIAssistantOpen: boolean;
  toggleAIAssistant: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;

  // Notifications
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;

  // Loading
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  loadingMessage: string;
  setLoadingMessage: (message: string) => void;
}

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// إنشاء المخزن
// ═══════════════════════════════════════════════════════════════════════════

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // View
      currentView: 'player',
      setView: (view) => set({ currentView: view }),

      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      accentColor: '#00f0ff',
      setAccentColor: (color) => set({ accentColor: color }),

      // UI State
      isAIAssistantOpen: false,
      toggleAIAssistant: () => set((state) => ({ isAIAssistantOpen: !state.isAIAssistantOpen })),
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

      // Notifications
      notifications: [],
      addNotification: (notification) => {
        const id = Date.now().toString();
        set((state) => ({
          notifications: [...state.notifications, { ...notification, id }],
        }));

        // Auto-remove after duration
        if (notification.duration !== 0) {
          setTimeout(() => {
            get().removeNotification(id);
          }, notification.duration || 5000);
        }
      },
      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      // Loading
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
        isSidebarOpen: state.isSidebarOpen,
      }),
    }
  )
);
