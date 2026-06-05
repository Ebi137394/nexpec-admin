'use client';
// components/marketplace/DocumentField.tsx — web Vendor Custody upload.
//
// Browser mirror of the mobile DocumentField. One click for the vendor;
// underneath: File → crypto.subtle SHA-256 (raw bytes, sha256sum-matching) →
// upload to the private vendor_documents bucket → vendor_document_seal folds it
// into the Trust Spine + enqueues OpenTimestamps. Same backend, same seal.
import { useRef, useState } from 'react';
import { UploadCloud, FileText, ShieldCheck, Clock, Bitcoin, X } from 'lucide-react';
import { getUserId, uploadVendorFile, sealVendorDocument } from '@/lib/data/marketplace';

const ACCEPT = '.pdf,image/*,.doc,.docx,.xls,.xlsx';

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DocValue {
  doc_id?: string; filename?: string; path: string; content_sha256: string;
  seal_sha256?: string; ots_status?: string;
}

export function DocumentField({ label, docType = 'other', helperText, required, value, onChange }: {
  label: string; docType?: string; helperText?: string; required?: boolean;
  value: DocValue | null; onChange: (v: DocValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null); setBusy(true);
    try {
      setStage('Fingerprinting…');
      const contentSha = await sha256Hex(file);
      const uid = await getUserId();
      if (!uid) { setErr('Not signed in.'); return; }
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/${docType}/${Date.now()}_${safe}`;

      setStage('Uploading…');
      const { error: upErr } = await uploadVendorFile(path, file);
      if (upErr) { setErr(upErr.message); return; }

      setStage('Sealing…');
      const { data: sealed, error: sealErr } = await sealVendorDocument({
        storage_path: path, content_sha256: contentSha, doc_type: docType,
        title: file.name, mime_type: file.type || null, byte_size: file.size, bound_type: 'vendor', bound_id: uid,
      });
      if (sealErr) { setErr(sealErr.message); return; }

      onChange({
        doc_id: (sealed as any)?.id, filename: file.name, path, content_sha256: contentSha,
        seal_sha256: (sealed as any)?.seal_sha256, ots_status: (sealed as any)?.ots_status ?? 'pending',
      });
    } catch (e: any) {
      setErr(e?.message ?? 'Upload failed');
    } finally { setBusy(false); setStage(''); }
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-white/60">{label}{required ? ' *' : ''}</label>
      {helperText && <p className="mb-2 text-xs text-white/50">{helperText}</p>}
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onPick} className="hidden" />

      {!value ? (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-600 bg-ink-800 px-4 py-6 text-center transition hover:border-violet/60 disabled:opacity-60">
          <UploadCloud size={24} className="text-violet-glow" />
          <span className="text-sm font-bold">{busy ? stage || 'Working…' : 'Upload document'}</span>
          {!busy && <span className="text-xs text-white/50">PDF, image or Office file, sealed on upload</span>}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-800 p-3">
          <FileText size={22} className="shrink-0 text-violet-glow" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{value.filename || 'Document'}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <ShieldCheck size={12} className="text-accent-green" /><span className="font-bold text-accent-green">Sealed</span>
              <span className="text-white/30">·</span>
              {value.ots_status === 'bitcoin_confirmed'
                ? <><Bitcoin size={12} className="text-accent-amber" /><span className="font-bold text-accent-amber">Bitcoin-anchored</span></>
                : <><Clock size={12} className="text-accent-amber" /><span className="font-bold text-accent-amber">Notarization pending</span></>}
            </div>
            {value.seal_sha256 && <p className="mt-0.5 truncate font-mono text-[10px] text-white/40">seal {value.seal_sha256.slice(0, 18)}…</p>}
          </div>
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-white/40 hover:text-white"><X size={18} /></button>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-accent-red">{err}</p>}
    </div>
  );
}
