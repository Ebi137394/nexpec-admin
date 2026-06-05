'use client';
// /rfqs/new — Create RFQ with cross-discipline scope picker (mirrors mobile app/rfqs/new.tsx)
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send } from 'lucide-react';
import { fetchScopeTemplates, createRfq, type ScopeTemplate } from '@/lib/data/marketplace';

const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function NewRfqPage() {
  const router = useRouter();
  const [scopes, setScopes] = useState<ScopeTemplate[]>([]);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState('');
  const [requiresInspection, setRequiresInspection] = useState(true);
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetchScopeTemplates().then(setScopes).catch(() => {}); }, []);

  const byDomain = useMemo(() => {
    const g: Record<string, ScopeTemplate[]> = {};
    scopes.forEach((x) => { (g[x.domain] ??= []).push(x); });
    return g;
  }, [scopes]);

  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (requiresInspection && !scopeId) { setErr('Pick an inspection discipline, or turn off source inspection.'); return; }
    setBusy(true);
    try {
      const spec: any = {};
      if (details.trim()) spec.details = details.trim();
      if (qty.trim()) spec.quantity = qty.trim();
      const { error } = await createRfq({
        title: title.trim(), spec,
        scope_template_id: requiresInspection ? scopeId || null : null,
        requires_source_inspection: requiresInspection, broker_mode: 'admin',
      });
      if (error) { setErr(error.message); return; }
      router.push('/rfqs');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
        <ArrowLeft size={15} /> RFQs
      </Link>
      <h1 className="text-2xl font-extrabold">New RFQ</h1>
      <p className="mt-1 text-sm text-white/60">Suppliers bid; on award NEXPEC auto-dispatches the matched inspector.</p>

      <div className="mt-6 space-y-5">
        <Field label="What are you sourcing? *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 20× ASME B16.5 WN flanges, 6in 150#" className={inp} />
        </Field>
        <Field label="Specification / details">
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} placeholder="Material grade, standards, delivery terms…" className={inp} />
        </Field>
        <Field label="Quantity">
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 20 units" className={inp} />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
          <input type="checkbox" checked={requiresInspection} onChange={(e) => setRequiresInspection(e.target.checked)} className="mt-1 h-4 w-4 accent-violet" />
          <span>
            <span className="block text-sm font-bold">Require source / FAT inspection</span>
            <span className="mt-0.5 block text-xs text-white/60">NEXPEC dispatches a discipline-matched inspector to the supplier facility before shipment.</span>
          </span>
        </label>

        {requiresInspection && (
          <Field label="Inspection discipline *">
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={inp}>
              <option value="">Choose discipline / scope…</option>
              {Object.entries(byDomain).map(([domain, list]) => (
                <optgroup key={domain} label={domain.toUpperCase()}>
                  {list.map((sc) => <option key={sc.id} value={sc.id}>{sc.name} ({sc.category})</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        )}

        {err && <p className="text-sm text-accent-red">{err}</p>}

        <button onClick={submit} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold hover:bg-violet-deep disabled:opacity-60">
          <Send size={16} /> {busy ? 'Posting…' : 'Post RFQ'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-white/60">{label}</label>{children}</div>;
}
