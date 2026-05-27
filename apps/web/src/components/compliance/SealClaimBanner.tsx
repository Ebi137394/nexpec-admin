// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/compliance/SealClaimBanner.tsx
//
//  Renders the URL-claimed seal_id + root_hash above the EvidencePackVerifier
//  on /verify. Pure client-side display of the URL claim — NO server
//  roundtrip, NO database read. The whole point of /verify is that NEXPEC
//  cannot lie to a third party because they don't need to trust us.
//
//  The auditor compares the URL-claimed hash to the one the verifier
//  recomputes from the dropped pack. If they match, the URL link is
//  authentic. If they don't, the link's claim is wrong (or the pack has
//  been modified).
//
//  Inputs come from `?seal_id=...&hash=...` on the verify URL — the same
//  format the mobile screen's "Copy verifier link" produces.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useSearchParams } from 'next/navigation';
import { Fingerprint, ShieldCheck } from 'lucide-react';

export function SealClaimBanner() {
  const params = useSearchParams();
  const sealId = params?.get('seal_id')?.trim() ?? '';
  const hash = params?.get('hash')?.trim() ?? '';

  if (!sealId || !hash) return null;

  // Light defensive validation. We don't reject — we render whatever the URL
  // claims and let the auditor compare. But formatting the hex helps readability.
  const isHexish = /^[a-f0-9]{8,128}$/i.test(hash);
  const isUuidish = /^[0-9a-f-]{8,64}$/i.test(sealId);

  return (
    <section
      className="mt-8 rounded-2xl border border-violet/30 bg-violet/5 p-5"
      aria-label="Seal claim from URL"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-violet/15 p-2 ring-1 ring-inset ring-violet/30">
          <Fingerprint className="h-4 w-4 text-violet-glow" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-industrial text-violet-glow">
            URL CLAIM · INSPECTION REPORT SEAL
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            This link asserts that NEXPEC seal{' '}
            <code className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-violet-glow">
              {isUuidish ? sealId : '(malformed)'}
            </code>{' '}
            has the following SHA-256 root hash. Drop the pack file below
            and confirm the recomputed root matches exactly:
          </p>

          <p className="mt-3 break-all rounded-lg border border-white/[0.06] bg-ink-900/60 p-3 font-mono text-[11px] leading-relaxed text-violet-glow">
            {isHexish ? hash : '(malformed hash — expected lowercase hex)'}
          </p>

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="h-3 w-3" strokeWidth={2} />
            URL claims are advisory only. The proof is the hash the verifier
            recomputes from the dropped pack.
          </p>
        </div>
      </div>
    </section>
  );
}
