'use client';
// /suppliers/documents — Vendor Document Vault. Every artifact is sealed through
// the Trust Spine (content SHA-256 → canonical-JSON seal) and notarized via
// OpenTimestamps (Bitcoin). Upload here or during onboarding; this is the registry.
import { useEffect, useState } from 'react';
import { FileText, ShieldCheck, Clock, Bitcoin, AlertTriangle, ExternalLink, FolderLock } from 'lucide-react';
import {
  fetchMyVendorDocuments, signVendorDocument, type VendorDocument,
} from '@/lib/data/marketplace';
import { DocumentField, type DocValue } from '@/components/marketplace/DocumentField';

const DOC_LABEL: Record<string, string> = {
  iso_cert: 'ISO / Quality', accreditation: 'Accreditation', insurance: 'Insurance',
  financial: 'Financial', nda: 'NDA', msa: 'MSA', technical_proposal: 'Technical proposal',
  mill_cert: 'Mill certificate', other: 'Other',
};
const DOC_TYPES = Object.keys(DOC_LABEL);

function bytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState('iso_cert');
  const [pending, setPending] = useState<DocValue | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchMyVendorDocuments().then(setDocs).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // When a fresh upload seals, refetch the registry and clear the field.
  useEffect(() => { if (pending) { load(); setPending(null); } }, [pending]);

  const open = async (d: VendorDocument) => {
    setOpening(d.id);
    try {
      const url = await signVendorDocument(d.storage_path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally { setOpening(null); }
  };

  const verified = docs.filter((d) => d.ots_status === 'bitcoin_confirmed').length;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">My Business</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">Document Vault</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Certificates and accreditations, cryptographically sealed and Bitcoin-notarized. Tamper-evident by design.
        </p>
      </header>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<FolderLock size={18} />} tone="text-violet-glow" value={String(docs.length)} label="Sealed documents" />
        <Stat icon={<Bitcoin size={18} />} tone="text-accent-amber" value={String(verified)} label="Bitcoin-anchored" />
        <Stat icon={<Clock size={18} />} tone="text-cyan-glow" value={String(docs.length - verified)} label="Notarization pending" />
      </div>

      {/* Upload */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <h2 className="font-semibold text-white">Seal a new document</h2>
        <p className="mt-0.5 mb-4 text-sm text-zinc-400">Choose a type, then upload, fingerprint, seal and timestamp happen automatically.</p>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Document type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet">
              {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
            </select>
          </div>
          <DocumentField key={docType} label="File" docType={docType} value={pending} onChange={setPending} />
        </div>
      </section>

      {/* Registry */}
      <section>
        <h2 className="mb-3 font-semibold text-white">Sealed registry</h2>
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
        ) : docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><FolderLock size={22} className="text-violet-glow" /></div>
            <p className="mt-3 text-sm font-semibold text-white">No documents sealed yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">Upload your ISO, accreditation or insurance certificates above. Each one is hashed, sealed into the Trust Spine, and anchored to Bitcoin for permanent, verifiable provenance.</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow"><FileText size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">{d.title || 'Document'}</p>
                    <span className="rounded-md border border-white/[0.08] bg-ink-950 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">{DOC_LABEL[d.doc_type] ?? d.doc_type}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-bold text-accent-green"><ShieldCheck size={12} /> Sealed</span>
                    <span className="text-white/20">·</span>
                    <OtsBadge status={d.ots_status} />
                    {d.byte_size ? <><span className="text-white/20">·</span><span className="text-zinc-500">{bytes(d.byte_size)}</span></> : null}
                    <span className="text-white/20">·</span>
                    <span className="text-zinc-500">{new Date(d.created_at).toLocaleDateString()}</span>
                  </div>
                  {d.seal_sha256 && <p className="mt-0.5 truncate font-mono text-[10px] text-white/30">seal {d.seal_sha256.slice(0, 24)}…</p>}
                </div>
                <button onClick={() => open(d)} disabled={opening === d.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-bold text-zinc-200 transition hover:border-violet/50 hover:text-white disabled:opacity-50">
                  <ExternalLink size={13} /> {opening === d.id ? 'Opening…' : 'View'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, tone, value, label }: { icon: React.ReactNode; tone: string; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] ${tone}`}>{icon}</span>
      <p className="mt-2.5 font-display text-2xl font-semibold text-white">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function OtsBadge({ status }: { status: string }) {
  if (status === 'bitcoin_confirmed') return <span className="inline-flex items-center gap-1 font-bold text-accent-amber"><Bitcoin size={12} /> Bitcoin-anchored</span>;
  if (status === 'failed') return <span className="inline-flex items-center gap-1 font-bold text-accent-red"><AlertTriangle size={12} /> Notarization failed</span>;
  return <span className="inline-flex items-center gap-1 font-bold text-cyan-glow"><Clock size={12} /> Notarization pending</span>;
}
