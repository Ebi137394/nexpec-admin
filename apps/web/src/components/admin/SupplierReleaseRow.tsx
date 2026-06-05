'use client';
// components/admin/SupplierReleaseRow.tsx — one awarded supplier contract with a
// brokered-release control. Prefills the remaining amount; posts to the
// release_supplier_contract server action.
import { useState } from 'react';
import { Store, Rocket, CheckCircle2, Banknote } from 'lucide-react';
import { releaseSupplierContract } from '@/lib/actions/supplierReleases';
import type { AwardedContract } from '@/lib/data/supplierReleases';

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function SupplierReleaseRow({ c }: { c: AwardedContract }) {
  const fullyReleased = c.contractCents > 0 && c.outstandingCents <= 0;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(((c.outstandingCents || 0) / 100).toFixed(2));

  const pct = c.contractCents > 0 ? Math.min(Math.round((c.releasedCents / c.contractCents) * 100), 100) : 0;

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
