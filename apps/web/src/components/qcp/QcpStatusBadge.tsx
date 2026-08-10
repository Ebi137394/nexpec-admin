// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpStatusBadge.tsx — one revision state, said once
//
//  Status lives on the REVISION, never on the plan (§2: "A QCP is an
//  identity"). Every QCP surface renders state through this component so the
//  four states cannot acquire four different colour schemes and two different
//  vocabularies across the list, the detail page and the history.
//
//  Server-safe: no state, no effects, no client boundary. Presentational
//  components in this directory are deliberately surface-agnostic — the Admin
//  pages mount them today and an org-scoped Enterprise surface can mount the
//  same ones without a fork.
// ════════════════════════════════════════════════════════════════════════════

import { CircleDashed, Eye, ShieldCheck, Archive } from 'lucide-react';
import {
  QCP_STATUS_LABELS,
  type QcpRevisionStatus,
} from '@/lib/data/qcp';

const TONE: Record<QcpRevisionStatus, string> = {
  draft: 'bg-white/[0.04] text-zinc-300 ring-white/[0.08]',
  under_review: 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
  approved: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
  superseded: 'bg-white/[0.03] text-zinc-500 ring-white/[0.06]',
};

const ICON: Record<QcpRevisionStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  under_review: Eye,
  approved: ShieldCheck,
  superseded: Archive,
};

export function QcpStatusBadge({
  status,
  revisionNo,
  className = '',
}: {
  status: QcpRevisionStatus;
  /** Shown inline when given — "Rev 3 · Approved" reads better than two chips. */
  revisionNo?: number | null;
  className?: string;
}) {
  const Icon = ICON[status];
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] ring-1 ring-inset ' +
        TONE[status] +
        (className ? ` ${className}` : '')
      }
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {typeof revisionNo === 'number' ? `Rev ${revisionNo} · ` : ''}
      {QCP_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The "this is the plan in force" marker.
 *
 * Separate from the status badge on purpose. A revision can be approved and
 * still not be the one you are looking at, and a reader who sees only a green
 * "Approved" chip on revision 2 while revision 3 is the effective one has been
 * told something true and misleading at the same time.
 */
export function QcpEffectiveBadge({ effective }: { effective: boolean }) {
  if (!effective) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] text-violet-300 ring-1 ring-inset ring-violet-500/20">
      <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
      Effective revision
    </span>
  );
}

/**
 * The immutability marker, drawn wherever an edit control would otherwise sit.
 *
 * §2 makes approved and superseded rows immutable with a trigger. Saying so
 * where the button used to be is the honest version of hiding the button.
 */
export function QcpImmutableNote({ status }: { status: QcpRevisionStatus }) {
  if (status === 'draft' || status === 'under_review') return null;
  return (
    <p className="text-[11px] leading-relaxed text-zinc-600">
      {status === 'approved'
        ? 'This revision is approved and immutable — the database rejects any edit to it. Amending the plan means issuing the next revision, which starts as a draft and supersedes this one only when it is itself approved.'
        : 'This revision was superseded by a later approved one. It is kept, not deleted, because the audit trail is the point of an append-preserving model.'}
    </p>
  );
}
