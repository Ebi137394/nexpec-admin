'use client';
// components/contracts/InspectorTrust.tsx — the visual Trust Architecture (A–E).
//   Pure presentation over the already-blinded dossier data (no PII, no backend).
//     A+B  CredentialCertificate — cryptographic "digital certificate" (stats + SHA-256 seal)
//     C    NeutralityBadge       — zero-conflict guarantee
//     E    VipDisclosureGate     — Named-Disclosure premium upsell modal
import { useState } from 'react';
import { ShieldCheck, Lock, BadgeCheck, Crown, Sparkles, Fingerprint, Check, X, ArrowRight } from 'lucide-react';

export interface CertData {
  handle: string;
  competencies: string[];
  certifications: string[];
  region: string | null;
  scope: string | null;
  tier: string;
  sealId?: string | null;
  verifyPath?: string | null;
  redactedCv?: string | null;
  statement?: string | null;
  eoPolicyRef?: string | null;
}

const GUILLOCHE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(139,92,246,0.07) 0px, rgba(139,92,246,0.07) 1px, transparent 1px, transparent 7px), repeating-linear-gradient(45deg, rgba(139,92,246,0.05) 0px, rgba(139,92,246,0.05) 1px, transparent 1px, transparent 9px)',
} as const;

// ── A + B — the cryptographic Digital Certificate (NO name, NO photo) ──────────
export function CredentialCertificate({
  data, slot, revealed, legalName, onReveal, vipUnlocked,
}: {
  data: CertData; slot?: string; revealed?: boolean; legalName?: string | null; onReveal?: () => void; vipUnlocked?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-ink-900 to-ink-950 shadow-lg shadow-black/20">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={GUILLOCHE} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-glow via-violet-400 to-accent-green" />
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-violet-glow/40 bg-violet-500/10">
              {revealed ? <BadgeCheck className="h-5 w-5 text-accent-green" /> : <Lock className="h-5 w-5 text-violet-glow" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-industrial text-violet-glow/80">NEXPEC verified credential</p>
              <p className="truncate font-mono text-sm font-semibold text-white">{revealed && legalName ? legalName : data.handle}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {slot && <span className="rounded-md bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold text-violet-100">Option {slot}</span>}
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-300">{data.tier} tier</span>
            {vipUnlocked && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300"><Crown className="h-3 w-3" /> Named disclosure</span>}
          </div>
        </div>

        {data.certifications.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.certifications.map((cert) => (
              <span key={cert} className="inline-flex items-center gap-1 rounded-md border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[11px] font-semibold text-accent-green">
                <Check className="h-3 w-3" /> {cert}
              </span>
            ))}
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div className="col-span-2"><dt className="text-zinc-500">Competencies</dt><dd className="text-zinc-200">{data.competencies.length ? data.competencies.join(', ') : 'n/a'}</dd></div>
          <div><dt className="text-zinc-500">Region</dt><dd className="text-zinc-200">{data.region ?? 'n/a'}</dd></div>
          <div><dt className="text-zinc-500">Scope</dt><dd className="truncate text-zinc-200">{data.scope ?? 'n/a'}</dd></div>
        </dl>

        {data.tier === 'named' && data.redactedCv && <p className="mt-2 text-xs italic text-zinc-300">{data.redactedCv}</p>}
        {data.statement && <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">{data.statement}</p>}

        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400"><Fingerprint className="h-3.5 w-3.5 text-violet-glow" /> SHA-256 sealed</span>
          <div className="flex min-w-0 items-center gap-2">
            {data.eoPolicyRef && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{data.eoPolicyRef}</span>}
            <span className="truncate font-mono text-[11px] text-zinc-300">{data.sealId ?? data.handle}</span>
            {data.verifyPath && <a href={data.verifyPath} className="shrink-0 text-[11px] font-semibold text-violet-200 hover:underline">Verify →</a>}
          </div>
        </div>

        {!revealed && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500"><Lock className="h-3 w-3" /> Name &amp; photo sealed until final report</span>
            {onReveal && (
              <button onClick={onReveal} className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 transition hover:text-amber-200">
                <Crown className="h-3 w-3" /> Reveal now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── C — Neutrality Guarantee badge ─────────────────────────────────────────────
export function NeutralityBadge({ statement, supplierHandle }: { statement?: string | null; supplierHandle?: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-accent-green/30 bg-accent-green/[0.07] p-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent-green/40 bg-accent-green/10">
        <ShieldCheck className="h-4 w-4 text-accent-green" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-industrial text-accent-green">Neutrality guaranteed, zero conflict</p>
        <p className="mt-0.5 text-xs text-zinc-300">
          {statement ?? 'Independent of the supplier; no financial or employment relationship.'}
          {supplierHandle ? ` Screened against supplier ${supplierHandle}.` : ''}
        </p>
      </div>
    </div>
  );
}

// ── E — Named-Disclosure VIP gate: offer → sign sealed amendment → unlocked ─────
type RequestResult = { agreementId: string; feeCents: number; currency: string; bodyMd: string | null; tier?: string } | { error: string };
export function VipDisclosureGate({
  open, onClose, tier, handle, onRequest, onSign, onUnlocked,
}: {
  open: boolean; onClose: () => void; tier: string; handle: string;
  onRequest?: () => Promise<RequestResult>;
  onSign?: (agreementId: string, name: string) => Promise<{ error?: { message: string } | null }>;
  onUnlocked?: () => void;
}) {
  const [phase, setPhase] = useState<'offer' | 'sign' | 'done'>('offer');
  const [amend, setAmend] = useState<{ agreementId: string; feeCents: number; currency: string; bodyMd: string | null; tier?: string } | null>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const functional = !!onRequest && !!onSign;
  const benefits = [
    'Inspector legal name + verified CV, disclosed upfront',
    'Direct credential audit before mobilization',
    'Extended 36-month non-circumvention + liquidated damages',
    'Sealed amendment to your MSA (SHA-256 + OpenTimestamps)',
  ];
  const close = () => { setPhase('offer'); setAmend(null); setName(''); setAgreed(false); setErr(null); setBusy(false); onClose(); };
  const proceed = async () => {
    if (!onRequest) return;
    setBusy(true); setErr(null);
    const res = await onRequest();
    setBusy(false);
    if ('error' in res) { setErr(res.error); return; }
    setAmend(res); setPhase('sign');
  };
  const doSign = async () => {
    if (!onSign || !amend || !name.trim() || !agreed) return;
    setBusy(true); setErr(null);
    const { error } = await onSign(amend.agreementId, name.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPhase('done'); onUnlocked?.();
  };
  const feeLabel = amend ? `${(amend.feeCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${amend.currency}` : '';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={close}>
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-b from-ink-900 to-ink-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-amber-200 to-amber-400" />
        <button onClick={close} aria-label="Close" className="absolute right-3 top-3 text-zinc-500 transition hover:text-white"><X className="h-4 w-4" /></button>
        <div className="p-6">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-amber-400/40 bg-amber-400/10"><Crown className="h-6 w-6 text-amber-300" /></div>

          {phase === 'done' ? (
            <>
              <h2 className="mt-3 font-display text-xl font-bold text-white">Named disclosure unlocked</h2>
              <div className="mt-4 rounded-xl border border-accent-green/30 bg-accent-green/[0.07] p-4 text-sm text-zinc-200">
                <p className="flex items-center gap-2 font-semibold text-accent-green"><Check className="h-4 w-4" /> Sealed amendment executed</p>
                <p className="mt-1 text-zinc-400">The inspector&apos;s legal name and verified credentials are now revealed below. Your sealed amendment is verifiable at /passport.</p>
              </div>
              <button onClick={close} className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-violet py-3 font-bold text-white hover:bg-violet/90">Done</button>
            </>
          ) : phase === 'sign' && amend ? (
            <>
              <h2 className="mt-3 font-display text-xl font-bold text-white">Sign the disclosure amendment</h2>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                <span className="text-sm text-zinc-300">Administrative amendment fee{amend.tier ? ` (${amend.tier})` : ''}</span>
                <span className="text-sm font-bold text-amber-200">{feeLabel}</span>
              </div>
              {amend.bodyMd && (
                <div className="mt-3 max-h-[34vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-ink-950 p-4 text-xs leading-relaxed text-zinc-300">{amend.bodyMd}</div>
              )}
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full legal name to sign" className="mt-3 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none" />
              <label className="mt-2 flex items-start gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                I agree to the administrative amendment fee and the extended 36-month non-circumvention + liquidated damages.
              </label>
              {err && <p className="mt-2 text-sm text-accent-red">{err}</p>}
              <button onClick={doSign} disabled={busy || !name.trim() || !agreed} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 py-3 font-bold text-ink-950 transition hover:from-amber-300 hover:to-amber-200 disabled:opacity-60">
                {busy ? 'Sealing…' : 'Sign & unlock'} <ShieldCheck className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <h2 className="mt-3 font-display text-xl font-bold text-white">Unlock Named Disclosure</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Inspector <span className="font-mono text-zinc-200">{handle}</span> is sealed at the <span className="font-semibold text-zinc-200">{tier}</span> tier. NEXPEC escrows identity to protect against poaching — upgrade to reveal it before the final report.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-zinc-300">
                {benefits.map((b) => (
                  <li key={b} className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> {b}</li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <div>
                  <p className="text-[11px] uppercase tracking-industrial text-zinc-500">Named Disclosure</p>
                  <p className="text-sm font-bold text-white">Administrative amendment fee</p>
                </div>
                <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">VIP tier</span>
              </div>
              {err && <p className="mt-3 text-sm text-accent-red">{err}</p>}
              {functional ? (
                <button onClick={proceed} disabled={busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 py-3 font-bold text-ink-950 transition hover:from-amber-300 hover:to-amber-200 disabled:opacity-60">
                  {busy ? 'Preparing amendment…' : 'Continue to terms'} <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-center text-[12px] text-zinc-400">Available once an inspector is engaged on this deal.</p>
              )}
              <p className="mt-2 text-center text-[11px] text-zinc-500">Stricter non-circumvention applies. Pricing confirmed by NEXPEC.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
