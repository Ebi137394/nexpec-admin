// ============================================================
// NEXPEC Client Theme Constants
// Premium Dark Mode Palette
// ============================================================

export const CLIENT_THEME = {
  // ── Backgrounds ──────────────────────────────────────────
  bg:             '#020617',
  card:           '#0F172A',
  cardElevated:   '#1E293B',
  surface:        '#0B1120',

  // ── Borders ──────────────────────────────────────────────
  border:         '#1E293B',
  borderLight:    '#334155',

  // ── Typography ───────────────────────────────────────────
  textPrimary:    '#F8FAFC',
  textSecondary:  '#94A3B8',
  textMuted:      '#64748B',
  textInverse:    '#020617',
  white:          '#FFFFFF',

  // ── Accents ──────────────────────────────────────────────
  blue:           '#3B82F6',
  blueDim:        '#1E3A5F',
  green:          '#10B981',
  greenDim:       '#064E3B',
  red:            '#EF4444',
  redDim:         '#7F1D1D',
  amber:          '#F59E0B',
  amberDim:       '#78350F',
  purple:         '#8B5CF6',
  purpleDim:      '#4C1D95',
  cyan:           '#06B6D4',
  cyanDim:        '#164E63',

  // ── Pipeline Stage Colors ────────────────────────────────
  stagePending:     '#F59E0B',
  stageInProgress:  '#3B82F6',
  stageReviewing:   '#8B5CF6',
  stageFinalized:   '#10B981',

  // ── Spacing / Radius ────────────────────────────────────
  radiusSm:   8,
  radiusMd:   12,
  radiusLg:   16,
  radiusXl:   20,
} as const;

export type ClientTheme = typeof CLIENT_THEME;