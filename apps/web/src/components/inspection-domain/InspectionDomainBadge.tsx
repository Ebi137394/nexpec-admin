// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/inspection-domain/InspectionDomainBadge.tsx
//
//  Web counterpart of src/components/shared/InspectionDomainBadge.tsx
//  on mobile. Both files import the slug list, labels, and iconKey
//  from `@nexpec/shared-core` — neither hardcodes the taxonomy.
//
//  See the mobile file's header for the gating contract; behaviour is
//  identical here.
// ════════════════════════════════════════════════════════════════════════════

import {
  Shield,
  Building2,
  Zap,
  Wrench,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import {
  getInspectionDomainMeta,
  type InspectionDomainIconKey,
} from '@nexpec/shared-core';

const ICON_BY_KEY: Record<InspectionDomainIconKey, LucideIcon> = {
  shield: Shield,
  building: Building2,
  zap: Zap,
  wrench: Wrench,
  flask: FlaskConical,
};

export interface InspectionDomainBadgeProps {
  domain: string | null | undefined;
  showAlways?: boolean;
  /**
   * Strict mode for inspector / consumer surfaces. Renders ONLY when
   * `domain ∈ launchedDomains` and `domain !== 'industrial_ndt'`.
   */
  requireLaunched?: boolean;
  /** Active launched-domain slugs. Ignored unless `requireLaunched` is true. */
  launchedDomains?: readonly string[];
  size?: 'sm' | 'md';
  className?: string;
}

export function InspectionDomainBadge({
  domain,
  showAlways = false,
  requireLaunched = false,
  launchedDomains,
  size = 'sm',
  className,
}: InspectionDomainBadgeProps) {
  if (!domain) return null;

  const meta = getInspectionDomainMeta(domain);
  if (!meta) return null;

  if (meta.slug === 'industrial_ndt' && !showAlways) return null;

  if (requireLaunched) {
    const launched = launchedDomains ?? [];
    if (!launched.includes(meta.slug)) return null;
    if (meta.slug === 'industrial_ndt') return null;
  }

  const Icon = ICON_BY_KEY[meta.iconKey];
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
      aria-label={`Inspection domain: ${meta.label}`}
    >
      <Icon
        className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'}
        strokeWidth={2}
        aria-hidden
      />
      {meta.label}
    </span>
  );
}
