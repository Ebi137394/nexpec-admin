import { Building2, Users, Globe, Mail } from 'lucide-react';
import type { AdminOrg } from '@/lib/data/organizations';
import { cn } from '@/lib/cn';

interface OrgsTableProps {
  orgs: AdminOrg[];
  tableMissing?: boolean;
}

export function OrgsTable({ orgs, tableMissing }: OrgsTableProps) {
  if (tableMissing) {
    return (
      <div className="rounded-2xl border border-dashed border-violet/30 bg-violet/[0.04] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          The organizations schema isn&apos;t live yet.
        </p>
        <p className="mt-2 mx-auto max-w-md text-pretty text-sm text-zinc-400">
          Run the migration{' '}
          <code className="font-mono text-violet-glow">
            supabase/migrations/20260521120000_organizations_and_members.sql
          </code>{' '}
          in the Supabase SQL editor. RLS policies grant super_admin full
          read; members see their own org only.
        </p>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No organizations yet.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Organisations are seeded by the upcoming admin invitation flow
          (Sprint 4). Until then this surface stays empty by design.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {orgs.map((org) => (
        <Card key={org.id} org={org} />
      ))}
    </div>
  );
}

function Card({ org }: { org: AdminOrg }) {
  const accent =
    org.kind === 'agency'
      ? 'bg-cyan-glow/10 text-cyan-glow ring-cyan-glow/30'
      : 'bg-violet/15 text-violet-glow ring-violet/30';

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5 transition-all hover:-translate-y-0.5 hover:border-violet/40',
        !org.is_active && 'opacity-60',
      )}
    >
      <header className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${accent}`}>
          <Building2 className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base font-semibold text-white">
              {org.name}
            </h3>
            {!org.is_active && (
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-400">
                inactive
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <span>{org.kind}</span>
            {org.slug && (
              <>
                <span>·</span>
                <span className="font-mono">{org.slug}</span>
              </>
            )}
          </p>
        </div>
      </header>

      <dl className="mt-5 space-y-2.5 text-xs">
        <Row icon={<Users className="h-3.5 w-3.5" />} label="Members">
          <span className="font-mono">{org.member_count}</span>
        </Row>
        {org.owner_name || org.owner_email ? (
          <Row icon={<Mail className="h-3.5 w-3.5" />} label="Owner">
            <span className="truncate">
              {org.owner_name ?? org.owner_email}
            </span>
          </Row>
        ) : null}
        {org.contact_email && (
          <Row icon={<Mail className="h-3.5 w-3.5" />} label="Contact">
            <span className="truncate font-mono">{org.contact_email}</span>
          </Row>
        )}
        {org.website_url && (
          <Row icon={<Globe className="h-3.5 w-3.5" />} label="Web">
            <a
              href={org.website_url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-violet-glow hover:text-white"
            >
              {org.website_url}
            </a>
          </Row>
        )}
      </dl>
    </article>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 text-zinc-300">
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          {label}
        </span>
        <span className="truncate text-right">{children}</span>
      </div>
    </div>
  );
}
