// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/support/page.tsx — Help center + one-tap line to admin
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LifeBuoy, Gavel, ShieldCheck, Wallet, FileCheck2, MessageCircle, ArrowRight,
} from 'lucide-react';
import { openHelpSupport } from '@/lib/actions/messages';

export const metadata: Metadata = { title: 'Supplier · Help & Support' };
export const dynamic = 'force-dynamic';

async function contactAdmin() {
  'use server';
  await openHelpSupport('/suppliers/messages');
}

const FAQS: { icon: typeof Gavel; title: string; body: string }[] = [
  {
    icon: Gavel,
    title: 'How bidding & awards work',
    body: 'Buyers post brokered RFQs. You submit a private quote — competitors never see it, and the buyer only ever sees the figure NEXPEC presents. When your bid wins, the award is confirmed by an admin.',
  },
  {
    icon: ShieldCheck,
    title: 'Getting verified',
    body: 'Upload your ISO, accreditation and insurance certificates in the Document Vault. NEXPEC reviews the sealed artifacts and grants your verified badge, which lifts you in directory and match ranking.',
  },
  {
    icon: Wallet,
    title: 'Payments & settlement',
    body: 'Supplier payouts are brokered: NEXPEC holds and releases funds against verified milestones. There is no self-service balance — arrange your payout method with the team via the Coordination Bridge.',
  },
  {
    icon: FileCheck2,
    title: 'Document sealing & provenance',
    body: 'Every file you upload is hashed (SHA-256), sealed into the Trust Spine, and anchored to Bitcoin via OpenTimestamps — giving you tamper-evident, independently verifiable proof of authenticity.',
  },
];

export default function SupplierSupportPage() {
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Supplier Portal · Help</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">Help &amp; Support</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Everything you need to run your NEXPEC supplier account — and a direct line to a human when you need one.
          </p>
        </div>
        <form action={contactAdmin}>
          <button type="submit" className="inline-flex items-center gap-2 self-start rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-deep sm:self-auto">
            <MessageCircle className="h-4 w-4" strokeWidth={1.75} />
            Contact NEXPEC admin
          </button>
        </form>
      </header>

      {/* Highlighted bridge card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-violet/[0.12] to-ink-950 p-6">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-violet-glow/20 blur-[80px]" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow"><LifeBuoy size={22} /></span>
          <div>
            <h2 className="font-semibold text-white">The Coordination Bridge</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              All supplier support runs through one secure, admin-brokered channel. No tickets lost in inboxes, no
              direct exposure to buyers or inspectors — just a private thread with the NEXPEC team, on the record.
            </p>
            <Link href="/suppliers/messages" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow hover:text-white">
              Open my messages <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* FAQ grid */}
      <section>
        <h2 className="mb-3 font-semibold text-white">Common questions</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {FAQS.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet/12 text-violet-glow"><f.icon size={18} /></span>
              <h3 className="mt-3 text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
