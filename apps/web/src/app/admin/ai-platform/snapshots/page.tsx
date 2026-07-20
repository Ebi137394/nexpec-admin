'use client';
import { useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { AiTable, dOnly, dt, type Column } from '@/components/admin/ai-platform/kit';
import { confirmDialog, alertDialog } from '@/components/ui/AppDialog';

interface Snap extends Record<string, unknown> { id: string; month: string; created_at: string }

const columns: Column<Snap>[] = [
  { key: 'month', label: 'Month', sortable: true, render: (r) => <span className="font-semibold text-white">{dOnly(r.month)}</span> },
  { key: 'created_at', label: 'Created', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function SnapshotsPage() {
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const create = async () => {
    if (!(await confirmDialog({ title: 'Create monthly snapshot', body: "This freezes the current month's dataset + model versions + manifest. It is idempotent — running twice for the same month returns the existing snapshot.", confirmText: 'Create snapshot' }))) return;
    setBusy(true);
    try {
      const r = await fetch('/api/ai-ops/snapshots/create', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      await alertDialog({ title: 'Snapshot ready', body: 'This month’s snapshot has been created (or already existed).' });
      setNonce((n) => n + 1);
    } catch (e) {
      await alertDialog({ title: 'Could not create snapshot', body: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-zinc-400">Monthly snapshots freeze the dataset + model versions + counts + a manifest for point‑in‑time reproducibility. Creation is idempotent per month via the <span className="font-mono text-xs">ai_ops_create_monthly_snapshot</span> RPC (admin only).</p>
        <button onClick={create} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-deep disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} Create this month
        </button>
      </div>
      <AiTable<Snap>
        key={nonce}
        resource="snapshots"
        columns={columns}
        defaultSort="month"
        searchable={false}
        emptyTitle="No monthly snapshots"
        emptyBody="Snapshots are created on a monthly cron or on demand. Each records the dataset version, model versions, counts, statistics, and a frozen manifest."
      />
    </div>
  );
}
