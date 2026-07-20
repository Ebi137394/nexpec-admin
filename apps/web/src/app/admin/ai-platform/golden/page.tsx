'use client';
import { Lock } from 'lucide-react';
import { AiTable, StatusBadge, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Golden extends Record<string, unknown> {
  id: string; name: string; model_slug: string; purpose: string; frozen: boolean; created_at: string;
}

const columns: Column<Golden>[] = [
  { key: 'name', label: 'Name', sortable: true, render: (r) => <span className="font-semibold text-white">{r.name}</span> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'purpose', label: 'Purpose', render: (r) => <span className="text-xs text-zinc-400">{r.purpose}</span> },
  { key: 'frozen', label: 'State', render: (r) => r.frozen ? <span className="inline-flex items-center gap-1 text-xs text-violet-glow"><Lock size={11} /> Locked</span> : <StatusBadge value="unconfigured" /> },
  { key: 'created_at', label: 'Created', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function GoldenPage() {
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Curated, ground‑truth regression sets used to benchmark every new model version. A <span className="text-white">locked</span> golden dataset cannot be silently modified — changes require an explicit unlock and are audited.</p>
      <AiTable<Golden>
        resource="golden"
        columns={columns}
        defaultSort="created_at"
        emptyTitle="No golden datasets yet"
        emptyBody="Create a golden dataset from accepted or hard‑example samples to lock in a stable benchmark for model regression testing."
      />
    </div>
  );
}
