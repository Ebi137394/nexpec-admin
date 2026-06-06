'use client';
// /agreements/[id]/sign — generic Review & Sign for ANY counterparty's own leg
//   (supplier_supply, inspector_engagement, or client_supply). Top-level route so
//   suppliers AND inspectors (who can't enter the /(marketplace) group) can reach it.
//   RLS gates the data: only the agreement's counterparty can read/sign it.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function AgreementSignPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '') as string;

  const [agr, setAgr] = useState<FullAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchAgreement(id).then(setAgr).catch(() => setAgr(null)).finally(() => setLoading(false));
  }, [id]);

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
    <div className="min-h-screen bg-ink-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
          <ArrowLeft size={15} /> Home
        </Link>

        {loading ? (
          <div className="h-40 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />
        ) : !agr ? (
          <p className="mt-6 text-white/60">This agreement was not found, or it is not addressed to you.</p>
        ) : executed ? (
          <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-6">
            <div className="flex items-center gap-2 text-accent-green"><CheckCircle2 size={20} /><h1 className="text-lg font-bold">Signed and executed</h1></div>
            <p className="mt-2 text-sm text-white/70">Your signature is sealed. NEXPEC will proceed; funds move only as the contracted milestones clear.</p>
            <Link href="/" className="mt-4 inline-flex rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-deep">Done</Link>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Review and sign</p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">{KIND_LABEL[agr.kind] ?? 'Agreement'}</h1>
            <div className="mt-3 rounded-xl border border-ink-600 bg-ink-800 p-4 text-sm text-white/80">
              {AMOUNT_LABEL[agr.kind] ?? 'Amount'}: <span className="font-bold text-white">{formatUsd(agr.amount_cents)}</span>
            </div>
            <div className="mt-4 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-600 bg-ink-950 p-5 text-sm leading-relaxed text-white/80">{agr.body_md}</div>
            <div className="mt-5 space-y-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <label className="block text-xs font-bold uppercase tracking-wide text-white/60">Type your full legal name to sign</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full legal name" className={inp} />
              <label className="flex items-start gap-2 text-sm text-white/80">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-violet" />
                I have read and agree to this Agreement with NEXPEC.
              </label>
              {err && <p className="text-sm text-accent-red">{err}</p>}
              <button onClick={sign} disabled={busy || !name.trim() || !agreed} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold hover:bg-violet-deep disabled:opacity-60">
                <ShieldCheck size={16} /> {busy ? 'Signing…' : 'Sign agreement'}
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
              <ShieldCheck size={13} /> Sealed on signature (SHA-256). You contract only with NEXPEC.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
