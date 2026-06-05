'use client';
// /suppliers/profile — create OR edit the vendor profile (supplier_onboard upserts).
// Pre-fills from the existing row so saving never wipes prior data. Optional
// Vendor Custody cert uploads are sealed through the Trust Spine on upload.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react';
import {
  fetchCapabilityCatalog, fetchMyVendorProfile, onboardSupplier,
  type CapabilityOption, type VendorProfile,
} from '@/lib/data/marketplace';
import { DocumentField, type DocValue } from '@/components/marketplace/DocumentField';

const inp = 'w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function SupplierProfilePage() {
  const router = useRouter();
  const [caps, setCaps] = useState<CapabilityOption[]>([]);
  const [existing, setExisting] = useState<VendorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [legalName, setLegalName] = useState('');
  const [headline, setHeadline] = useState('');
  const [country, setCountry] = useState('');
  const [standards, setStandards] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [iso, setIso] = useState<DocValue | null>(null);
  const [accr, setAccr] = useState<DocValue | null>(null);
  const [ins, setIns] = useState<DocValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([fetchCapabilityCatalog().catch(() => []), fetchMyVendorProfile().catch(() => null)])
      .then(([c, p]) => {
        setCaps(c);
        if (p) {
          setExisting(p);
          setLegalName(p.legal_name ?? '');
          setHeadline(p.headline ?? '');
          setCountry(p.country_code ?? '');
          setSelected(p.capabilities ?? []);
          const std = (p.attributes as { standards?: string[] } | null)?.standards;
          if (Array.isArray(std)) setStandards(std.join(', '));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, CapabilityOption[]> = {};
    caps.forEach((c) => { (g[c.category] ??= []).push(c); });
    return g;
  }, [caps]);

  const toggle = (k: string) => setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const submit = async () => {
    setErr(null); setSaved(false);
    if (!legalName.trim()) { setErr('Company / legal name is required.'); return; }
    if (selected.length === 0) { setErr('Pick at least one capability so buyers can find you.'); return; }
    setBusy(true);
    try {
      const attributes: Record<string, unknown> = {};
      if (standards.trim()) attributes.standards = standards.split(',').map((x) => x.trim()).filter(Boolean);
      const { error } = await onboardSupplier({
        legal_name: legalName.trim(), headline: headline.trim() || null,
        capabilities: selected, attributes, country: country.trim() || null,
      });
      if (error) { setErr(error.message); return; }
      setSaved(true);
      if (!existing) { router.push('/suppliers/dashboard'); return; }
    } finally { setBusy(false); }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">My Business</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">
            {existing ? 'Profile & Capabilities' : 'Become a Supplier'}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {existing
              ? 'Keep your listing sharp, capabilities power RFQ matching across every discipline.'
              : 'List your company to appear in the directory and bid on brokered RFQs.'}
          </p>
        </div>
        {existing?.verified && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-green/30 bg-accent-green/10 px-3 py-1.5 text-xs font-bold text-accent-green">
            <ShieldCheck size={14} /> Verified vendor
          </span>
        )}
      </header>

      {/* Identity */}
      <Card title="Company identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company / legal name *" className="sm:col-span-2">
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="ACME Manufacturing GmbH" className={inp} />
          </Field>
          <Field label="Headline" className="sm:col-span-2">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="ISO 17025 calibration lab, GCC" className={inp} />
          </Field>
          <Field label="Country code">
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="AE" className={inp} />
          </Field>
          <Field label="Standards served (comma-separated)">
            <input value={standards} onChange={(e) => setStandards(e.target.value)} placeholder="ASME, EN, ISO" className={inp} />
          </Field>
        </div>
      </Card>

      {/* Capabilities */}
      <Card title="Capabilities" subtitle="Selected capabilities determine which RFQs you're matched to.">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="mb-4 last:mb-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-industrial text-zinc-500">{cat}</p>
            <div className="flex flex-wrap gap-2">
              {list.map((c) => {
                const on = selected.includes(c.key);
                return (
                  <button key={c.key} type="button" onClick={() => toggle(c.key)}
                    className={on
                      ? 'rounded-full border border-violet bg-violet px-3 py-1.5 text-xs font-semibold text-white'
                      : 'rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-xs font-semibold text-zinc-400 transition hover:text-white'}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {selected.length > 0 && <p className="mt-1 text-xs text-zinc-500">{selected.length} selected</p>}
      </Card>

      {/* Certifications */}
      <Card title="Certifications & documents" subtitle="Optional, every file is cryptographically sealed and timestamped on upload, then reviewed for verification.">
        <div className="space-y-4">
          <DocumentField label="ISO / Quality certificate" docType="iso_cert" helperText="e.g. ISO 9001 or ISO 17025" value={iso} onChange={setIso} />
          <DocumentField label="Accreditation certificate" docType="accreditation" helperText="Lab / inspection body accreditation" value={accr} onChange={setAccr} />
          <DocumentField label="Insurance (optional)" docType="insurance" helperText="Liability / professional indemnity" value={ins} onChange={setIns} />
        </div>
        {existing && <p className="mt-3 text-xs text-zinc-500">Uploaded documents appear in your <a href="/suppliers/documents" className="font-semibold text-violet-glow hover:text-white">Document Vault</a>.</p>}
      </Card>

      {err && <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">{err}</p>}
      {saved && existing && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-sm text-accent-green">
          <CheckCircle2 size={15} /> Profile saved.
        </p>
      )}

      <button onClick={submit} disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold text-white transition hover:bg-violet-deep disabled:opacity-60 sm:w-auto sm:px-8">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Store size={16} />}
        {busy ? 'Saving…' : existing ? 'Save changes' : 'List my company'}
      </button>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <h2 className="font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-0.5 mb-4 text-sm text-zinc-400">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
