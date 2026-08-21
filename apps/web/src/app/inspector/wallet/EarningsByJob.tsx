// EarningsByJob — per-job earned / paid / due for the inspector wallet (web).
// Same secure view as mobile's PayoutSummary (my_earnings_view): provider side
// only, no buyer price, no spread. Renders nothing until real engagements exist.
import { CheckCircle2, Hourglass } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const usd = (c: number) =>
  `$${(Math.abs(Number(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  in_progress:      { label: 'In progress',      cls: 'border-sky-400/40 text-sky-300' },
  due:              { label: 'Due',              cls: 'border-accent-amber/40 text-accent-amber' },
  payout_scheduled: { label: 'Payout scheduled', cls: 'border-violet-glow/40 text-violet-glow' },
  part_paid:        { label: 'Partially paid',   cls: 'border-violet-glow/40 text-violet-glow' },
  paid:             { label: 'Paid',             cls: 'border-accent-green/40 text-accent-green' },
};

export async function EarningsByJob() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('my_earnings_view').select('*')
    .order('created_at', { ascending: false }).limit(30);
  const rows = (data ?? []).filter((r) => Number(r.earned_cents) > 0);
  if (rows.length === 0) return null;

  const due = rows.reduce((n, r) => n + Number(r.due_cents), 0);
  const paid = rows.reduce((n, r) => n + Number(r.paid_cents), 0);

  return (
    <section aria-label="Earnings by job" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Earnings by job</h2>
        <p className="text-xs text-zinc-500">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-accent-green" />Paid {usd(paid)}
          <Hourglass className="ml-3 mr-1 inline h-3.5 w-3.5 text-accent-amber" />Due {usd(due)}
        </p>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const meta = STATUS[r.payout_status] ?? { label: '—', cls: 'border-white/10 text-zinc-500' };
          return (
            <li key={r.job_id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{r.title}</p>
                <p className="text-xs text-zinc-500">
                  Earned {usd(Number(r.earned_cents))} · Paid {usd(Number(r.paid_cents))} · Due {usd(Number(r.due_cents))}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
