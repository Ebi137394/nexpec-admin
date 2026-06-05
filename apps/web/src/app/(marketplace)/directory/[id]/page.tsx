'use client';
// /directory/[id] — supplier public profile (admins + buyers).
// Reads the anti-poaching-safe supplier_directory projection (business-level
// fields only). Lets a buyer jump straight to raising an RFQ.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Star, MapPin, FileText, Award } from 'lucide-react';
import {
  fetchSupplierById, fetchCapabilityCatalog, type SupplierCard, type CapabilityOption,
} from '@/lib/data/marketplace';
import { TrustSigil } from '@/components/trust/TrustSigil';
import { nxHandle } from '@/lib/identity/inspectorHandle';

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '') as string;
  const [supplier, setSupplier] = useState<SupplierCard | null>(null);
  const [caps, setCaps] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchSupplierById(id).catch(() => null), fetchCapabilityCatalog().catch(() => [])])
      .then(([s, c]) => { setSupplier(s); setCaps(c); })
      .finally(() => setLoading(false));
  }, [id]);

  const capLabel = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c.label])), [caps]);
  const standards: string[] = Array.isArray(supplier?.standards) ? (supplier!.standards as string[]) : [];

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <div className="mt-4 h-48 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <div className="mt-6 rounded-xl border border-ink-600 bg-ink-800 p-10 text-center">
          <p className="text-white/60">Supplier not found, or no longer listed.</p>
          <Link href="/directory" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-violet px-4 py-2 text-sm font-bold text-violet-glow hover:bg-violet/10">Back to directory</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      {/* Header */}
      <header className="rounded-2xl border border-ink-600 bg-gradient-to-br from-violet/[0.1] to-ink-950 p-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 overflow-hidden rounded-2xl"><TrustSigil id={supplier.id} size={64} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display font-mono text-2xl font-semibold tracking-tight text-white sm:text-3xl">{nxHandle(supplier.id)}</h1>
              {supplier.verified && (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2.5 py-1 text-[11px] font-bold text-accent-green">
                  <ShieldCheck size={13} /> Verified
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-white/50">Identity protected. NEXPEC brokers all engagement. Raise an RFQ to transact.</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
              <span className="inline-flex items-center gap-1"><Star size={12} className="text-accent-amber" /> {Number(supplier.rating_avg ?? 0).toFixed(1)} ({supplier.rating_count ?? 0} reviews)</span>
              {supplier.country_code && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {supplier.country_code}</span>}
            </div>
          </div>
        </div>
        <Link href="/rfqs/new" className="mt-5 inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-deep">
          <FileText size={16} /> Request a quote
        </Link>
      </header>

      {/* Capabilities */}
      <section className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
        <h2 className="font-bold text-white">Capabilities</h2>
        {(supplier.capabilities?.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-white/50">No capabilities listed.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {supplier.capabilities.map((k) => (
              <span key={k} className="rounded-lg border border-ink-600 bg-ink-950 px-2.5 py-1 text-xs font-semibold text-white/80">{capLabel[k] ?? k}</span>
            ))}
          </div>
        )}
      </section>

      {/* Standards */}
      {standards.length > 0 && (
        <section className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h2 className="flex items-center gap-1.5 font-bold text-white"><Award size={16} className="text-violet-glow" /> Standards served</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {standards.map((s) => (
              <span key={s} className="rounded-lg border border-ink-600 bg-ink-950 px-2.5 py-1 text-xs font-semibold text-white/80">{s}</span>
            ))}
          </div>
        </section>
      )}

      {/* Trust note */}
      <p className="flex items-center gap-1.5 text-xs text-white/40">
        <ShieldCheck size={13} /> Verification and certificates are reviewed by NEXPEC. Sourcing is admin-brokered. Raise an RFQ to engage this supplier.
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/directory" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
      <ArrowLeft size={15} /> Directory
    </Link>
  );
}
