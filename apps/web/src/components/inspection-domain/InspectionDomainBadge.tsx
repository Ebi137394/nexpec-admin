// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/inspection-domain/InspectionDomainBadge.tsx
//
//  Web counterpart of src/components/shared/InspectionDomainBadge.tsx
//  on mobile. Same render contract:
//
//    • Returns null for industrial_ndt unless showAlways=true.
//    • Returns null for unknown / null / undefined domains.
//    • Same visual language, sampled from the locked #7C3AED palette.
//
//  Pure presentation. Safe to mount anywhere — does nothing today,
//  starts surfacing per-job context the moment additional domains go
//  live.
// ════════════════════════════════════════════════════════════════════════════

import { Shield, Building2, Zap, Wrench, type LucideIcon } from 'lucide-react';

type DomainSlug =
  | 'industrial_ndt'
  | 'civil_construction'
  | 'electrical'
  | 'mechanical_field';

interface DomainMeta {
  label: string;
  Icon: LucideIcon;
}

const DOMAIN_META: Record<DomainSlug, DomainMeta> = {
  industrial_ndt: { label: 'Industrial & NDT', Icon: Shield },
  civil_construction: { label: 'Civil', Icon: Building2 },
  electrical: { label: 'Electrical', Icon: Zap },
  mechanical_field: { label: 'Mechanical', Icon: Wrench },
};

export interface InspectionDomainBadgeProps {
  domain: string | null | undefined;
  showAlways?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function InspectionDomainBadge({
  domain,
  showAlways = false,
  size = 'sm',
  className,
}: InspectionDomainBadgeProps) {
  if (!domain) return null;
  if (domain === 'industrial_ndt' && !showAlways) return null;

  const meta = DOMAIN_META[domain as DomainSlug];
  if (!meta) return null;

  const { Icon, label } = meta;
  const isSm = size === 'sm';

  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 ' +
        'bg-violet-500/[0.12] font-mono font-semibold uppercase tracking-[0.12em] ' +
        'text-violet-300 ' +
        (isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]') +
        (className ? ' ' + className : '')
      }
      role="img"
      aria-label={`Inspection domain: ${label}`}
    >
      <Icon
        className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'}
        strokeWidth={2}
        aria-hidden
      />
      {label}
    </span>
  );
}
