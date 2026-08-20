// ════════════════════════════════════════════════════════════════════════════
//  app/pending-verification/page.tsx — the waiting room
//
//  Where an inspector, agency or supplier lands between signing up and being
//  activated by NEXPEC (migration 20260801584000). Choosing an account type at
//  signup does not confer it: the database refuses applications, job posts,
//  contracts, reports and commercial messages from a pending account outright.
//
//  This page exists so that refusal is an explanation rather than a dashboard
//  full of buttons that error when pressed. Everything a pending account CAN
//  still do — complete the profile, upload verification documents, contact
//  NEXPEC — is linked from here.
//
//  Already-activated users are bounced to their real destination, so the page
//  cannot become a dead end for someone who was approved while reading it.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Verification in progress — NEXPEC',
  description: 'Your NEXPEC account is being reviewed by our verification team.',
};

export const dynamic = 'force-dynamic';

const GATED_ROLES = new Set(['inspector', 'agency', 'supplier']);

//  Routes here MUST also appear in PENDING_ALLOWED_PATHS in middleware.ts,
//  otherwise the middleware bounces the user straight back to this page.
const ROLE_COPY: Record<
  string,
  { noun: string; profileHref: string; documentsHref: string; documentsHint: string; unlocks: string[] }
> = {
  inspector: {
    noun: 'Inspector',
    profileHref: '/inspector/settings',
    documentsHref: '/inspector/compliance',
    documentsHint: 'Certifications, tickets, insurance and right-to-work.',
    unlocks: [
      'Apply to inspection jobs on the marketplace',
      'Sign contracts and be dispatched to site',
      'Submit inspection reports for senior review',
      'See your earnings and request payment release',
    ],
  },
  agency: {
    noun: 'Agency',
    profileHref: '/client/settings',
    documentsHref: '/client/documents',
    documentsHint: 'Company registration, insurance and trading references.',
    unlocks: [
      'Post operational inspection jobs',
      'Review and select inspectors for your jobs',
      'Sign contracts on behalf of your organization',
      'Access organization finance and invoicing',
    ],
  },
  supplier: {
    noun: 'Supplier',
    profileHref: '/suppliers/profile',
    documentsHref: '/suppliers/documents',
    documentsHint: 'Company registration, quality accreditations and insurance.',
    unlocks: [
      'Respond to quote requests from buyers',
      'Publish your capability catalogue to the marketplace',
      'Sign supply contracts',
      'Access supplier finance and settlement',
    ],
  },
};

export default async function PendingVerificationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, marketplace_activated')
    .eq('id', user.id)
    .maybeSingle();

  const role = (profile?.role ?? '').toString().trim().toLowerCase();
  const activation = (profile as { marketplace_activated?: boolean } | null)
    ?.marketplace_activated;

  // Approved, or a role that was never gated: this page has nothing to say.
  if (!GATED_ROLES.has(role) || activation !== false) redirect('/');

  const copy = ROLE_COPY[role] ?? {
    noun: 'Account',
    profileHref: '/',
    documentsHref: '/',
    documentsHint: '',
    unlocks: [],
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 dark:border-amber-900/40 dark:bg-amber-950/20">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-500">
          Verification in progress
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {profile?.full_name
            ? `Thanks, ${profile.full_name.split(' ')[0]} — we're reviewing your ${copy.noun} account`
            : `We're reviewing your ${copy.noun} account`}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-700 dark:text-slate-300">
          Every {copy.noun.toLowerCase()} on NEXPEC is verified by our team before
          they can trade. Buyers rely on that, which is why it is a person and
          not an automated check. You will receive an email as soon as a decision
          is made.
        </p>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          What you can do now
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link
            href={copy.profileHref}
            className="rounded-xl border border-slate-200 p-5 transition hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600"
          >
            <p className="font-medium text-slate-900 dark:text-slate-100">
              Complete your profile
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              A complete profile is reviewed faster.
            </p>
          </Link>
          <Link
            href={copy.documentsHref}
            className="rounded-xl border border-slate-200 p-5 transition hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600"
          >
            <p className="font-medium text-slate-900 dark:text-slate-100">
              Upload verification documents
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {copy.documentsHint}
            </p>
          </Link>
        </div>
      </section>

      {copy.unlocks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            What unlocks once you are approved
          </h2>
          <ul className="mt-4 space-y-2">
            {copy.unlocks.map((item) => (
              <li
                key={item}
                className="flex gap-3 text-slate-700 dark:text-slate-300"
              >
                <span aria-hidden className="text-slate-400">
                  &middot;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Something not right, or taking longer than you expected?{' '}
          <Link href="/contact" className="font-medium underline underline-offset-4">
            Contact NEXPEC
          </Link>
          . Support is available to you while your account is pending.
        </p>
      </section>
    </main>
  );
}
