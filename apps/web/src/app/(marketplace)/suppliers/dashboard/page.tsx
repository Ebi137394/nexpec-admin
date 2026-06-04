'use client';
// /suppliers/dashboard — web supplier workspace (mirrors mobile supplier-dashboard.tsx)
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Megaphone, Send, Trophy, Star, ShieldCheck, Store } from 'lucide-react';
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
  const won = quotes.filter((q) => q.status === 'accepted').length;
  const lost = quotes.filter((q) => q.status === 'declined').length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const checklist = [
    { label: 'Profile created', done: !!profile },
    { label: 'Capabilities listed', done: (profile?.capabilities?.length ?? 0) > 0 },
    { label: 'Headline added', done: !!profile?.headline },
    { label: 'Verified', done: !!profile?.verified },
  ];
  const completeness = checklist.filter((c) => c.done).length;

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-violet-glow">Supplier workspace</p>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-extrabold">{profile?.legal_name || 'Welcome'}</h1>
          {profile?.verified && <ShieldCheck size={18} className="text-accent-green" />}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={<Megaphone size={16} />} color="text-violet-glow" value={String(opps.length)} label="Open Opportunities" />
        <Kpi icon={<Send size={16} />} color="text-cyan-glow" value={String(activeBids)} label="Active Bids" />
        <Kpi icon={<Trophy size={16} />} color="text-accent-green" value={winRate == null ? '—' : `${winRate}%`} label="Win Rate" />
        <Kpi icon={<Star size={16} />} color="text-accent-amber" value={profile ? Number(profile.rating_avg ?? 0).toFixed(1) : '—'} label="Rating" />
      </div>

      <section>
        <h2 className="mb-2 font-bold">Qualification</h2>
        {!profile ? (
          <Link href="/suppliers/onboard" className="flex items-center gap-3 rounded-xl border border-violet bg-violet/10 p-4 transition hover:bg-violet/15">
            <Store size={20} className="text-violet-glow" />
            <div className="flex-1">
              <p className="text-sm font-bold">Complete your vendor profile</p>
              <p className="text-xs text-white/60">List your capabilities to appear in the directory and bid on RFQs.</p>
            </div>
          </Link>
        ) : (
          <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${profile.verified ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-amber/15 text-accent-amber'}`}>
                {profile.verified ? <><ShieldCheck size={13} /> Verified Vendor</> : 'Pending verification'}
              </span>
              <span className="text-xs text-white/60">{completeness}/4 complete</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-950"><div className="h-full rounded-full bg-violet" style={{ width: `${(completeness / 4) * 100}%` }} /></div>
            <ul className="mt-3 space-y-1.5">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  <span className={c.done ? 'text-accent-green' : 'text-white/30'}>{c.done ? '●' : '○'}</span>
                  <span className={c.done ? 'text-white' : 'text-white/50'}>{c.label}</span>
                </li>
              ))}
            </ul>
            {(profile.capabilities?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {profile.capabilities.slice(0, 8).map((k) => <span key={k} className="rounded border border-ink-600 bg-ink-950 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">{capLabel[k] ?? k}</span>)}
              </div>
            )}
            <Link href="/suppliers/onboard" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet px-3 py-1.5 text-xs font-bold text-violet-glow hover:bg-violet/10">Manage listing &amp; certifications</Link>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Active Opportunities</h2><Link href="/rfqs" className="text-xs font-bold text-violet-glow">Browse all</Link></div>
        {opps.length === 0 ? <p className="text-sm text-white/50">No open opportunities right now.</p> : (
          <ul className="space-y-2">
            {opps.slice(0, 6).map((o) => (
              <li key={o.id}>
                <Link href={`/rfqs/${o.id}`} className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3 transition hover:border-violet/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{o.title}</p>
                      {o.matched && <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[9px] font-extrabold text-violet-glow">MATCH</span>}
                      {o.alreadyQuoted && <span className="rounded-full border border-cyan/60 px-2 py-0.5 text-[9px] font-bold text-cyan-glow">YOU BID</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-white/50">{o.requires_source_inspection ? 'Source / FAT' : 'Procurement'} · {new Date(o.created_at).toLocaleDateString()}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold">My Bids</h2>
        {quotes.length === 0 ? <p className="text-sm text-white/50">You haven’t bid yet — browse opportunities above.</p> : (
          <ul className="space-y-2">
            {quotes.slice(0, 8).map((q) => {
              const st = (QSTATUS[q.status] ?? QSTATUS.submitted) as { label: string; cls: string };
              const cents = q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : null);
              return (
                <li key={q.id}>
                  <Link href={`/rfqs/${q.rfq_id}`} className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3 transition hover:border-violet/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{q.rfq_title || 'RFQ'}</p>
                      <p className="mt-0.5 text-xs text-white/50">{cents != null ? formatUsd(cents) : '—'}{q.status === 'accepted' && q.spawned_job_id ? ' · Inspection dispatched' : ''}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
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

function Kpi({ icon, color, value, label }: { icon: React.ReactNode; color: string; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-3">
      <div className={`mb-1.5 ${color}`}>{icon}</div>
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs text-white/60">{label}</p>
    </div>
  );
}
