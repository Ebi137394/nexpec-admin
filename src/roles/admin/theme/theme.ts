// lib/super-admin/theme.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared theme constants for the Super Admin UI.
// Single source of truth — every screen imports from here.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SA = {
  bg:            '#020420',
  surface:       '#0B0F2E',
  surfaceLight:  '#111638',
  border:        '#1A1F3D',
  accent:        '#6C5CE7',
  accentSoft:    'rgba(108,92,231,0.12)',
  success:       '#00D68F',
  successSoft:   'rgba(0,214,143,0.12)',
  warning:       '#FFAA00',
  warningSoft:   'rgba(255,170,0,0.12)',
  danger:        '#FF4757',
  dangerSoft:    'rgba(255,71,87,0.12)',
  info:          '#0095FF',
  infoSoft:      'rgba(0,149,255,0.12)',
  text:          '#FFFFFF',
  textSec:       '#8B8FA3',
  textMuted:     '#4A4F6A',
  radius:        14,
  radiusSm:      10,
} as const;

// ★ Task 4: input is integer CENTS — divide by 100 before format.
export const currency = (cents: number | null | undefined): string => {
  if (cents == null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

export const ago = (iso: string): string => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

export const statusColor = (status: string): string => {
  switch (status) {
    case 'completed': case 'approved': case 'paid': return SA.success;
    case 'in_progress': case 'assigned': case 'on_site': case 'active': return SA.info;
    case 'pending': case 'requested': case 'draft': case 'processing': return SA.warning;
    case 'cancelled': case 'rejected': case 'disputed': return SA.danger;
    default: return SA.textMuted;
  }
};