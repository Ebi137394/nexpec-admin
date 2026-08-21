'use client';
// components/marketplace/SupplierPayoutCard.tsx — Stripe Connect payouts for
// suppliers. Mirrors the inspector wallet: onboarding via create-stripe-connect-link,
// withdrawal via create-supplier-payout (server re-derives + verifies). Balances
// come from supplier_earnings (non-client-writable; credited by admin release).
import { useEffect, useState } from 'react';
import { Wallet, ShieldCheck, ArrowUpRight, Loader2, Banknote, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  fetchSupplierWallet, startSupplierConnectOnboarding, supplierWithdraw,
  formatUsd, toCents, type SupplierWallet,
} from '@/lib/data/marketplace';

const MIN_CENTS = 5000; // $50.00

export function SupplierPayoutCard() {
  const [w, setW] = useState<SupplierWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = () => { setLoading(true); fetchSupplierWallet().then(setW).catch(() => setW(null)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const verified = !!w && w.connectStatus === 'verified' && w.payoutsEnabled;
  const availableCents = w?.availableCents ?? 0;

  const onboard = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await startSupplierConnectOnboarding();
      if (res.url) window.location.href = res.url;
      else setMsg({ kind: 'err', text: res.error ?? 'Could not start onboarding. Try again shortly.' });
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setMsg(null);
    const cents = toCents(amount);
    if (!cents || cents < MIN_CENTS) { setMsg({ kind: 'err', text: 'Minimum withdrawal is $50.00.' }); return; }
    if (cents > availableCents) { setMsg({ kind: 'err', text: 'Amount exceeds your available balance.' }); return; }
    setBusy(true);
    try {
      const res = await supplierWithdraw(cents);
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Payout failed.' }); return; }
      setAmount(''); setMsg({ kind: 'ok', text: 'Payout initiated, funds typically arrive in 1–2 business days.' });
      load();
    } finally { setBusy(false); }
  };

  if (loading) return <div className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white"><Banknote size={16} className="text-accent-green" /> Withdrawable balance</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Released earnings, settled manually by NEXPEC after approval.</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${verified ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber'}`}>
          <ShieldCheck size={13} /> Manual payouts
        </span>
      </div>

      <p className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">{formatUsd(availableCents)}</p>

      {/* THIS RELEASE: Stripe is NEXPEC's inbound merchant account only.
          Supplier payouts are settled manually by the NEXPEC team (bank/Wise)
          after approval — no Stripe Connect onboarding, no in-app withdrawal.
          The automated payout endpoints refuse server-side (NX-STRIPE-004);
          this card states the real model instead of advertising a dead flow. */}
      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-sm text-zinc-400">
          Released earnings are paid out manually by the NEXPEC team after
          approval — typically by bank transfer or Wise. No setup is required
          here; keep your payout details up to date with NEXPEC support.
        </p>
      </div>

      {msg && (
        <p className={`mt-3 inline-flex items-center gap-1.5 text-sm ${msg.kind === 'ok' ? 'text-accent-green' : 'text-accent-red'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {msg.text}
        </p>
      )}
    </section>
  );
}
