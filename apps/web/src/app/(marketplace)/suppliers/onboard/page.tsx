'use client';
// /suppliers/onboard — Become a Supplier + Vendor Custody cert uploads
// (mirrors mobile app/suppliers/onboard.tsx)
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store } from 'lucide-react';
import { fetchCapabilityCatalog, onboardSupplier, type CapabilityOption } from '@/lib/data/marketplace';
import { DocumentField, type DocValue } from '@/components/marketplace/DocumentField';

const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function SupplierOnboardPage() {
  const router = useRouter();
  const [caps, setCaps] = useState<CapabilityOption[]>([]);
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

  useEffect(() => { fetchCapabilityCatalog().then(setCaps).catch(() => {}); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, CapabilityOption[]> = {};
    caps.forEach((c) => { (g[c.category] ??= []).push(c); });
    return g;
  }, [caps]);

  const toggle = (k: string) => setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const submit = async () => {
    setErr(null);
    if (!legalName.trim()) { setErr('Company name is required.'); return; }
    if (selected.length === 0) { setErr('Pick at least one capability.'); return; }
    setBusy(true);
    try {
      const attributes: any = standards.trim() ? { standards: standards.split(',').map((x) => x.trim()).filter(Boolean) } : {};
      const { error } = await onboardSupplier({ legal_name: legalName.trim(), headline: headline.trim() || null, capabilities: selected, attributes, country: country.trim() || null });
      if (error) { setErr(error.message); return; }
      router.push('/suppliers');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">Become a Supplier</h1>
      <p className="mt-1 text-sm text-white/60">List your capabilities to appear in the directory and bid on RFQs.</p>

      <div className="mt-6 space-y-5">
        <Field label="Company / legal name *"><input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="ACME Manufacturing GmbH" className={inp} /></Field>
        <Field label="Headline"><input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="ISO 17025 calibration lab · GCC" className={inp} /></Field>
        <Field label="Country code"><input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="AE" className={inp} /></Field>

        <div>
          <p className="mb-2 text-sm font-bold">Capabilities *</p>
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="mb-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">{cat}</p>
              <div className="flex flex-wrap gap-2">
                {list.map((c) => {
                  const on = selected.includes(c.key);
                  return <button key={c.key} type="button" onClick={() => toggle(c.key)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? 'border-violet bg-violet text-white' : 'border-ink-600 bg-ink-800 text-white/70 hover:text-white'}`}>{c.label}</button>;
                })}
              </div>
            </div>
          ))}
        </div>

        <Field label="Standards served (comma-separated)"><input value={standards} onChange={(e) => setStandards(e.target.value)} placeholder="ASME, EN, ISO" className={inp} /></Field>

        <div>
          <p className="text-sm font-bold">Certifications &amp; Documents</p>
          <p className="mb-3 mt-0.5 text-xs text-white/50">Optional now — every file is cryptographically sealed and timestamped on upload, then reviewed for verification.</p>
          <div className="space-y-4">
            <DocumentField label="ISO / Quality certificate" docType="iso_cert" helperText="e.g. ISO 9001 or ISO 17025" value={iso} onChange={setIso} />
            <DocumentField label="Accreditation certificate" docType="accreditation" helperText="Lab / inspection body accreditation" value={accr} onChange={setAccr} />
            <DocumentField label="Insurance (optional)" docType="insurance" helperText="Liability / professional indemnity" value={ins} onChange={setIns} />
          </div>
        </div>

        {err && <p className="text-sm text-accent-red">{err}</p>}
        <button onClick={submit} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 font-bold hover:bg-violet-deep disabled:opacity-60">
          <Store size={16} /> {busy ? 'Saving…' : 'List my company'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-white/60">{label}</label>{children}</div>;
}
