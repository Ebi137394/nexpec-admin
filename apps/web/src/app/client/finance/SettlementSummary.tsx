// ════════════════════════════════════════════════════════════════════════════
//  SettlementSummary — the buyer's manual-settlement picture (web).
//  Server component over the same role-scoped secure views the mobile
//  SettlementDashboard uses, so both platforms show the same truth:
//    my_job_settlement_view  · my_settlement_activity (client_payment side)
//  No payout, no spread — enforced by the views, proven by pgTAP.
// ════════════════════════════════════════════════════════════════════════════

import { Landmark, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const usd = (cents: number) =>
  `$${(Math.abs(Number(cents || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  payment_required:      { label: 'Payment required',      cls: 'border-accent-amber/40 text-accent-amber' },
  awaiting_confirmation: { label: 'Awaiting confirmation', cls: 'border-sky-400/40 text-sky-300' },
  part_paid:             { label: 'Partially paid',        cls: 'border-violet-glow/40 text-violet-glow' },
  paid:                  { label: 'Paid',                  cls: 'border-accent-green/40 text-accent-green' },
};

export async function SettlementSummary() {
  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: activity }] = await Promise.all([
    supabase.from('my_job_settlement_view').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('my_settlement_activity').select('*').eq('direction', 'client_payment')
      .order('recorded_at', { ascending: false }).limit(8),
  ]);

  const priced = (rows ?? []).filter((r) => Number(r.total_cents) > 0);
  if (priced.length === 0 && (activity ?? []).length === 0) return null;

  const total = priced.reduce((n, r) => n + Number(r.total_cents), 0);
  const paid = priced.reduce((n, r) => n + Number(r.paid_cents), 0);
  const pending = priced.reduce((n, r) => n + Number(r.pending_cents), 0);
  const outstanding = priced.reduce((n, r) => n + Number(r.outstanding_cents), 0);
  const open = priced.filter((r) => r.settlement_status !== 'paid');

  const cards = [
    { icon: Landmark,     label: 'Contract value',        value: usd(total),       cls: 'text-violet-glow' },
    { icon: CheckCircle2, label: 'Paid',                  value: usd(paid),        cls: 'text-accent-green' },
    { icon: Clock,        label: 'Awaiting confirmation', value: usd(pending),     cls: 'text-sky-300' },
    { icon: AlertCircle,  label: 'Outstanding',           value: usd(outstanding), cls: outstanding > 0 ? 'text-accent-amber' : 'text-zinc-500' },
  ];

  return (
    <section aria-label="Manual settlement" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ icon: Icon, label, value, cls }) => (
          <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Icon className={`h-4 w-4 ${cls}`} strokeWidth={1.75} />
            <p className="mt-2 font-mono text-xl font-semibold tracking-tight text-white">{value}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-5 text-zinc-400">
        NEXPEC settles by bank transfer / invoice. Once your payment is received,
        our team confirms it here and your engagement continues automatically.
      </div>

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((r) => {
            const meta = STATUS_LABEL[r.settlement_status] ?? { label: 'Payment required', cls: 'border-accent-amber/40 text-accent-amber' };
            return (
              <li key={r.job_id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{r.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Total {usd(Number(r.total_cents))} · Paid {usd(Number(r.paid_cents))} · Outstanding {usd(Number(r.outstanding_cents))}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>
                  {meta.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(activity ?? []).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-industrial text-zinc-500">Payment history</h3>
          <ul className="mt-2 space-y-1.5">
            {(activity ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2 text-sm">
                {a.status === 'paid_manually'
                  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-green" />
                  : <Clock className="h-3.5 w-3.5 shrink-0 text-sky-300" />}
                <span className="min-w-0 flex-1 truncate text-zinc-300">{a.job_title}</span>
                <span className="hidden text-xs text-zinc-500 sm:inline">
                  {String(a.method).replace('_', ' ')}{a.reference ? ` · ${a.reference}` : ''}{a.paid_on ? ` · ${a.paid_on}` : ''}
                </span>
                <span className="font-mono font-semibold text-white">{usd(Number(a.amount_cents))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
