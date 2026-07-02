// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrity/internal-threads/page.tsx — Super Admin Integrity Monitor
//
//  God-mode, READ-ONLY oversight of the private agency/org INTERNAL team threads
//  (Ghost Mode). The admin is NOT a participant: the DB blocks any admin post
//  (RESTRICTIVE policy + ghost-aware send_message), the notify fan-out never
//  signals the admin, and there is no composer here. Ghost reads are ZERO-TRACE —
//  no audit write, even in the backend.
//
//  Server component; reads run as super_admin via admin-gated SECURITY DEFINER RPCs.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { fetchInternalThreads } from '@/lib/data/integrityMonitor';
import { InternalThreadViewer } from './InternalThreadViewer';

export const metadata: Metadata = { title: 'Integrity Monitor' };
export const dynamic = 'force-dynamic';

export default async function InternalThreadsMonitorPage() {
  const threads = await fetchInternalThreads();

  return (
    <div className="space-y-6">
      <header>
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-300/80">
          <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
          Ghost Mode · Integrity Monitor
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Internal team threads
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Silent, read-only oversight of agency teams&rsquo; private per-mission rooms for
          platform integrity and safety. Teams cannot see you here, and you cannot post —
          your monitoring leaves no trace.
        </p>
      </header>

      {/* Ghost-mode assurance banner */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-violet-500/[0.06] px-5 py-4 ring-1 ring-violet-400/20">
        <span className="flex items-center gap-2 text-sm font-medium text-violet-200">
          <Lock className="h-4 w-4" strokeWidth={2} /> You are invisible to the team
        </span>
        <span className="flex items-center gap-2 text-sm text-zinc-300">
          <ShieldCheck className="h-4 w-4 text-emerald-400" strokeWidth={2} /> Posting is blocked at the database
        </span>
        <span className="flex items-center gap-2 text-sm text-zinc-300">
          <EyeOff className="h-4 w-4 text-amber-400" strokeWidth={2} /> Monitoring leaves no trace
        </span>
      </div>

      <InternalThreadViewer threads={threads} />
    </div>
  );
}
