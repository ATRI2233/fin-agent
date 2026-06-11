/**
 * useUiStore - Global UI state for fin-agent WebUI.
 *
 * Manages cross-cutting UI state (sidebar, theme, active route) and persists it
 * to `localStorage` so the user's choices survive a page reload.
 *
 * @example
 *   const collapsed = useUiStore((s) => s.sidebarCollapsed);
 *   const toggle    = useUiStore((s) => s.toggleSidebar);
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Shape of the UI store: state slices + action mutators. */
export interface UiState {
  /** Whether the left sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Whether dark mode is active. */
  darkMode: boolean;
  /** Current router pathname (mirrors `react-router-dom` location). */
  currentRoute: string;

  /** Flip the sidebar collapsed flag. */
  toggleSidebar: () => void;
  /** Force the sidebar collapsed flag to a specific value. */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Flip the dark-mode flag. */
  toggleDarkMode: () => void;
  /** Force the dark-mode flag to a specific value. */
  setDarkMode: (dark: boolean) => void;
  /** Update the cached current route. */
  setCurrentRoute: (route: string) => void;
}

/** localStorage key used by the `persist` middleware. */
export const UI_STORAGE_KEY = 'fin-agent-ui';

/**
 * Global UI store hook.
 *
 * Persisted slices: `sidebarCollapsed`, `darkMode`, `currentRoute`.
 * Actions are intentionally NOT persisted (zustand default `partialize`).
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      darkMode: true,
      currentRoute: '/',

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      setDarkMode: (dark) => set({ darkMode: dark }),

      setCurrentRoute: (route) => set({ currentRoute: route }),
    }),
    {
      name: UI_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export default useUiStore;
