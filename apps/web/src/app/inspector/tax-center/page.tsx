// ════════════════════════════════════════════════════════════════════════════
//  /inspector/tax-center — payee Tax Center (web).
//  Shows current status; when not cleared, renders the jurisdiction-adaptive
//  wizard. Tax-info-before-money: this must be 'verified' (or admin-exempt)
//  before a payout can be requested. Dark theme.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { ShieldCheck, AlertCircle, CheckCircle2, Clock, Lock } from 'lucide-react';
import { fetchMyTaxProfile } from '@/lib/data/taxCenter';
import { TaxWizardForm } from './TaxWizardForm';

export const metadata: Metadata = { title: 'Tax Center' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ submitted?: string; error?: string; from?: string }>;
}

export default async function TaxCenterPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const profile = await fetchMyTaxProfile();
  const cleared = profile?.status === 'verified' || profile?.isExempt;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/90">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
          Tax Center
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">Tax information</h1>
        <p className="mt-2 text-pretty text-sm text-zinc-400">
          We collect tax details once, before your first payout, as legally required. Your full identifier is encrypted at rest; only the last 4 digits are ever shown.
        </p>
      </header>

      {sp.from === 'payout' && !cleared && (
        <Banner tone="amber" icon={<Lock className="h-4 w-4" />}>Complete your tax information to unlock payouts.</Banner>
      )}
      {sp.submitted && (
        <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Submitted, an admin will review and verify your tax information shortly.</Banner>
      )}
      {sp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-4 w-4" />}>{sp.error}</Banner>
      )}

      {cleared ? (
        <section className="rounded-3xl border border-accent-green/20 bg-accent-green/[0.04] p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-accent-green" strokeWidth={2} />
            <h2 className="font-display text-lg font-semibold text-white">
              {profile?.isExempt ? 'Tax-exempt (admin override)' : 'Tax information verified'}
            </h2>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            {profile?.isExempt
              ? 'An administrator has exempted your account from the tax requirement. Payouts are unlocked.'
              : `Your ${labelForm(profile?.formType)} is on file${profile?.maskedTaxId ? ` (ending ${profile.maskedTaxId})` : ''}. Payouts are unlocked.`}
          </p>
          <a href="/inspector/wallet" className="mt-5 inline-flex rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6D28D9]">
            Go to wallet
          </a>
        </section>
      ) : (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          {profile?.status === 'submitted' && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-zinc-300">
              <Clock className="h-3.5 w-3.5 text-violet-glow" /> Submitted, awaiting admin verification. You can re-submit to update it.
            </div>
          )}
          {profile?.status === 'needs_update' && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-accent-red/20 bg-accent-red/[0.06] px-3 py-2.5 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5" /> Your tax information needs an update, please re-submit.
            </div>
          )}
          <TaxWizardForm />
        </section>
      )}
    </div>
  );
}

function labelForm(f?: string | null): string {
  const m: Record<string, string> = { w9: 'W-9', w8ben: 'W-8BEN', w8bene: 'W-8BEN-E', t4a: 'T4A', dac7: 'DAC7 record' };
  return f ? (m[f] ?? 'tax form') : 'tax form';
}

function Banner({ tone, icon, children }: { tone: 'red' | 'green' | 'amber'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    red: 'border-accent-red/30 bg-accent-red/10 text-red-300',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  }[tone];
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${cls}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}
