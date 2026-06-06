'use client';
// components/contracts/SpineAgreementSign.tsx — portal-hosted Review & Sign for a
//   brokered-spine leg (supplier_supply / inspector_engagement). Rendered INSIDE
//   a portal layout, so it inherits the sidebar; it adds a back link + breadcrumb
//   so the user is never stranded. Signs via the spine RPC (sign_agreement).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { fetchAgreement, signAgreement, formatUsd, type MyAgreement } from '@/lib/data/marketplace';

type FullAgreement = MyAgreement & { body_md: string | null };

const KIND_LABEL: Record<string, string> = {
  client_supply: 'Supply & Inspection Agreement',
  supplier_supply: 'Supplier Supply Agreement',
  inspector_engagement: 'Inspector Engagement',
};
const AMOUNT_LABEL: Record<string, string> = {
  client_supply: 'Total payable into escrow',
  supplier_supply: 'You will be paid (on goods acceptance)',
  inspector_engagement: 'Your payout (on admin-confirmed report)',
};
const inp =
  'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-violet-glow focus:outline-none';

export function SpineAgreementSign({
  agreementId,
  backHref,
  portalLabel,
}: {
  agreementId: string;
  backHref: string;
  portalLabel: string;
}) {
  const [agr, setAgr] = useState<FullAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchAgreement(agreementId).then(setAgr).catch(() => setAgr(null)).finally(() => setLoading(false));
  }, [agreementId]);

  const executed = agr?.status === 'executed' || done;

  const sign = async () => {
    if (!agr || !name.trim() || !agreed) return;
    setBusy(true); setErr(null);
    const { error } = await signAgreement(agr.id, name.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
  };

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span>{portalLabel}</span>
        <span>›</span>
        <Link href={backHref} className="hover:text-white">Contracts</Link>
        <span>›</span>
        <span className="text-zinc-300">{agr ? (KIND_LABEL[agr.kind] ?? 'Agreement') : 'Agreement'}</span>
      </nav>
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-400 transition hover:text-white">
        <ArrowLeft size={15} /> Back to Contracts
      </Link>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
      ) : !agr ? (
        <p className="mt-2 text-zinc-400">This agreement was not found, or it is not addressed to you.</p>
      ) : executed ? (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-6">
          <div className="flex items-center gap-2 text-accent-green"><CheckCircle2 size={20} /><h1 className="text-lg font-bold">Signed and executed</h1></div>
          <p className="mt-2 text-sm text-zinc-300">Your signature is sealed. NEXPEC will proceed; funds move only as the contracted milestones clear.</p>
          <Link href={backHref} className="mt-4 inline-flex rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white hover:bg-violet/90">Back to Contracts</Link>
        </div>
      ) : (
        <>
          <header>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Review and sign</p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">{KIND_LABEL[agr.kind] ?? 'Agreement'}</h1>
          </header>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-300">
            {AMOUNT_LABEL[agr.kind] ?? 'Amount'}: <span className="font-bold text-white">{formatUsd(agr.amount_cents)}</span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-ink-950 p-5 text-sm leading-relaxed text-zinc-300">{agr.body_md}</div>
          <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <label className="block text-xs font-bold uppercase tracking-industrial text-zinc-400">Type your full legal name to sign</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full legal name" className={inp} />
            <label className="flex items-start gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-violet" />
              I have read and agree to this Agreement with NEXPEC.
            </label>
            {err && <p className="text-sm text-accent-red">{err}</p>}
            <button onClick={sign} disabled={busy || !name.trim() || !agreed} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold text-white hover:bg-violet/90 disabled:opacity-60">
              <ShieldCheck size={16} /> {busy ? 'Signing…' : 'Sign agreement'}
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <ShieldCheck size={13} /> Sealed on signature (SHA-256). You contract only with NEXPEC.
          </p>
        </>
      )}
    </div>
  );
}
