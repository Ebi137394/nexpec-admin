// ════════════════════════════════════════════════════════════════════════════
//  /admin/tax-center — admin Tax Center: review, reveal (audited), verify, exempt.
//  Decryption is brokered by the tax-vault edge function and logged to
//  audit_events. Dark theme; matches the Treasury console design system.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchTaxReviewQueue, type AdminTaxRow } from '@/lib/data/taxCenter';
import { adminVerifyTax, adminNeedsUpdateTax, adminExemptTax } from '@/lib/actions/taxCenter';
import { RevealButton } from './RevealButton';

export const metadata: Metadata = { title: 'Tax Center, Admin' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ verified?: string; updated?: string; exempt?: string; error?: string }>;
}

export default async function AdminTaxCenterPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const rows = await fetchTaxReviewQueue();
  const pending = rows.filter((r) => r.status === 'submitted' || r.status === 'needs_update');
  const settled = rows.filter((r) => !(r.status === 'submitted' || r.status === 'needs_update'));

  return (
    <div className="space-y-8">
      <header>
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/90">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
          Tax Center, Admin
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">Tax verification</h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Review submitted tax forms, reveal a stored identifier (every reveal is audited), then verify or exempt. Verified or exempt payees can request payouts.
        </p>
      </header>

      {sp.verified && <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Verified, payouts unlocked for that payee.</Banner>}
      {sp.exempt && <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Exemption granted and logged.</Banner>}
      {sp.updated && <Banner tone="zinc" icon={<AlertCircle className="h-4 w-4" />}>Marked as needs-update.</Banner>}
      {sp.error && <Banner tone="red" icon={<AlertCircle className="h-4 w-4" />}>{sp.error}</Banner>}

      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">Awaiting review ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Nothing in the queue.</p>
        ) : (
          <ul className="mt-5 space-y-3">{pending.map((r) => <Row key={r.userId} r={r} reviewable />)}</ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">All profiles ({settled.length})</h2>
          <ul className="mt-5 space-y-3">{settled.map((r) => <Row key={r.userId} r={r} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Row({ r, reviewable }: { r: AdminTaxRow; reviewable?: boolean }) {
  return (
    <li className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{r.name} <span className="ml-2 text-xs text-zinc-500">{r.role}</span></p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {labelForm(r.formType)} · {r.country ?? 'unknown'} · {r.maskedTaxId ? `ending ${r.maskedTaxId}` : 'no last-4'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TaxPill status={r.status} exempt={r.isExempt} />
          <RevealButton userId={r.userId} hasCipher={r.hasCipher} />
        </div>
      </div>

      {reviewable && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
          <form action={adminVerifyTax}>
            <input type="hidden" name="userId" value={r.userId} />
            <button type="submit" className="rounded-lg bg-accent-green/15 px-3 py-1.5 text-xs font-semibold text-accent-green transition hover:bg-accent-green/25">Verify</button>
          </form>
          <form action={adminNeedsUpdateTax}>
            <input type="hidden" name="userId" value={r.userId} />
            <button type="submit" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.08]">Needs update</button>
          </form>
          <form action={adminExemptTax} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={r.userId} />
            <input name="reason" placeholder="Exemption reason" required minLength={3}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-violet-glow/60" />
            <button type="submit" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20">Exempt</button>
          </form>
        </div>
      )}
    </li>
  );
}

function labelForm(f?: string | null): string {
  const m: Record<string, string> = { w9: 'W-9', w8ben: 'W-8BEN', w8bene: 'W-8BEN-E', t4a: 'T4A', dac7: 'DAC7' };
  return f ? (m[f] ?? f) : 'no form';
}

function TaxPill({ status, exempt }: { status: string; exempt: boolean }) {
  if (exempt) return <Pill cls="border-amber-500/30 bg-amber-500/10 text-amber-300">exempt</Pill>;
  const map: Record<string, string> = {
    verified: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    submitted: 'border-violet-glow/30 bg-violet-glow/10 text-violet-glow',
    needs_update: 'border-accent-red/30 bg-accent-red/10 text-red-300',
    not_started: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
    in_progress: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  };
  return <Pill cls={map[status] ?? map.not_started ?? ''}>{status.replace('_', ' ')}</Pill>;
}
function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial ${cls}`}>{children}</span>;
}

function Banner({ tone, icon, children }: { tone: 'red' | 'green' | 'zinc'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    red: 'border-accent-red/30 bg-accent-red/10 text-red-300',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-300',
  }[tone];
  return <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{icon}<span>{children}</span></div>;
}
