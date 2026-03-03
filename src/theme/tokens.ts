// src/theme/tokens.ts

export const DarkTheme = {
  // Base
  background: "#020617",       // slate-950
  surface: "#0F172A",          // slate-900
  surfaceElevated: "#1E293B",  // slate-800
  surfaceMuted: "#334155",     // slate-700

  // Text
  textPrimary: "#F8FAFC",      // slate-50
  textSecondary: "#94A3B8",    // slate-400
  textMuted: "#64748B",        // slate-500
  textInverse: "#020617",      // slate-950

  // Accent
  accentPrimary: "#3B82F6",    // blue-500
  accentSuccess: "#22C55E",    // green-500
  accentWarning: "#F59E0B",    // amber-500
  accentDanger: "#EF4444",     // red-500
  accentInfo: "#06B6D4",       // cyan-500

  // Status-specific backgrounds (10% opacity versions)
  statusActiveBg: "rgba(59, 130, 246, 0.1)",
  statusSuccessBg: "rgba(34, 197, 94, 0.1)",
  statusWarningBg: "rgba(245, 158, 11, 0.1)",
  statusDangerBg: "rgba(239, 68, 68, 0.1)",
  statusPendingBg: "rgba(148, 163, 184, 0.1)",

  // Borders
  border: "#1E293B",
  borderFocused: "#3B82F6",

  // Shadows
  shadowColor: "#000000",

  // Spacing (base 4)
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  // Radius
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  // Typography
  font: {
    sizes: {
      xs: 11,
      sm: 13,
      md: 15,
      lg: 17,
      xl: 20,
      xxl: 24,
      display: 32,
    },
    weights: {
      regular: "400" as const,
      medium: "500" as const,
      semibold: "600" as const,
      bold: "700" as const,
    },
  },
} as const;

export type Theme = typeof DarkTheme;