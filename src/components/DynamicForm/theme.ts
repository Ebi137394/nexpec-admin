// src/components/DynamicForm/theme.ts

export const NEXPEC_THEME = {
  colors: {
    background: '#020420',
    primary: '#7C3AED',
    primaryLight: '#8B5CF6',
    primaryDark: '#6D28D9',
    inputBackground: '#0F172A',
    inputBorder: '#1E293B',
    inputBorderFocus: '#7C3AED',
    text: '#FFFFFF',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    error: '#EF4444',
    errorBackground: '#FEE2E2',
    success: '#10B981',
    overlay: 'rgba(0, 0, 0, 0.7)',
    cardBackground: '#0F172A',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  borderRadius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
  },
} as const;