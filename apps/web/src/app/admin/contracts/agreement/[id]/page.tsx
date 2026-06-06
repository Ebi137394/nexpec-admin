// app/admin/contracts/agreement/[id]/page.tsx — admin read-only viewer for a single
//   brokered deal agreement (client_supply / supplier_supply / inspector_engagement).
//   Shows the MSA+Schedule body, status timeline, and tamper-evident seal.
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock, Fingerprint } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchDealAgreementById } from '@/lib/data/unifiedContracts';

export const metadata: Metadata = { title: 'Admin, Agreement' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  client_supply: 'Client Supply & Inspection',
  supplier_supply: 'Supplier Supply',
  inspector_engagement: 'Inspector Engagement',
};
function fmtCents(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((v || 0) / 100);
}

export default async function AdminAgreementViewer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/contracts/agreement/${id}`));
  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) redirect('/');

  const a = await fetchDealAgreementById(id);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/contracts"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-violet-glow"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Back to contracts
      </Link>

      {!a ? (
        <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-accent-red" strokeWidth={1.5} />
          <h1 className="mt-4 font-display text-xl font-semibold text-white">Agreement not found</h1>
          <p className="mt-2 text-sm text-zinc-400">It may have been voided, or the id is wrong.</p>
        </div>
      ) : (
        <>
          <header>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Admin, Brokered agreement
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {KIND_LABEL[a.kind] ?? a.kind}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Counterparty contracts with <span className="text-zinc-200">NEXPEC</span> (Broker of record). NEXPEC is party to every leg.
            </p>
          </header>

          {/* Status timeline */}
          <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatusStep label="Issued" ts={a.createdAt} done />
              <StatusStep label="Signed" ts={a.signedAt} done={!!a.signedAt} active={!a.signedAt && a.status === 'presented'} />
              <StatusStep label="Executed" ts={a.executedAt} done={a.status === 'executed'} active={!!a.signedAt && a.status !== 'executed'} />
            </div>
          </section>

          {/* Amount — party-projected, price-blind */}
          <section className="rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.10] to-transparent p-6">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              {a.kind === 'client_supply' ? 'Client price' : a.kind === 'inspector_engagement' ? 'Inspector payout' : 'Supplier cost'}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-violet-glow">{fmtCents(a.amountCents)}</p>
            <p className="mt-1 text-xs text-zinc-400">Each party sees only their own figure; the markup never crosses legs.</p>
          </section>

          {/* Agreement body */}
          {a.bodyMd && (
            <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
              <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-300">
                {a.bodyMd}
              </pre>
            </section>
          )}

          {/* Seal */}
          {a.contentSha256 && (
            <section className="rounded-3xl border border-accent-green/25 bg-accent-green/[0.05] p-6">
              <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-accent-green">
                <Fingerprint className="h-4 w-4" strokeWidth={1.75} /> Tamper-evident seal
              </h2>
              <p className="mt-3 break-all rounded-xl border border-white/[0.06] bg-ink-950 p-3 font-mono text-[11px] text-accent-green/90">
                sha256:{a.contentSha256}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatusStep({
  label,
  ts,
  done,
  active,
}: {
  label: string;
  ts: string | null;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={
        'rounded-2xl border p-4 ' +
        (done
          ? 'border-accent-green/30 bg-accent-green/5'
          : active
            ? 'border-violet/40 bg-violet/10'
            : 'border-white/[0.06] bg-white/[0.01]')
      }
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
        ) : (
          <Clock className={'h-4 w-4 ' + (active ? 'text-violet-glow' : 'text-zinc-500')} strokeWidth={1.75} />
        )}
        <p
          className={
            'text-[10px] font-semibold uppercase tracking-industrial ' +
            (done ? 'text-accent-green' : active ? 'text-violet-glow' : 'text-zinc-500')
          }
        >
          {label}
        </p>
      </div>
      <p className={'mt-1.5 text-xs ' + (ts ? 'font-mono text-zinc-300' : 'text-zinc-600')}>
        {ts ? new Date(ts).toLocaleString() : 'Pending'}
      </p>
    </div>
  );
}
