// ════════════════════════════════════════════════════════════════════════════
//  app/contact/page.tsx — Contact / Talk to sales
//
//  Two layers:
//    1. Three named-inbox cards (sales / support / security) for visitors
//       who prefer to email directly.
//    2. A real submission form below that writes to contact_submissions
//       via the submitContact server action (see lib/actions/contact.ts).
//
//  Success and error states are driven by ?sent=1 and ?error=... search
//  params. No client JS — server action handles the redirect dance.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, LifeBuoy, ShieldAlert, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/marketing/Footer';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { CONTACT_BANNER } from '@/lib/assets-manifest';
import { submitContact } from '@/lib/actions/contact';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

// Force dynamic — server action submission + search-param-driven UI state.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Talk to NEXPEC — sales, support, and responsible disclosure. Three named inboxes plus a direct form.',
  openGraph: {
    title: 'Contact NEXPEC',
    description:
      'Sales, support, and responsible disclosure. Vetted humans, named inboxes, no ticketing maze.',
    url: `${SITE_URL}/contact`,
    siteName: 'NEXPEC',
    type: 'website',
    images: [
      {
        url: '/og/contact.png',
        width: 1200,
        height: 630,
        alt: 'NEXPEC support — vetted operators standing by, worldwide.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact NEXPEC',
    description: 'Vetted humans, named inboxes, no ticketing maze.',
    images: ['/og/contact.png'],
  },
};

const CHANNELS = [
  {
    icon: Mail,
    label: 'Sales',
    email: 'sales@nexpecapp.com',
    body: 'Dispatching enterprise inspections, agency rollouts, custom integrations. Expect a reply within one business day.',
    tone: 'violet',
  },
  {
    icon: LifeBuoy,
    label: 'Support',
    email: 'support@nexpecapp.com',
    body: 'Active jobs, payment queries, account access. Available 7 days a week. Use in-app chat for fastest resolution.',
    tone: 'cyan',
  },
  {
    icon: ShieldAlert,
    label: 'Responsible disclosure',
    email: 'security@nexpecapp.com',
    body: 'Found a vulnerability? Email here with details. We acknowledge within 24 hours and follow the IETF security.txt standard.',
    tone: 'amber',
  },
] as const;

interface PageProps {
  searchParams: Promise<{
    sent?: string;
    error?: string;
    channel?: string;
  }>;
}

export default async function ContactPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const errorMsg = params.error;
  const initialChannel = ['sales', 'support', 'security'].includes(
    params.channel ?? '',
  )
    ? (params.channel as 'sales' | 'support' | 'security')
    : 'sales';

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 topo-grid opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-violet/20 blur-[110px]"
      />

      <header className="relative z-10 px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
          <Logo variant="wordmark" size="md" />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto w-full max-w-4xl">
          <p className="eyebrow">Contact</p>
          <h1 className="mt-3 text-balance font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Talk to a human.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-lg text-zinc-400">
            Three channels, three named addresses. Send a message below, or
            email the right inbox directly — we&apos;ll route from there.
          </p>

          {/* ── Banner image ─────────────────────────────────────────── */}
          <div className="relative mt-10 overflow-hidden rounded-3xl ring-1 ring-white/[0.06] shadow-[0_30px_80px_-30px_rgba(124,58,237,0.5)]">
            <ImagePlaceholder slot={CONTACT_BANNER} priority />
          </div>

          {/* ── Channel cards ────────────────────────────────────────── */}
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {CHANNELS.map((c) => (
              <article
                key={c.email}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/80 to-ink-900/60 p-6 transition-all hover:-translate-y-1 hover:border-violet/40 hover:shadow-[0_30px_60px_-30px_rgba(124,58,237,0.5)]"
              >
                <span
                  className={
                    c.tone === 'cyan'
                      ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30'
                      : c.tone === 'amber'
                        ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-amber/10 text-accent-amber ring-1 ring-inset ring-accent-amber/30'
                        : 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30'
                  }
                >
                  <c.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>

                <h2 className="mt-5 font-display text-lg font-semibold tracking-tight text-white">
                  {c.label}
                </h2>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-zinc-400">
                  {c.body}
                </p>
                <a
                  href={`mailto:${c.email}`}
                  className="mt-5 inline-flex items-center gap-2 font-mono text-sm text-violet-glow transition-colors hover:text-white"
                >
                  {c.email}
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </a>
              </article>
            ))}
          </div>

          {/* ── Direct form ──────────────────────────────────────────── */}
          <section
            id="form"
            className="mt-12 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-10"
          >
            <h2 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Send a message
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Goes straight to the right inbox. We reply from a real person,
              not a queue.
            </p>

            {sent ? (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/5 p-5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
                <div>
                  <p className="font-medium text-white">Message received.</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    We&apos;ll get back to you at the email you provided,
                    usually within one business day. If it&apos;s urgent,
                    the direct addresses above route to the same humans.
                  </p>
                </div>
              </div>
            ) : (
              <form action={submitContact} className="mt-8 space-y-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Your name" name="name" required placeholder="Alex Doe" />
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    required
                    placeholder="you@company.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="channel"
                    className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                  >
                    Route to
                  </label>
                  <select
                    id="channel"
                    name="channel"
                    required
                    defaultValue={initialChannel}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
                  >
                    <option value="sales">Sales — enterprise / agency / integrations</option>
                    <option value="support">Support — active jobs, payments, access</option>
                    <option value="security">Security — responsible disclosure</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                  >
                    Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    rows={6}
                    minLength={10}
                    maxLength={2000}
                    placeholder="Give us enough context to route this well."
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
                  />
                </div>

                {errorMsg && (
                  <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
                    {errorMsg}
                  </p>
                )}

                <button
                  type="submit"
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Send message
                  <span aria-hidden>→</span>
                </button>
              </form>
            )}
          </section>

          {/* fine print */}
          <div className="mt-16 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Mailing address
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              NEXPEC, Inc.
              <br />
              Operational HQ details available on request via the sales
              inbox. Legal notices may be served at the address on file
              with the registrar of companies.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
    </div>
  );
}
