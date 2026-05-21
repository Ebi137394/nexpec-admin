// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/DepartmentAuditPanel.tsx
//
//  Read-only "Recent activity" panel that materialises the audit trail
//  written by the department RPCs. Mounted only on the admin structure
//  page — clients don't get this view (their own changes show up here
//  for the super_admin to oversee).
//
//  Server Component: just formats the rows fetched server-side. No JS
//  payload is shipped to the client beyond what's needed to render.
// ════════════════════════════════════════════════════════════════════════════

import {
  Clock,
  UserPlus,
  UserMinus,
  Plus,
  Pencil,
  Move,
  Trash2,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react';

import type { DepartmentAuditEvent } from '@/lib/data/orgStructure.types';

interface Props {
  events: DepartmentAuditEvent[];
}

const EVENT_META: Record<
  string,
  { label: string; icon: LucideIcon; tone: 'violet' | 'cyan' | 'rose' | 'amber' | 'neutral' }
> = {
  'department.created':           { label: 'Created',    icon: Plus,       tone: 'violet'  },
  'department.renamed':           { label: 'Renamed',    icon: Pencil,     tone: 'cyan'    },
  'department.moved':             { label: 'Moved',      icon: Move,       tone: 'amber'   },
  'department.deleted':           { label: 'Deleted',    icon: Trash2,     tone: 'rose'    },
  'department_member.assigned':   { label: 'Assigned',   icon: UserPlus,   tone: 'violet'  },
  'department_member.unassigned': { label: 'Unassigned', icon: UserMinus,  tone: 'neutral' },
};

export function DepartmentAuditPanel({ events }: Props) {
  if (events.length === 0) {
    return (
      <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
        <Header />
        <p className="mt-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-xs text-zinc-500">
          No structural changes have been recorded for this organization yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <Header count={events.length} />
      <ol className="mt-4 space-y-2">
        {events.map((e) => (
          <Row key={e.id} event={e} />
        ))}
      </ol>
      {events.length >= 50 && (
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
          Showing the 50 most recent entries · older events live in /admin/audit
        </p>
      )}
    </section>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight text-white">
        <Clock className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
        Recent activity
        {typeof count === 'number' && count > 0 && (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {count}
          </span>
        )}
      </h2>
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        Super-admin oversight
      </p>
    </header>
  );
}

function Row({ event }: { event: DepartmentAuditEvent }) {
  const meta = EVENT_META[event.event_type] ?? {
    label: event.event_type,
    icon: CircleAlert,
    tone: 'neutral' as const,
  };
  const Icon = meta.icon;

  const toneClass =
    meta.tone === 'violet'
      ? 'bg-violet/15 text-violet-glow ring-violet/30'
      : meta.tone === 'cyan'
        ? 'bg-cyan-glow/10 text-cyan-glow ring-cyan-glow/30'
        : meta.tone === 'rose'
          ? 'bg-rose-500/10 text-rose-200 ring-rose-400/30'
          : meta.tone === 'amber'
            ? 'bg-amber-400/10 text-amber-200 ring-amber-400/30'
            : 'bg-white/[0.04] text-zinc-300 ring-white/[0.08]';

  const severityBadge =
    event.severity === 'warning'
      ? 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200'
      : event.severity === 'critical'
        ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
        : null;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${toneClass}`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            {meta.label}
          </span>
          <span className="text-zinc-200">{event.summary}</span>
          {severityBadge && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial ${severityBadge}`}
            >
              {event.severity}
            </span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-500">
          <span>
            {event.actor_label ?? 'Unknown actor'}
            {event.actor_role && (
              <span className="ml-1 rounded border border-white/[0.06] bg-white/[0.02] px-1 py-px text-[9px] uppercase tracking-industrial text-zinc-400">
                {event.actor_role}
              </span>
            )}
          </span>
          <span>·</span>
          <time dateTime={event.created_at} title={event.created_at}>
            {formatRelative(event.created_at)}
          </time>
          {event.correlation_id && (
            <>
              <span>·</span>
              <span className="truncate" title={event.correlation_id}>
                corr {event.correlation_id.slice(0, 8)}
              </span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * Lightweight relative-time formatter that doesn't pull in date-fns.
 * Server-rendered so we don't ship the runtime to the client.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const m = Math.round(diffSec / 60);
    return `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.round(diffSec / 3600);
    return `${h}h ago`;
  }
  if (diffSec < 604800) {
    const d = Math.round(diffSec / 86400);
    return `${d}d ago`;
  }
  // Fall back to a short date.
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
