'use client';
// components/admin/SupplierReleaseRow.tsx — one awarded supplier contract with a
// brokered-release control. The Supplier Agreement gates everything: NEXPEC must
// issue it, the supplier must e-sign, and NEXPEC must counter-sign to EXECUTE it
// before any funds can be released. Prefills the remaining amount; posts to the
// release_supplier_contract server action.
import { useState } from 'react';
import {
  Store,
  Rocket,
  CheckCircle2,
  Banknote,
  FileSignature,
  PenLine,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { releaseSupplierContract } from '@/lib/actions/supplierReleases';
import {
  adminGenerateSupplierContract,
  adminCountersignSupplierContract,
} from '@/lib/actions/supplierContracts';
import type { AwardedContract } from '@/lib/data/supplierReleases';
import type { SupplierContractRow } from '@/lib/data/supplierContracts';

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function SupplierReleaseRow({
  c,
  agreement,
}: {
  c: AwardedContract;
  agreement: SupplierContractRow | null;
}) {
  const fullyReleased = c.contractCents > 0 && c.outstandingCents <= 0;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(((c.outstandingCents || 0) / 100).toFixed(2));

  const pct = c.contractCents > 0 ? Math.min(Math.round((c.releasedCents / c.contractCents) * 100), 100) : 0;
  const executed = agreement?.status === 'executed';

  return (
    <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/12 text-cyan-glow"><Store size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{c.supplierName}</p>
            {c.dispatched && <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/40 px-2 py-0.5 text-[10px] font-bold text-accent-green"><Rocket size={10} /> Dispatched</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{c.rfqTitle} · awarded {new Date(c.awardedAt).toLocaleDateString()}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-base font-semibold text-white">{usd(c.contractCents)}</p>
          <p className="text-[11px] text-zinc-500">contract value</p>
        </div>
      </div>

      {/* Agreement lifecycle — gates the release */}
      <AgreementBlock quoteId={c.quoteId} agreement={agreement} />

      {/* released progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>Released {usd(c.releasedCents)}</span>
          <span className={c.outstandingCents > 0 ? 'text-accent-amber' : 'text-accent-green'}>
            {c.outstandingCents > 0 ? `${usd(c.outstandingCents)} outstanding` : 'Fully released'}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-950">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent-green" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {fullyReleased ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-green"><CheckCircle2 size={15} /> Fully released</p>
      ) : !executed ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-ink-950 px-3 py-2 text-xs font-semibold text-zinc-400">
          <Lock size={13} /> Releases unlock once the supplier agreement is signed &amp; executed.
        </p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-2 rounded-full bg-cyan-glow/15 px-4 py-2 text-sm font-bold text-cyan-glow transition hover:bg-cyan-glow/25">
          <Banknote size={15} /> Release funds
        </button>
      ) : (
        <form action={releaseSupplierContract} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="quoteId" value={c.quoteId} />
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-ink-950 px-3 sm:w-40">
            <span className="text-sm text-white/40">$</span>
            <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-10 w-full bg-transparent text-sm text-white outline-none" />
          </div>
          <input name="note" placeholder="Note (e.g. FAT cleared)" className="h-10 flex-1 rounded-lg border border-white/[0.08] bg-ink-950 px-3 text-sm text-white placeholder-white/40 outline-none" />
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2.5 text-sm font-bold text-white transition hover:bg-violet-deep">
            <Banknote size={15} /> Release
          </button>
        </form>
      )}
    </li>
  );
}

function AgreementBlock({
  quoteId,
  agreement,
}: {
  quoteId: string;
  agreement: SupplierContractRow | null;
}) {
  const [countersigning, setCountersigning] = useState(false);

  // No agreement yet → issue one.
  if (!agreement) {
    return (
      <div className="mt-3 rounded-xl border border-violet/20 bg-violet/[0.05] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-glow">
            <FileSignature size={14} /> No agreement issued yet
          </p>
          <form action={adminGenerateSupplierContract}>
            <input type="hidden" name="quoteId" value={quoteId} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-violet px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-violet-deep">
              <FileSignature size={13} /> Issue agreement
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (agreement.status === 'pending_supplier_signature') {
    return (
      <div className="mt-3 rounded-xl border border-accent-amber/25 bg-accent-amber/[0.06] p-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-amber">
          <PenLine size={14} /> Issued — awaiting supplier signature
        </p>
      </div>
    );
  }

  if (agreement.status === 'pending_admin_countersignature') {
    return (
      <div className="mt-3 rounded-xl border border-cyan-glow/25 bg-cyan-glow/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-glow">
            <CheckCircle2 size={14} /> Supplier signed
            {agreement.supplierSignedName ? ` · ${agreement.supplierSignedName}` : ''} — counter-sign to execute
          </p>
          {!countersigning && (
            <button onClick={() => setCountersigning(true)} className="inline-flex items-center gap-1.5 rounded-full bg-violet px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-violet-deep">
              <ShieldCheck size={13} /> Countersign &amp; execute
            </button>
          )}
        </div>
        {countersigning && (
          <form action={adminCountersignSupplierContract} className="mt-3 space-y-2">
            <input type="hidden" name="contractId" value={agreement.id} />
            <input
              name="typedName"
              required
              minLength={2}
              maxLength={160}
              placeholder="Your full legal name"
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 text-sm text-white placeholder-white/40 outline-none"
            />
            <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-300">
              <input type="checkbox" name="termsAccepted" value="on" required className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-violet" />
              I countersign on behalf of NEXPEC, executing this agreement.
            </label>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-violet px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-violet-deep">
              <ShieldCheck size={13} /> Execute &amp; seal
            </button>
          </form>
        )}
      </div>
    );
  }

  // executed
  return (
    <div className="mt-3 rounded-xl border border-accent-green/25 bg-accent-green/[0.06] p-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-green">
        <ShieldCheck size={14} /> Agreement executed &amp; sealed
      </p>
      {agreement.contentSha256 && (
        <p className="mt-1 break-all font-mono text-[10px] text-accent-green/70">
          sha256:{agreement.contentSha256.slice(0, 32)}…
        </p>
      )}
    </div>
  );
}
