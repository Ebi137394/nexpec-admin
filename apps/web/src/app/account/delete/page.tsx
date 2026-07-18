// ════════════════════════════════════════════════════════════════════════════
//  app/account/delete/page.tsx — public account-deletion page
//
//  WHY THIS EXISTS. Google Play's account-deletion policy requires a web URL
//  where users can delete their account WITHOUT reinstalling the app; Apple
//  5.1.1(v) requires in-app deletion (already shipped in the mobile Security
//  screen). This page is the web counterpart and the URL to paste into the
//  Play Console data-safety form.
//
//  SECURITY MODEL — deliberately NO new deletion endpoint:
//    · The page is publicly viewable but deletion executes only for an
//      AUTHENTICATED session, by invoking the existing `delete-account`
//      Edge Function (Bearer JWT → guarded request_account_deletion() RPC
//      → auth ban). One deletion path, one set of guards.
//    · Signing in IS the identity verification. No email-entry form exists
//      here, so the page can never be used to probe whether an address has
//      an account (no enumeration surface).
//    · Business guards (active jobs / unsettled wallet balance) surface as
//      readable reasons; nothing is force-deleted around an open contract.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, Scale, LifeBuoy } from 'lucide-react';
import { DeleteAccountFlow } from './DeleteAccountFlow';

export const metadata: Metadata = {
  title: 'Delete your NEXPEC account',
  description:
    'Request permanent deletion of your NEXPEC account and associated personal data. Works from any browser, no app install required.',
  alternates: { canonical: '/account/delete' },
  robots: { index: true, follow: true },
};

export default function DeleteAccountPage() {
  return (
    <article>
      <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
        NEXPEC account
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Delete your account
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-400">
        You can permanently delete your NEXPEC account from this page in any
        browser — no app install required. Deletion is immediate and cannot be
        undone. You can also do this inside the mobile app under{' '}
        <span className="text-zinc-200">Profile → Security → Delete account</span>.
      </p>

      {/* What deletion does */}
      <section className="mt-10 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6">
        <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold text-white">
          <ShieldCheck className="h-5 w-5 text-cyan-glow" strokeWidth={1.75} />
          What gets deleted
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          When your request is accepted, your personal data — name, email,
          phone, photo, bio, CV and other identifying profile details — is
          permanently anonymized, your uploaded personal documents stop being
          accessible, and your login is permanently disabled. Your account
          cannot be recovered afterwards.
        </p>
      </section>

      {/* Legally required retention */}
      <section className="mt-4 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6">
        <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold text-white">
          <Scale className="h-5 w-5 text-violet-glow" strokeWidth={1.75} />
          What we must keep, and why
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Some records are retained in de-identified form where the law
          requires it: financial transactions, invoices and tax records
          (bookkeeping and tax legislation), signed contracts and dispute
          records (contract-law limitation periods), and platform audit logs
          (fraud prevention and security). These records no longer contain
          your name or contact details. Full details are in our{' '}
          <Link href="/legal/privacy" className="text-violet-glow underline hover:text-white">
            Privacy Policy
          </Link>
          .
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          If you have active jobs or an unsettled balance, deletion is paused
          until those are closed out — this protects both sides of an ongoing
          engagement. The steps below will tell you if that applies to you.
        </p>
      </section>

      {/* The actual flow (client component — sign-in gated) */}
      <section className="mt-4 rounded-3xl border border-accent-red/25 bg-accent-red/[0.04] p-6">
        <h2 className="font-display text-lg font-semibold text-white">
          Request deletion
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          To verify it&apos;s really you, sign in first — then confirm below.
          We never accept deletion requests by bare email address, so nobody
          can request deletion of an account that isn&apos;t theirs.
        </p>
        <div className="mt-5">
          <DeleteAccountFlow />
        </div>
      </section>

      {/* Support */}
      <section className="mt-4 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6">
        <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold text-white">
          <LifeBuoy className="h-5 w-5 text-cyan-glow" strokeWidth={1.75} />
          Can&apos;t sign in?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          If you no longer have access to your login, first use{' '}
          <Link href="/forgot-password" className="text-violet-glow underline hover:text-white">
            password reset
          </Link>
          . If that doesn&apos;t work,{' '}
          <Link href="/contact?channel=support&topic=account-deletion" className="text-violet-glow underline hover:text-white">
            contact support
          </Link>{' '}
          and we&apos;ll verify your identity manually before processing the
          deletion. For any privacy question, see the{' '}
          <Link href="/legal/privacy" className="text-violet-glow underline hover:text-white">
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
