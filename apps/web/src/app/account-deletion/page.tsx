// ════════════════════════════════════════════════════════════════════════════
//  /account-deletion — PUBLIC account deletion request page
//
//  Reachable without a session, as app-store policy requires. The signed-in
//  self-service flow at /account/delete is unchanged and still the fastest
//  route for users who can log in; this page serves everyone who cannot.
//
//  Mirrors the /contact pattern: server action + search-param-driven state,
//  no client JS.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, Scale, Clock, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/marketing/Footer';
import { submitAccountDeletion } from '@/lib/actions/accountDeletion';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

// Server action submission + search-param-driven UI state.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NEXPEC Account Deletion Request',
  description:
    'Request deletion of your NEXPEC account and associated personal data. Open to everyone, no sign-in required.',
  alternates: { canonical: `${SITE_URL}/account-deletion` },
  openGraph: {
    title: 'NEXPEC Account Deletion Request',
    description:
      'Request deletion of your NEXPEC account and associated personal data.',
    url: `${SITE_URL}/account-deletion`,
    siteName: 'NEXPEC',
    type: 'website',
  },
};

function Field({
  label, name, type = 'text', required = false, placeholder,
}: {
  label: string; name: string; type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-violet/50 focus:outline-none"
      />
    </div>
  );
}

export default async function AccountDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const sent = sp.sent === '1';
  const error = sp.error;

  return (
    <div className="min-h-screen bg-[#07060D] text-white">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-accent-violet">
          Privacy
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          NEXPEC Account Deletion Request
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-400">
          You can request deletion of your NEXPEC account and the personal data
          associated with it. This page is open to everyone and does not require
          you to sign in. If you can still access your account, the fastest route
          is{' '}
          <Link href="/account/delete" className="text-accent-violet underline underline-offset-4">
            in-app deletion
          </Link>
          , which removes your account immediately.
        </p>

        {/* ── What happens ───────────────────────────────────────────── */}
        <section className="mt-10 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-accent-violet" />
            What happens to your data
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-400">
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-violet" />
              <span>
                <span className="text-zinc-200">Account profile data is deleted.</span> Your
                profile, credentials and sign-in identity are removed, and the account can no
                longer be used.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-violet" />
              <span>
                <span className="text-zinc-200">Personal information is removed</span> wherever it
                is not required to be kept, including contact details and profile content.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-violet" />
              <span>
                <span className="text-zinc-200">Uploaded documents and user-generated data</span>{' '}
                (reports, photos, messages and attachments) are handled according to the retention
                requirements that apply to the work they belong to.
              </span>
            </li>
          </ul>
        </section>

        {/* ── Retention ──────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-accent-amber/20 bg-accent-amber/[0.04] p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Scale className="h-5 w-5 text-accent-amber" />
            Records we may need to keep
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Some records are retained after deletion where we are required or permitted to keep
            them — for <span className="text-zinc-200">legal and regulatory</span> obligations,{' '}
            <span className="text-zinc-200">security and fraud prevention</span>, and{' '}
            <span className="text-zinc-200">financial and tax compliance</span> (for example
            completed inspection records, signed agreements, and transaction history). These are
            kept only for as long as the applicable requirement demands, and are not used to
            re-create your account.
          </p>
        </section>

        {/* ── Timeframe ──────────────────────────────────────────────── */}
        <section className="mt-6 flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
          <p className="text-sm leading-6 text-zinc-400">
            Requests are reviewed and processed within a reasonable timeframe. We may contact you
            at the email address you provide to verify ownership of the account before we act on
            the request.
          </p>
        </section>

        {/* ── Form ───────────────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Submit a deletion request</h2>

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <p className="text-sm text-zinc-300">{error}</p>
            </div>
          )}

          {sent ? (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/5 p-5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
              <div>
                <p className="font-medium text-white">Request received.</p>
                <p className="mt-1 text-sm text-zinc-400">
                  We&apos;ve logged your deletion request. Our team reviews these and may email you
                  to confirm you own the account before processing it. If you need to add anything,
                  reply to that email or write to privacy@nexpecapp.com.
                </p>
              </div>
            </div>
          ) : (
            <form action={submitAccountDeletion} className="mt-5 space-y-5">
              <Field
                label="Email address"
                name="email"
                type="email"
                required
                placeholder="you@company.com"
              />

              <div>
                <label
                  htmlFor="accountType"
                  className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                >
                  Account type
                </label>
                <select
                  id="accountType"
                  name="accountType"
                  required
                  defaultValue="client"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-accent-violet/50 focus:outline-none"
                >
                  <option value="client">Client</option>
                  <option value="inspector">Inspector</option>
                  <option value="senior">Senior Inspector</option>
                  <option value="agency">Agency</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="supplier">Supplier</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="message"
                  className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                >
                  Message (optional)
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={4}
                  placeholder="Anything we should know about this request."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-violet/50 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-accent-violet px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-violet/90 sm:w-auto"
              >
                Submit deletion request
              </button>
            </form>
          )}

          <p className="mt-6 text-xs leading-5 text-zinc-500">
            Questions about privacy? See our{' '}
            <Link href="/legal/privacy" className="underline underline-offset-4 hover:text-zinc-300">
              Privacy Policy
            </Link>{' '}
            or email privacy@nexpecapp.com.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
