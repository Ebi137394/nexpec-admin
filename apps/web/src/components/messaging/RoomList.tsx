// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/RoomList.tsx — render a list of conversations
//
//  Shared by client / inspector / admin pages. `linkBase` differs per role:
//    /client/messages    /inspector/messages    /admin/messages
//
//  Server component — no interactivity needed for the list itself; clicking
//  a row is a plain <Link>.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { MessageCircle, ShieldCheck, Briefcase, ChevronRight, HardHat, Building2, Store } from 'lucide-react';
import type { ConversationRow, ConversationKind } from '@/lib/data/conversations.types';
import { CONVERSATION_KIND_LABELS } from '@/lib/data/conversations.types';

interface Props {
  rooms: ConversationRow[];
  /** Base href; the room id is appended as the last segment. */
  linkBase: string;
  /** When the viewer is admin, show the counterparty's name + unread_for_admin. */
  viewerIsAdmin?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

export function RoomList({
  rooms,
  linkBase,
  viewerIsAdmin = false,
  emptyTitle = 'No conversations yet',
  emptyBody = 'Open a Help & Support room or start a job-scoped chat.',
}: Props) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-10 text-center">
        <MessageCircle
          className="mx-auto h-8 w-8 text-zinc-600"
          strokeWidth={1.5}
        />
        <p className="mt-3 text-sm font-medium text-zinc-300">{emptyTitle}</p>
        <p className="mt-1 text-xs text-zinc-500">{emptyBody}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
      {rooms.map((r) => {
        const unread = viewerIsAdmin ? r.unreadForAdmin : r.unreadForUser;
        const Icon = r.kind === 'help_support' ? ShieldCheck : Briefcase;
        const subtitle = r.jobTitle
          ? r.jobTitle
          : CONVERSATION_KIND_LABELS[r.kind];
        // Guard against missing/null id — without this we'd render
        // href={linkBase}/undefined which navigates to a 404 and looks
        // like "click does nothing" to the user.
        if (!r.id) return null;
        const href = `${linkBase}/${r.id}`;
        const partyChip = viewerIsAdmin ? deriveAdminPartyChip(r.kind, r.userRole) : null;
        return (
          <li key={r.id} className="relative">
            {/* Stretched link wraps the whole row. position:absolute + inset-0
                so the entire row surface is clickable, including the explicit
                "Open" affordance on the right. We render an additional
                visible "Open" CTA so users without JS or with hydration
                hiccups still see and reach an obvious entry point. */}
            <Link
              href={href}
              aria-label={`Open conversation: ${r.title || CONVERSATION_KIND_LABELS[r.kind]}`}
              className="absolute inset-0 z-10 rounded-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet/50"
            >
              <span className="sr-only">Open</span>
            </Link>
            <div className="pointer-events-none flex items-start gap-3 px-4 py-4 transition-colors hover:bg-white/[0.02] sm:px-5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {viewerIsAdmin && partyChip && <PartyChip chip={partyChip} />}
                    <p className="truncate text-sm font-semibold text-white">
                      {viewerIsAdmin
                        ? r.userLabel ?? '(no name on file)'
                        : r.title || CONVERSATION_KIND_LABELS[r.kind]}
                    </p>
                  </div>
                  <p className="shrink-0 text-[11px] text-zinc-500">
                    {formatRelative(r.lastMessageAt)}
                  </p>
                </div>
                {/* Admin view: show "Client · Help & Support" or
                    "Inspector · Job: foo" so the operator can tell rooms apart
                    without opening them. */}
                {viewerIsAdmin ? (
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {partyChip ? partyChip.contextLabel : CONVERSATION_KIND_LABELS[r.kind]}
                    {r.jobTitle ? (
                      <>
                        {' · '}
                        <span className="text-zinc-300">Job: {r.jobTitle}</span>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {subtitle}
                  </p>
                )}
                {r.lastMessagePreview && (
                  <p className="mt-1 line-clamp-1 text-[12px] text-zinc-400">
                    {r.lastMessagePreview}
                  </p>
                )}
              </div>
              {unread > 0 && (
                <span className="mt-1 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-violet px-1.5 text-[10px] font-semibold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              <span className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-3 text-[11px] font-semibold text-violet-glow">
                Open
                <ChevronRight className="h-3 w-3" strokeWidth={2} />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ─── party chip — only shown to admins so they can tell who's writing ── */

interface AdminPartyChip {
  label: string;        // "Client" | "Inspector" | "Support"
  contextLabel: string; // "Direct support" | "Job chat · client side" etc.
  tone: 'violet' | 'cyan' | 'amber';
  Icon: typeof Building2;
}

function deriveAdminPartyChip(
  kind: ConversationKind,
  userRole: string | null,
): AdminPartyChip {
  if (kind === 'job_client_admin') {
    return {
      label: 'Client',
      contextLabel: 'Client side · job chat',
      tone: 'violet',
      Icon: Building2,
    };
  }
  if (kind === 'job_inspector_admin') {
    return {
      label: 'Inspector',
      contextLabel: 'Inspector side · job chat',
      tone: 'cyan',
      Icon: HardHat,
    };
  }
  if (kind === 'job_supplier_admin') {
    return {
      label: 'Supplier',
      contextLabel: 'Supplier side · job chat',
      tone: 'amber',
      Icon: Store,
    };
  }
  // help_support — kind alone doesn't tell us who's writing. Use the joined
  // profile role to differentiate (a Help & Support room from a CLIENT looks
  // different from one from an INSPECTOR).
  const role = (userRole ?? '').toLowerCase();
  if (role === 'inspector') {
    return {
      label: 'Inspector',
      contextLabel: 'Inspector · Help & Support',
      tone: 'cyan',
      Icon: HardHat,
    };
  }
  if (role === 'client' || role === 'agency' || role === 'enterprise') {
    return {
      label: 'Client',
      contextLabel: 'Client · Help & Support',
      tone: 'violet',
      Icon: Building2,
    };
  }
  return {
    label: 'Support',
    contextLabel: 'Direct help & support',
    tone: 'amber',
    Icon: ShieldCheck,
  };
}

function PartyChip({ chip }: { chip: AdminPartyChip }) {
  const cls =
    chip.tone === 'violet'
      ? 'border-violet/30 bg-violet/10 text-violet-glow'
      : chip.tone === 'cyan'
        ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
        : 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${cls}`}
    >
      <chip.Icon className="h-2.5 w-2.5" strokeWidth={2} />
      {chip.label}
    </span>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString();
}
