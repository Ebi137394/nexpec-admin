import React, { createContext, useContext, ReactNode } from 'react';

interface ThemeContextType {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// ── MVP: opinionated DARK-ONLY ────────────────────────────────────────────────
//  Brand identity is deep navy (#020420) + violet (#7C3AED). The light theme was
//  only ever wired on the Profile screen, so a toggle left every other screen
//  dark — a broken-looking setting that erodes trust. Locked to dark: isDarkMode
//  is pinned `true`, storage is NOT consulted (any previously-saved 'light' is
//  ignored, so no screen regresses), and the toggle UI was removed from Profile
//  + Settings. `toggleTheme` is a no-op kept only for API compatibility with
//  existing consumers (e.g. profile.tsx still reads isDarkMode for styling).
//  A proper token-based light / high-contrast theme (notably inspector
//  field/sunlight readability) is future roadmap, not MVP.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ isDarkMode: true, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
