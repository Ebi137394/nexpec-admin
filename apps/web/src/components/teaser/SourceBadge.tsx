// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/SourceBadge.tsx — polymorphic source badge (RSC)
//
//  One pill, four kinds — the ecosystem-depth signal for the public feed.
//  Demand: Client Job / Enterprise Mission / Agency Tender. Supply: Vetted
//  Talent (agency-affiliated or independent — affiliation is never shown).
// ════════════════════════════════════════════════════════════════════════════
import { Building2, ShieldCheck, Users, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type SourceKind =
  | 'client_job'
  | 'enterprise_mission'
  | 'agency_tender'
  | 'inspector';

const MAP: Record<SourceKind, { label: string; tone: string; Icon: LucideIcon }> = {
  client_job: {
    label: 'Client Job',
    tone: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
    Icon: UserRound,
  },
  enterprise_mission: {
    label: 'Enterprise Mission',
    tone: 'border-violet/50 bg-violet/10 text-violet-glow',
    Icon: Building2,
  },
  agency_tender: {
    label: 'Agency Tender',
    tone: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
    Icon: Users,
  },
  inspector: {
    label: 'Vetted Talent',
    tone: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
    Icon: ShieldCheck,
  },
};

export function SourceBadge({ kind, className }: { kind: SourceKind; className?: string }) {
  const c = MAP[kind] ?? MAP.client_job;
  const Icon = c.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial',
        c.tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {c.label}
    </span>
  );
}
