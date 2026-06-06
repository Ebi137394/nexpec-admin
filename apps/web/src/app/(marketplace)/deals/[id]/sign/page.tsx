'use client';
// /deals/[id]/sign — Review & sign the Client↔NEXPEC supply agreement.
//   Signing executes the agreement and HOLDS the client price in escrow
//   (contract-before-money), which dispatches the brokered inspection.
//   The client contracts only with NEXPEC; the supplier/inspector legs are
//   separate and never exposed here.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Lock, CheckCircle2 } from 'lucide-react';
import { fetchClientAgreement, signAgreement, formatUsd, type ClientAgreement } from '@/lib/data/marketplace';

const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function DealSignPage() {
  const params = useParams<{ id: string }>();
  const dealId = (params?.id ?? '') as string;

  const [agr, setAgr] = useState<ClientAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchClientAgreement(dealId).then(setAgr).catch(() => setAgr(null)).finally(() => setLoading(false));
  }, [dealId]);

  const executed = agr?.status === 'executed' || done;

  const sign = async () => {
    if (!agr || !name.trim() || !agreed) return;
    setBusy(true); setErr(null);
    const { error } = await signAgreement(agr.id, name.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
  };

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
        <ArrowLeft size={15} /> RFQs
      </Link>

      {!agr ? (
        <p className="mt-6 text-white/60">No supply agreement found for this deal.</p>
      ) : executed ? (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-6">
          <div className="flex items-center gap-2 text-accent-green">
            <CheckCircle2 size={20} />
            <h1 className="text-lg font-bold">Signed and escrow funded</h1>
          </div>
          <p className="mt-2 text-sm text-white/70">
            {formatUsd(agr.amount_cents)} is held in escrow. NEXPEC is dispatching your inspection and will assign a credential-verified inspector. Funds release only as contracted milestones clear.
          </p>
          <Link href="/rfqs" className="mt-4 inline-flex rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-deep">Back to RFQs</Link>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Review and sign</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">Supply and Inspection Agreement</h1>

          <div className="mt-3 flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
            <Lock size={18} className="text-violet-glow" />
            <p className="text-sm text-white/80">Total into escrow on signature: <span className="font-bold text-white">{formatUsd(agr.amount_cents)}</span>. Funds release only as contracted milestones clear.</p>
          </div>

          <div className="mt-4 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-600 bg-ink-950 p-5 text-sm leading-relaxed text-white/80">
            {agr.body_md}
          </div>

          <div className="mt-5 space-y-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
            <label className="block text-xs font-bold uppercase tracking-wide text-white/60">Type your full legal name to sign</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane A. Client" className={inp} />
            <label className="flex items-start gap-2 text-sm text-white/80">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-violet" />
              I have read and agree to this Agreement, and authorise NEXPEC to hold the amount above in escrow.
            </label>
            {err && <p className="text-sm text-accent-red">{err}</p>}
            <button onClick={sign} disabled={busy || !name.trim() || !agreed} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold hover:bg-violet-deep disabled:opacity-60">
              <ShieldCheck size={16} /> {busy ? 'Signing…' : 'Sign and fund escrow'}
            </button>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
            <ShieldCheck size={13} /> Sealed on signature (SHA-256). NEXPEC brokers every party; you contract only with NEXPEC.
          </p>
        </>
      )}
    </div>
  );
}
