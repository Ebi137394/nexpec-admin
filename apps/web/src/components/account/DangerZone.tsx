// ════════════════════════════════════════════════════════════════════════════
//  components/account/DangerZone.tsx — shared "Account & Privacy" settings block
//
//  Rendered at the tail of every non-admin portal's Settings page (Inspector,
//  Client — which also serves Agency + Enterprise — and Supplier). Admin /
//  Super Admin Settings do NOT render this (they must not have a self-service
//  delete). Pure navigation: the "Delete account" button links to the public
//  /account/delete page, which owns the confirm flow and calls the guarded
//  delete-account Edge Function. No deletion logic lives here.
//
//  Server-component-safe (no hooks, no client runtime).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';

export function DangerZone() {
  return (
    <section
      id="account-privacy"
      aria-labelledby="account-privacy-heading"
      className="scroll-mt-24"
    >
      {/* Section header */}
      <div className="mb-4 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-zinc-300" strokeWidth={1.75} />
        <div>
          <h2
            id="account-privacy-heading"
            className="font-display text-lg font-semibold tracking-tight text-white"
          >
            Account &amp; Privacy
          </h2>
          <p className="text-sm text-zinc-400">
            Manage your account security, privacy, and account deletion.
          </p>
        </div>
      </div>

      {/* Danger Zone card */}
      <div className="rounded-3xl border border-accent-red/30 bg-accent-red/[0.05] p-6">
        <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-tight text-white">
          <AlertTriangle className="h-5 w-5 text-accent-red" strokeWidth={1.75} />
          Delete account
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Permanently disable your NEXPEC account and remove personal profile
          information. Business, contractual, financial, inspection, dispute,
          and audit records may be retained where legally required.
        </p>
        <Link
          href="/account/delete"
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent-red/50 bg-accent-red/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-accent-red transition-colors hover:bg-accent-red hover:text-white"
        >
          Delete account
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
