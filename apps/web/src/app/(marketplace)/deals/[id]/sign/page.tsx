'use client';
// /deals/[id]/sign — Review & sign the Client↔NEXPEC supply agreement.
//   Signing executes the agreement and HOLDS the client price in escrow
//   (contract-before-money), which dispatches the brokered inspection.
//   The client contracts only with NEXPEC; the supplier/inspector legs are
//   separate and never exposed here.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Lock, CheckCircle2, Award, Scale, Eye, Flag, BadgeCheck, Wallet, FileWarning } from 'lucide-react';
import {
  fetchClientAgreement, signAgreement, formatUsd, fetchAssignedInspector, clientReviewEngagement,
  fetchDealById, fetchPaymentSchedule, fundDealBalance, raiseNonconformance,
  type ClientAgreement, type AssignedInspector, type DealRow, type PaymentTranche,
} from '@/lib/data/marketplace';

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
        <>
          <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-6">
            <div className="flex items-center gap-2 text-accent-green">
              <CheckCircle2 size={20} />
              <h1 className="text-lg font-bold">Signed and escrow funded</h1>
            </div>
            <p className="mt-2 text-sm text-white/70">
              Your 30% mobilization deposit is held in escrow against the {formatUsd(agr.amount_cents)} contract price; the 70% balance is due at FAT/Inspection-Readiness (see your payment schedule below). NEXPEC is dispatching your inspection and will assign a credential-verified inspector. Funds release only as contracted milestones clear.
            </p>
            <Link href="/rfqs" className="mt-4 inline-flex rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-deep">Back to RFQs</Link>
          </div>

          <MilestoneFundingCard dealId={dealId} />

          <div className="mt-4 rounded-2xl border border-ink-600 bg-ink-900/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-white">Your executed agreement</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-green/30 bg-accent-green/10 px-2.5 py-0.5 text-[11px] font-bold text-accent-green">
                <CheckCircle2 size={12} /> Executed
              </span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/50">Date issued</dt>
                <dd className="font-mono text-white/90">{(agr.presented_at || agr.created_at) ? new Date((agr.presented_at || agr.created_at) as string).toLocaleString() : 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-white/50">Date executed</dt>
                <dd className="font-mono text-white/90">{agr.executed_at ? new Date(agr.executed_at).toLocaleString() : 'Just now'}</dd>
              </div>
            </dl>
            {agr.body_md && (
              <div className="mt-4 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-600 bg-ink-950 p-5 text-sm leading-relaxed text-white/80">{agr.body_md}</div>
            )}
            {agr.content_sha256 && (
              <p className="mt-3 flex items-center gap-1.5 break-all text-xs text-white/40">
                <ShieldCheck size={13} className="shrink-0" /> Sealed sha256:{agr.content_sha256}
              </p>
            )}
          </div>

          <AssignedInspectorCard dealId={dealId} />
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Review and sign</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">Supply and Inspection Agreement</h1>

          <div className="mt-3 flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
            <Lock size={18} className="text-violet-glow" />
            <p className="text-sm text-white/80">On signature you fund the <span className="font-bold text-white">30% mobilization deposit</span> of the {formatUsd(agr.amount_cents)} contract price; the 70% balance is due at FAT/Inspection-Readiness (Schedule B). Funds release only as contracted milestones clear.</p>
          </div>

          <div className="mt-4 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-600 bg-ink-950 p-5 text-sm leading-relaxed text-white/80">
            {agr.body_md}
          </div>

          <div className="mt-5 space-y-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
            <label className="block text-xs font-bold uppercase tracking-wide text-white/60">Type your full legal name to sign</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane A. Client" className={inp} />
            <label className="flex items-start gap-2 text-sm text-white/80">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-violet" />
              I have read and agree to this Agreement, and authorise NEXPEC to hold the 30% mobilization deposit in escrow.
            </label>
            {err && <p className="text-sm text-accent-red">{err}</p>}
            <button onClick={sign} disabled={busy || !name.trim() || !agreed} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold hover:bg-violet-deep disabled:opacity-60">
              <ShieldCheck size={16} /> {busy ? 'Signing…' : 'Sign and fund deposit'}
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

// ── Assigned-inspector trust panel (A/B/C dossier + D review gate + F identity escrow) ──
const REVIEW_LABEL: Record<string, string> = {
  pending: 'Awaiting your review', approved: 'Approved by you',
  objected: 'Objection raised', auto_approved: 'Auto-approved',
};

function Pill({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'amber' | 'red' | 'violet' }) {
  const tones: Record<string, string> = {
    zinc: 'border-white/10 bg-white/[0.04] text-white/70',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${tones[tone]}`}>{children}</span>;
}

function AssignedInspectorCard({ dealId }: { dealId: string }) {
  const [insp, setInsp] = useState<AssignedInspector | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showObject, setShowObject] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAssignedInspector(dealId).then(setInsp).catch(() => setInsp(null)).finally(() => setLoading(false));
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="mt-5 h-28 animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />;
  if (!insp) return (
    <div className="mt-5 rounded-2xl border border-ink-600 bg-ink-800 p-5 text-sm text-white/70">
      <p className="font-semibold text-white">Inspector assignment pending</p>
      <p className="mt-1">NEXPEC is blind-matching a credential-verified inspector. Their independent, anonymized dossier will appear here for your review before work begins.</p>
    </div>
  );

  const review = async (decision: 'approved' | 'objected') => {
    if (decision === 'objected' && !reason.trim()) { setShowObject(true); return; }
    setBusy(decision); setErr(null);
    const { error } = await clientReviewEngagement(dealId, decision, decision === 'objected' ? reason.trim() : undefined);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setShowObject(false); setReason(''); load();
  };

  const d = insp.dossier;
  const cert = insp.certificate;
  const indep = insp.independence;
  const pending = insp.client_review === 'pending';
  const revealed = !!insp.inspector_legal_name;
  const reviewTone = insp.client_review === 'objected' ? 'red' : insp.client_review === 'pending' ? 'amber' : 'green';

  return (
    <div className="mt-5 space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BadgeCheck size={18} className="text-violet-glow" />
          <h2 className="text-base font-bold text-white">Your assigned inspector</h2>
          <span className="font-mono text-sm text-violet-200">{insp.handle}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Pill tone="violet">{insp.transparency_tier} tier</Pill>
          <Pill tone={reviewTone}>{REVIEW_LABEL[insp.client_review] ?? insp.client_review}</Pill>
        </div>
      </header>

      {d && (
        <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-industrial text-white/60"><Award size={13} /> Credential dossier</p>
          {insp.transparency_tier === 'named' && d.redacted_cv && (
            <p className="mt-2 text-sm font-medium italic text-white/90">{d.redacted_cv}</p>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-white/50">Competencies</dt><dd className="text-white/90">{d.competencies?.length ? d.competencies.join(', ') : 'n/a'}</dd></div>
            <div><dt className="text-white/50">Certifications</dt><dd className="text-white/90">{d.certifications?.length ? d.certifications.join(', ') : 'n/a'}</dd></div>
            <div><dt className="text-white/50">Region</dt><dd className="text-white/90">{d.region ?? 'n/a'}</dd></div>
            <div><dt className="text-white/50">Scope</dt><dd className="text-white/90">{d.scope ?? 'n/a'}</dd></div>
          </dl>
        </div>
      )}

      {cert && (
        <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-industrial text-white/60"><ShieldCheck size={13} /> NEXPEC certificate</p>
          <p className="mt-2 text-sm text-white/80">{cert.statement}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-white/40">
            {insp.artifacts_seal_id && <span>Seal {insp.artifacts_seal_id}</span>}
            <Link href={cert.verify_path || '/passport'} className="text-violet-200 hover:underline">Verify →</Link>
          </div>
        </div>
      )}

      {indep && (
        <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-industrial text-white/60"><Scale size={13} /> Independence</p>
          <p className="mt-2 text-sm text-white/80">{indep.statement}</p>
        </div>
      )}

      {pending ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
          <p className="text-sm text-white/80">
            Review the dossier above, then approve to let work begin{insp.review_deadline
              ? `. It auto-approves ${new Date(insp.review_deadline).toLocaleString()} if you take no action.`
              : ' (manual approval, no deadline).'}
          </p>
          {showObject && (
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell NEXPEC why so we can re-match" rows={3} className="mt-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-violet" />
          )}
          {err && <p className="mt-2 text-sm text-accent-red">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy === 'approved'} onClick={() => review('approved')} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-green/90 px-4 py-2 text-sm font-bold text-ink-950 hover:bg-accent-green disabled:opacity-60"><CheckCircle2 size={15} /> {busy === 'approved' ? 'Approving…' : 'Approve inspector'}</button>
            <button disabled={busy === 'objected'} onClick={() => review('objected')} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-sm font-bold text-accent-red hover:bg-accent-red/20 disabled:opacity-60"><Flag size={15} /> {showObject ? (busy === 'objected' ? 'Submitting…' : 'Submit objection') : 'Object'}</button>
          </div>
        </div>
      ) : insp.client_review === 'objected' ? (
        <p className="rounded-xl border border-accent-red/20 bg-accent-red/[0.04] p-4 text-sm text-white/80">You objected to this inspector. NEXPEC will blind-match a replacement and present a new dossier here.</p>
      ) : (
        <p className="rounded-xl border border-accent-green/20 bg-accent-green/[0.04] p-4 text-sm text-white/80">Inspector {insp.client_review === 'auto_approved' ? 'auto-approved' : 'approved'}; work can proceed.</p>
      )}

      <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-industrial text-white/60">{revealed ? <Eye size={13} /> : <Lock size={13} />} Inspector identity</p>
        {revealed ? (
          <div className="mt-2 text-sm text-white/90">
            <p>Legal name: <span className="font-semibold">{insp.inspector_legal_name}</span></p>
            {insp.inspector_signature && <p className="mt-1">Signature of record: <span className="font-semibold">{insp.inspector_signature}</span></p>}
            <p className="mt-1 text-xs text-white/50">Released with the admin-confirmed final report for your ASME/API audit file.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/70">Held in escrow. The real name and signature of the inspector are released to you when the final report is admin-confirmed, giving you an auditable deliverable.</p>
        )}
      </div>
    </div>
  );
}

// ── Milestone funding (Schedule B) — fund the 70% balance at FAT-readiness + raise an NCR ──
function MilestoneFundingCard({ dealId }: { dealId: string }) {
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [sched, setSched] = useState<PaymentTranche[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchDealById(dealId), fetchPaymentSchedule(dealId)])
      .then(([d, s]) => { setDeal(d); setSched(s); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  const fundBalance = async () => {
    setBusy(true); setErr(null);
    const { error } = await fundDealBalance(dealId);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    load();
  };

  const reportNcr = async () => {
    const citation = window.prompt('Report a non-conformance — cite the specific Schedule A spec or ASME/API code deviation (min 20 chars):');
    if (citation == null) return;
    setBusy(true); setErr(null);
    const { error } = await raiseNonconformance(dealId, 'goods', citation);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    load();
  };

  if (loading) return <div className="mt-4 h-28 animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />;
  if (!deal) return null;

  const balanceDue = !!deal.deposit_funded_at && !deal.balance_funded_at;

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-ink-600 bg-ink-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-bold text-white"><Wallet size={16} className="text-violet-glow" /> Payment schedule</h2>
        <div className="flex items-center gap-1.5">
          <Pill tone={deal.deposit_funded_at ? 'green' : 'zinc'}>Deposit 30% {deal.deposit_funded_at ? 'funded' : 'due'}</Pill>
          <Pill tone={deal.balance_funded_at ? 'green' : 'amber'}>Balance 70% {deal.balance_funded_at ? 'funded' : 'due at FAT'}</Pill>
        </div>
      </div>

      {sched.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-ink-600">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-white/50"><tr><th className="px-3 py-2 font-medium">Tranche</th><th className="px-3 py-2 font-medium">Release trigger</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
            <tbody>
              {sched.map((t) => (
                <tr key={t.id} className="border-t border-ink-700 text-white/80">
                  <td className="px-3 py-2">{t.label} ({Math.round(t.pct_bps / 100)}%)</td>
                  <td className="px-3 py-2 text-white/50">{t.trigger_basis}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatUsd(t.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {balanceDue && (
          <button onClick={fundBalance} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-violet px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-deep disabled:opacity-60">
            <Wallet size={15} /> {busy ? 'Funding…' : `Fund 70% balance (${formatUsd(Math.round(deal.client_price_cents * 0.7))})`}
          </button>
        )}
        <button onClick={reportNcr} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-2.5 text-sm font-bold text-accent-red hover:bg-accent-red/20 disabled:opacity-60">
          <FileWarning size={15} /> Report a non-conformance
        </button>
      </div>
      {err && <p className="text-sm text-accent-red">{err}</p>}
      <p className="text-xs text-white/40">Silence for 10 business days after delivery is irrevocable acceptance and authorises release. A rejection must cite a specific Schedule A spec or ASME/API code deviation.</p>
    </div>
  );
}
