import Link from 'next/link';
import type { AuditEvent } from '@/lib/data/audit';
import { EventTypeBadge, SeverityBadge } from './EventBadge';
import { cn } from '@/lib/cn';

interface AuditTableProps {
  events: AuditEvent[];
  selectedId?: string;
  currentSearch: string;
}

/**
 * Server-rendered audit table. Each row is a Link that adds
 * `?inspect=<event_id>` to the URL — that drives the detail drawer.
 * Using <Link> rather than onClick keeps the rows server-rendered and
 * gives us the back-button behaviour for free.
 */
export function AuditTable({ events, selectedId, currentSearch }: AuditTableProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No events match the current filters.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Clear the filters above or wait for the next mutation, every
          consequential change writes a row here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <th className="px-4 py-3 font-semibold">When</th>
            <th className="px-4 py-3 font-semibold">Event</th>
            <th className="px-4 py-3 font-semibold">Severity</th>
            <th className="px-4 py-3 font-semibold">Actor</th>
            <th className="px-4 py-3 font-semibold">Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {events.map((e) => (
            <Row
              key={e.id}
              event={e}
              active={e.id === selectedId}
              currentSearch={currentSearch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  event,
  active,
  currentSearch,
}: {
  event: AuditEvent;
  active: boolean;
  currentSearch: string;
}) {
  const params = new URLSearchParams(currentSearch);
  params.set('inspect', event.id);
  const href = `?${params.toString()}`;

  const actor = event.actor_label ?? event.actor_role ?? 'system';

  return (
    <tr
      className={cn(
        'group transition-colors',
        active ? 'bg-violet/10' : 'hover:bg-white/[0.03]',
      )}
    >
      <td className="whitespace-nowrap px-4 py-3 align-top">
        <Link href={href} replace scroll={false} className="block">
          <time className="font-mono text-xs text-zinc-400">
            {formatTimestamp(event.created_at)}
          </time>
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={href} replace scroll={false} className="block">
          <EventTypeBadge type={event.event_type} />
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={href} replace scroll={false} className="block">
          <SeverityBadge severity={event.severity} />
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 align-top">
        <Link href={href} replace scroll={false} className="block">
          <span className="text-sm text-zinc-200">{actor}</span>
          {event.actor_role && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
              {event.actor_role}
            </span>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={href} replace scroll={false} className="block">
          <p className="line-clamp-2 max-w-md text-sm text-zinc-300 group-hover:text-white">
            {event.summary}
          </p>
        </Link>
      </td>
    </tr>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  } catch {
    return iso;
  }
}
