'use client';
import { ShieldCheck } from 'lucide-react';
import { AiTable, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Audit extends Record<string, unknown> {
  id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; created_at: string;
}

const columns: Column<Audit>[] = [
  { key: 'action', label: 'Action', render: (r) => <span className="font-mono text-xs text-violet-glow">{r.action}</span> },
  { key: 'entity', label: 'Entity', render: (r) => <span className="text-xs">{r.entity}</span> },
  { key: 'entity_id', label: 'Entity ID', render: (r) => <span className="font-mono text-xs text-zinc-500">{r.entity_id ? String(r.entity_id).slice(0, 16) : '—'}</span> },
  { key: 'actor_id', label: 'Actor', render: (r) => <span className="font-mono text-xs text-zinc-500">{r.actor_id ? String(r.actor_id).slice(0, 8) + '…' : 'system'}</span> },
  { key: 'created_at', label: 'When', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function AuditPage() {
  return (
    <div>
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-green/25 bg-accent-green/[0.06] px-3 py-1 text-xs font-semibold text-accent-green">
        <ShieldCheck size={13} /> Append‑only — records cannot be edited or deleted (DB‑trigger enforced)
      </div>
      <AiTable<Audit>
        resource="audit"
        columns={columns}
        defaultSort="id"
        emptyTitle="Audit log is empty"
        emptyBody="Every lifecycle change, deployment, export, snapshot and rollback appends an immutable row here with actor, action, entity and timestamp."
      />
    </div>
  );
}
