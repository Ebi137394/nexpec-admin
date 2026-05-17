// ════════════════════════════════════════════════════════════════════════════
//  app/contact/page.tsx — Contact / Talk to sales
//
//  Placeholder while we wire a real intake form (HubSpot / form action +
//  Resend). For now: three explicit channels — sales, support, security —
//  each with a copyable email. Designed to look intentional rather than
//  unfinished.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, LifeBuoy, ShieldAlert, ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/marketing/Footer';

// Force dynamic — opt out of static export to avoid the prerender path
// that's been failing /404 with React #31 in Vercel's pipeline.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Talk to NEXPEC — sales, support, and responsible disclosure. Three named inboxes, no ticketing maze.',
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

export default function ContactPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      {/* atmosphere — match landing */}
      <div aria-hidden className="pointer-events-none absolute inset-0 topo-grid opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-violet/20 blur-[110px]"
      />

      {/* slim header */}
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
            Three channels, three named addresses. No ticketing maze. Pick
            the right inbox below and we&apos;ll route from there.
          </p>

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
