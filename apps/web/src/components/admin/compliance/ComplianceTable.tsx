import Link from 'next/link';
import { ShieldCheck, ShieldAlert, Clock3, Ban, ChevronRight } from 'lucide-react';
import type { ComplianceCredential, CredentialStatus } from '@/lib/data/compliance';
import { cn } from '@/lib/cn';

interface ComplianceTableProps {
  credentials: ComplianceCredential[];
  tableMissing?: boolean;
  selectedId?: string | null;
}

export function ComplianceTable({ credentials, tableMissing, selectedId }: ComplianceTableProps) {
  if (tableMissing) {
    return (
      <div className="rounded-2xl border border-dashed border-cyan-glow/30 bg-cyan-glow/[0.04] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          inspector_credentials table not detected.
        </p>
        <p className="mt-2 mx-auto max-w-md text-pretty text-sm text-zinc-400">
          The Phase α compliance-mode foundation migration creates this
          table. Run{' '}
          <code className="font-mono text-cyan-glow">
            20260514100000_compliance_mode_foundation.sql
          </code>{' '}
          if it hasn&apos;t been applied yet.
        </p>
      </div>
    );
  }
  if (credentials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No credentials match this filter.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Adjust the status filter, or wait for the next CCI submission.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <th className="px-4 py-3 font-semibold">Inspector</th>
            <th className="px-4 py-3 font-semibold">Tier</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Gov ID</th>
            <th className="px-4 py-3 font-semibold">Experience (yrs)</th>
            <th className="px-4 py-3 font-semibold">Applied</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {credentials.map((c) => {
            const active = c.id === selectedId;
            const href = `?inspect=${c.id}`;
            return (
              <tr
                key={c.id}
                className={cn(
                  'group transition-colors',
                  active ? 'bg-cyan-glow/5' : 'hover:bg-white/[0.03]',
                )}
              >
                <td className="px-4 py-3 align-middle">
                  <Link href={href} replace scroll={false} className="block">
                    <p className="truncate text-sm font-medium text-white">
                      {c.inspector_name ?? c.inspector_email ?? c.inspector_id ?? '—'}
                    </p>
                    {c.inspector_email && c.inspector_name && (
                      <p className="truncate font-mono text-[10px] text-zinc-500">
                        {c.inspector_email}
                      </p>
                    )}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle">
                  <Link href={href} replace scroll={false}>
                    <span className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 font-mono text-xs text-zinc-300">
                      {c.tier ?? '—'}
                    </span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle">
                  <Link href={href} replace scroll={false}>
                    <StatusBadge status={c.status} />
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle">
                  <Link href={href} replace scroll={false}>
                    {c.gov_id_verified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-industrial text-accent-green">
                        <ShieldCheck className="h-3 w-3" />
                        verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
                        <ShieldAlert className="h-3 w-3" />
                        unverified
                      </span>
                    )}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle font-mono text-sm text-zinc-300">
                  <Link href={href} replace scroll={false}>
                    {c.experience_years_documented ?? '—'}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle">
                  <Link
                    href={href}
                    replace
                    scroll={false}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-xs text-zinc-400">
                      {formatDate(c.applied_at)}
                    </span>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 transition-colors',
                        active ? 'text-cyan-glow' : 'text-zinc-600 group-hover:text-zinc-300',
                      )}
                    />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: CredentialStatus }) {
  const map = {
    pending: {
      icon: <Clock3 className="h-3 w-3" />,
      classes: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
    },
    approved: {
      icon: <ShieldCheck className="h-3 w-3" />,
      classes: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
    },
    suspended: {
      icon: <Ban className="h-3 w-3" />,
      classes: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
    },
    rejected: {
      icon: <Ban className="h-3 w-3" />,
      classes: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
    },
  } as const;
  const entry = (map as Record<string, { icon: React.ReactNode; classes: string }>)[
    status
  ] ?? {
    icon: null,
    classes: 'border-white/15 bg-white/[0.04] text-zinc-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial',
        entry.classes,
      )}
    >
      {entry.icon}
      {status}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
