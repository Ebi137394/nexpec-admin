'use client';
// /suppliers/dashboard — Supplier command center (premium redesign).
// Mirrors the mobile supplier-dashboard data model against the same backend;
// elevated to match the Inspector/Client portals: gradient hero, KPI rail,
// verification + readiness meter, matched opportunities, live bids.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, Send, Trophy, Star, ShieldCheck, Store, ArrowRight,
  FileCheck2, Wallet, Sparkles, Rocket, Clock,
} from 'lucide-react';
import {
  fetchOpenOpportunities, fetchMyQuotes, fetchMyVendorProfile, fetchCapabilityCatalog,
  formatUsd, toCents, type Opportunity, type MyQuote, type VendorProfile, type CapabilityOption,
} from '@/lib/data/marketplace';

const QSTATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-cyan/15 text-cyan-glow' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-accent-amber/15 text-accent-amber' },
  accepted: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Lost', cls: 'bg-accent-red/15 text-accent-red' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-white/10 text-white/60' },
};

export default function SupplierDashboardPage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [quotes, setQuotes] = useState<MyQuote[]>([]);
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [caps, setCaps] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchOpenOpportunities().catch(() => []),
      fetchMyQuotes().catch(() => []),
      fetchMyVendorProfile().catch(() => null),
      fetchCapabilityCatalog().catch(() => []),
    ]).then(([o, q, p, c]) => { setOpps(o); setQuotes(q); setProfile(p); setCaps(c); }).finally(() => setLoading(false));
  }, []);

  const capLabel = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c.label])), [caps]);
  const activeBids = useMemo(() => quotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted').length, [quotes]);
  const matched = useMemo(() => opps.filter((o) => o.matched), [opps]);
  const won = quotes.filter((q) => q.status === 'accepted').length;
  const lost = quotes.filter((q) => q.status === 'declined').length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  const checklist = [
    { label: 'Company profile created', done: !!profile },
    { label: 'Capabilities listed', done: (profile?.capabilities?.length ?? 0) > 0 },
    { label: 'Headline / pitch added', done: !!profile?.headline },
    { label: 'Verified by NEXPEC', done: !!profile?.verified },
  ];
  const completeness = checklist.filter((c) => c.done).length;
  const pct = Math.round((completeness / checklist.length) * 100);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-36 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.02]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-violet/[0.14] via-ink-900/40 to-ink-950 p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-violet-glow/20 blur-[90px]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Supplier workspace</p>
            <div className="mt-2 flex items-center gap-2.5">
              <h1 className="truncate font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {profile?.legal_name || 'Welcome to NEXPEC'}
              </h1>
              {profile?.verified && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2.5 py-1 text-[11px] font-bold text-accent-green">
                  <ShieldCheck size={13} /> Verified
                </span>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              {profile?.headline
                || 'List your capabilities, bid on brokered RFQs, and let NEXPEC dispatch source inspection on award.'}
            </p>
          </div>
          <Link
            href="/suppliers/opportunities"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet/20 transition hover:bg-violet-deep"
          >
            <Megaphone size={16} /> Browse opportunities
          </Link>
        </div>
      </section>

      {/* KPI rail */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Megaphone size={18} />} tone="violet" value={String(opps.length)} label="Open opportunities" sub={matched.length > 0 ? `${matched.length} match your capabilities` : 'Across all disciplines'} />
        <Kpi icon={<Send size={18} />} tone="cyan" value={String(activeBids)} label="Active bids" sub={quotes.length > 0 ? `${quotes.length} total submitted` : 'No bids yet'} />
        <Kpi icon={<Trophy size={18} />} tone="green" value={winRate == null ? '—' : `${winRate}%`} label="Win rate" sub={won + lost > 0 ? `${won} won · ${lost} lost` : 'Awaiting outcomes'} />
        <Kpi icon={<Star size={18} />} tone="amber" value={profile ? Number(profile.rating_avg ?? 0).toFixed(1) : '—'} label="Buyer rating" sub={profile ? `${profile.rating_count ?? 0} reviews` : 'List to start earning reviews'} />
      </section>

      {/* Readiness + Next best action */}
      <section className="grid gap-5 lg:grid-cols-3">
        {/* Readiness meter */}
        <div className="lg:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-white">Qualification readiness</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {profile?.verified
                  ? 'You are a verified vendor — buyers see your trust badge across the marketplace.'
                  : 'Complete your profile to rank higher and unlock verification.'}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-semibold text-white">{pct}%</p>
              <p className="text-[11px] uppercase tracking-industrial text-zinc-500">{completeness}/{checklist.length} complete</p>
            </div>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-950">
            <div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-glow transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${c.done ? 'bg-accent-green/20 text-accent-green' : 'bg-white/[0.04] text-white/30'}`}>
                  {c.done ? '✓' : '○'}
                </span>
                <span className={c.done ? 'text-zinc-200' : 'text-zinc-500'}>{c.label}</span>
              </li>
            ))}
          </ul>
          {(profile?.capabilities?.length ?? 0) > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.05] pt-4">
              {profile!.capabilities.slice(0, 10).map((k) => (
                <span key={k} className="rounded-md border border-white/[0.07] bg-ink-950 px-2 py-0.5 text-[11px] font-medium text-zinc-300">{capLabel[k] ?? k}</span>
              ))}
            </div>
          )}
          <Link href="/suppliers/profile" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow hover:text-white">
            {profile ? 'Manage profile & capabilities' : 'Create your vendor profile'} <ArrowRight size={14} />
          </Link>
        </div>

        {/* Quick links */}
        <div className="space-y-3">
          <QuickLink href="/suppliers/documents" icon={<FileCheck2 size={18} />} title="Document Vault" body="Sealed certificates & accreditations" />
          <QuickLink href="/suppliers/finance" icon={<Wallet size={18} />} title="Finance" body="Brokered payouts & ledger" />
          <QuickLink href="/suppliers/messages" icon={<Sparkles size={18} />} title="Coordination Bridge" body="Direct line to NEXPEC admin" />
        </div>
      </section>

      {/* Matched opportunities */}
      <section>
        <SectionHead title="Recommended opportunities" hint={matched.length > 0 ? 'Matched to your capabilities' : undefined} href="/suppliers/opportunities" />
        {(matched.length > 0 ? matched : opps).length === 0 ? (
          <EmptyState
            icon={<Megaphone size={22} className="text-violet-glow" />}
            title="No open opportunities right now"
            body="New brokered RFQs appear here the moment buyers post them. We prioritise the ones matching your capabilities."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {(matched.length > 0 ? matched : opps).slice(0, 6).map((o) => (
              <li key={o.id}>
                <Link href={`/suppliers/opportunities/${o.id}`} className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/50 hover:bg-white/[0.04]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow">
                    {o.requires_source_inspection ? <ShieldCheck size={18} /> : <Store size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{o.title}</p>
                      {o.matched && <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-industrial text-violet-glow">Match</span>}
                      {o.alreadyQuoted && <span className="rounded-full border border-cyan/50 px-2 py-0.5 text-[9px] font-bold text-cyan-glow">You bid</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {o.requires_source_inspection ? 'Source / FAT inspection' : 'Procurement only'} · {new Date(o.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active bids */}
      <section>
        <SectionHead title="My bids" href="/suppliers/bids" />
        {quotes.length === 0 ? (
          <EmptyState
            icon={<Send size={22} className="text-cyan-glow" />}
            title="You haven't bid yet"
            body="Submit a quote on any open opportunity — when a buyer awards it, NEXPEC auto-dispatches source inspection and you're notified instantly."
          />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
            {quotes.slice(0, 6).map((q) => {
              const st = (QSTATUS[q.status] ?? QSTATUS.submitted) as { label: string; cls: string };
              const cents = q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : null);
              return (
                <li key={q.id}>
                  <Link href={`/suppliers/opportunities/${q.rfq_id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.03]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-300">
                      {q.status === 'accepted' ? <Rocket size={16} className="text-accent-green" /> : <Clock size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{q.rfq_title || 'RFQ'}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {cents != null ? formatUsd(cents) : 'Quote on file'}
                        {q.status === 'accepted' && q.spawned_job_id ? ' · Inspection dispatched' : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const TONES: Record<string, { tile: string; icon: string }> = {
  violet: { tile: 'bg-violet/12', icon: 'text-violet-glow' },
  cyan: { tile: 'bg-cyan/12', icon: 'text-cyan-glow' },
  green: { tile: 'bg-accent-green/12', icon: 'text-accent-green' },
  amber: { tile: 'bg-accent-amber/12', icon: 'text-accent-amber' },
};

function Kpi({ icon, tone, value, label, sub }: { icon: React.ReactNode; tone: string; value: string; label: string; sub?: string }) {
  const t = TONES[tone] ?? TONES.violet!;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.tile} ${t.icon}`}>{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="text-sm font-medium text-zinc-300">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function QuickLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/50 hover:bg-white/[0.04]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="truncate text-xs text-zinc-500">{body}</p>
      </div>
      <ArrowRight size={15} className="shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
    </Link>
  );
}

function SectionHead({ title, hint, href }: { title: string; hint?: string; href: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-semibold text-white">{title}</h2>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-glow hover:text-white">
        View all <ArrowRight size={13} />
      </Link>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">{body}</p>
    </div>
  );
}
