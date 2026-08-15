// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/invoices/page.tsx — outstanding & overdue invoice queue
//
//  Every job released on approved credit whose final balance is still
//  outstanding, ordered by how late it is. This is the Admin follow-up list.
//
//  ── REAL LEDGER STATE, NOT A MOCK ──────────────────────────────────────────
//  Rows come straight from public.job_funding_stages — the same table the
//  delivery gate reads. status/invoice_due_at are the actual ledger columns
//  written by nx_admin_release_job_on_credit and
//  nx_funding_issue_delivery_invoice. Nothing here is derived from a fixture
//  or a client-side guess.
//
//  ── STATUS COMES FROM THE SHARED CONTRACT ──────────────────────────────────
//  The Open / Due Soon / Overdue / Paid / Waived vocabulary is computed with
//  the same rules the database's nx_funding_invoice_status uses and rendered
//  through invoiceStatusLabel(), so Admin, Client Web and Mobile cannot
//  disagree about what "overdue" means.
//
//  ── THIS PAGE MOVES NO MONEY ───────────────────────────────────────────────
//  It is a read surface with links. Collecting a balance is Stripe/webhook
//  work, and paying an Inspector is a separate manual action on
//  /admin/payouts. Neither is reachable from here.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';

import { formatCents, invoiceStatusLabel, type InvoiceStatus } from '@nexpec/shared-core/domain';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Outstanding invoices · NEXPEC Admin',
};

export const dynamic = 'force-dynamic';

interface InvoiceRow {
  jobId: string;
  jobTitle: string | null;
  amountCents: number;
  netTermDays: number | null;
  invoiceDueAt: string | null;
  status: InvoiceStatus;
}

/** Mirrors nx_funding_invoice_status so one vocabulary governs every surface. */
function deriveStatus(
  dbStatus: string,
  invoiceDueAt: string | null,
): InvoiceStatus {
  if (dbStatus === 'funded') return 'paid';
  if (dbStatus === 'waived') return 'waived';
  if (!invoiceDueAt) return 'open';
  const due = new Date(invoiceDueAt).getTime();
  const now = Date.now();
  if (now > due) return 'overdue';
  if (now > due - 7 * 24 * 60 * 60 * 1000) return 'due_soon';
  return 'open';
}

const TONE: Record<InvoiceStatus, string> = {
  open: 'bg-white/5 text-zinc-300',
  due_soon: 'bg-amber-400/10 text-amber-200',
  overdue: 'bg-rose-500/10 text-rose-200',
  paid: 'bg-emerald-400/10 text-emerald-200',
  waived: 'bg-white/5 text-zinc-400',
};

async function fetchOutstandingInvoices(): Promise<{
  rows: InvoiceRow[];
  unavailable: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  //  Released tranches only: gates_delivery = false is precisely the set that
  //  became an invoice. A still-gating tranche is unpaid funding, not a debt.
  const { data, error } = await supabase
    .from('job_funding_stages')
    .select('job_id, amount_cents, status, net_term_days, invoice_due_at, jobs(title)')
    .eq('code', 'final')
    .eq('gates_delivery', false)
    .order('invoice_due_at', { ascending: true });

  if (error) return { rows: [], unavailable: true };

  const rows = (data ?? []).map((r) => {
    const rec = r as unknown as {
      job_id: string;
      amount_cents: number | null;
      status: string;
      net_term_days: number | null;
      invoice_due_at: string | null;
      jobs: { title: string | null } | { title: string | null }[] | null;
    };
    const job = Array.isArray(rec.jobs) ? rec.jobs[0] : rec.jobs;
    return {
      jobId: rec.job_id,
      jobTitle: job?.title ?? null,
      amountCents: rec.amount_cents ?? 0,
      netTermDays: rec.net_term_days,
      invoiceDueAt: rec.invoice_due_at,
      status: deriveStatus(rec.status, rec.invoice_due_at),
    };
  });

  return { rows, unavailable: false };
}

export default async function AdminOutstandingInvoicesPage() {
  const { rows, unavailable } = await fetchOutstandingInvoices();
  const outstanding = rows.filter((r) => r.status !== 'paid' && r.status !== 'waived');
  const overdue = outstanding.filter((r) => r.status === 'overdue');
  const totalCents = outstanding.reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-white">
          Outstanding invoices
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Final balances released on approved credit terms. Reports for these jobs are
          already delivered and stay accessible — an overdue balance is a collections
          matter, never a reason to withhold a report.
        </p>
      </header>

      {unavailable ? (
        <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">
          The invoice list could not be read. This is not the same as “no outstanding
          invoices” — do not treat this screen as empty.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.06] p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Outstanding</p>
              <p className="mt-1 text-xl font-semibold text-white">{outstanding.length}</p>
            </div>
            <div className="rounded-xl border border-rose-500/20 p-4">
              <p className="text-xs uppercase tracking-wide text-rose-300/70">Overdue</p>
              <p className="mt-1 text-xl font-semibold text-rose-200">{overdue.length}</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Total value</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {formatCents(totalCents)}
              </p>
            </div>
          </div>

          {outstanding.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] p-6 text-sm text-zinc-400">
              No outstanding credit-released invoices. Jobs on Strict Prepay are not
              listed here — their balance is collected before delivery.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Outstanding credit-released invoices, soonest due first
                </caption>
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Job</th>
                    <th scope="col" className="px-4 py-3">Balance</th>
                    <th scope="col" className="px-4 py-3">Terms</th>
                    <th scope="col" className="px-4 py-3">Due</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((r) => (
                    <tr key={r.jobId} className="border-t border-white/[0.04]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/funding/${r.jobId}`}
                          className="text-white underline underline-offset-2"
                        >
                          {r.jobTitle ?? r.jobId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-zinc-200">
                        {formatCents(r.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {r.netTermDays ? `Net-${r.netTermDays}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {r.invoiceDueAt
                          ? new Date(r.invoiceDueAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'Not yet invoiced'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${TONE[r.status]}`}
                        >
                          {invoiceStatusLabel(r.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-zinc-500">
        Collecting a balance does not pay the Inspector. Inspector settlement is a
        separate manual action on{' '}
        <Link href="/admin/payouts" className="underline">
          /admin/payouts
        </Link>
        .
      </p>
    </main>
  );
}
