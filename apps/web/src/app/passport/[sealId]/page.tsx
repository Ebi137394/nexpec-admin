// ════════════════════════════════════════════════════════════════════════════
//  app/passport/[sealId]/page.tsx — public Verifiable Inspection Passport (VIP)
//
//  Unauthenticated by design (middleware gates /admin,/client,/inspector only).
//  Anyone with the link — a regulator, an insurer, an asset owner — can confirm:
//    • the report's cryptographic seal (root hash) and that its capture chain
//      is unaltered,
//    • that the inspector's certifications + equipment calibration were valid
//      AT the time of inspection,
//    • the OpenTimestamps / Bitcoin anchor status.
//  Powered by the public get_inspection_passport() RPC + the shared-core
//  passport contract. Mirrors the /verify + /p public-page patterns.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, ShieldAlert, BadgeCheck, Wrench, Hash, Clock, Anchor } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseInspectionPassport, passportTrustVerdict, anchorLabel } from '@nexpec/shared-core';
import { TrustSigil } from '@/components/trust/TrustSigil';
import { inspectorHandle } from '@/lib/identity/inspectorHandle';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NEXPEC Inspection Passport',
  description: 'Independently verify a NEXPEC sealed inspection — integrity, inspector credentials at inspection time, and blockchain anchor.',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ sealId: string }>;
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toUTCString();
}

export default async function PassportPage({ params }: PageProps) {
  const { sealId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc('get_inspection_passport', { p_seal_id: sealId });
  const passport = parseInspectionPassport(data);

  if (!passport) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6 text-zinc-100">
        <div className="text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-400" strokeWidth={1.75} />
          <h1 className="mt-4 text-xl font-semibold">Passport not found</h1>
          <p className="mt-2 text-sm text-zinc-400">No sealed inspection matches this identifier.</p>
          <Link href="/verify" className="mt-6 inline-block text-sm text-violet-300 hover:text-violet-200">
            Verify a full evidence pack →
          </Link>
        </div>
      </div>
    );
  }

  const verdict = passportTrustVerdict(passport);
  const ok = verdict.ok;

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl">
        {/* Verdict banner */}
        <div className={`flex items-center gap-4 rounded-2xl border p-5 ${ok ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.06]'}`}>
          {ok ? <ShieldCheck className="h-9 w-9 shrink-0 text-emerald-400" strokeWidth={1.75} />
              : <ShieldAlert className="h-9 w-9 shrink-0 text-amber-400" strokeWidth={1.75} />}
          <div>
            <h1 className="text-lg font-semibold">{ok ? 'Verified inspection seal' : 'Seal integrity flagged'}</h1>
            <p className="text-sm text-zinc-400">NEXPEC Inspection Passport · independently verifiable</p>
          </div>
        </div>

        {/* Trust notes */}
        <ul className="mt-4 space-y-1.5">
          {verdict.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2} />
              {n}
            </li>
          ))}
        </ul>

        {/* Seal */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Hash className="h-3.5 w-3.5" strokeWidth={2} /> Cryptographic seal
          </h2>
          <p className="break-all font-mono text-[13px] text-violet-200">{passport.seal.rootSha256}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-zinc-500">Algorithm</dt><dd className="font-mono text-zinc-200">{passport.seal.algorithm}</dd></div>
            <div><dt className="text-zinc-500">Chain</dt><dd className={passport.seal.chainVerified ? 'text-emerald-400' : 'text-amber-400'}>{passport.seal.chainVerified ? 'verified — unaltered' : 'break detected'}</dd></div>
            <div><dt className="text-zinc-500">Photos sealed</dt><dd className="text-zinc-200">{passport.seal.capturesCount}</dd></div>
            <div><dt className="text-zinc-500">Findings sealed</dt><dd className="text-zinc-200">{passport.seal.itemsCount}</dd></div>
            <div className="col-span-2"><dt className="text-zinc-500">Sealed at</dt><dd className="text-zinc-200">{fmt(passport.seal.sealedAt)}</dd></div>
          </dl>
        </section>

        {/* Inspector + credentials at seal time */}
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} /> Inspector
            </h2>
            {/* ANTI-POACHING: pseudonymous handle + sigil, never a name. Links to
                the anonymized trust card. */}
            <Link
              href={`/p/${passport.inspector.id}`}
              className="group mt-1 inline-flex items-center gap-3"
            >
              <TrustSigil
                id={passport.inspector.id}
                size={40}
                className="h-10 w-10 rounded-xl ring-1 ring-white/10"
              />
              <span className="min-w-0">
                <span className="block text-base text-zinc-100">NEXPEC-Verified Inspector</span>
                <span className="block font-mono text-sm text-violet-300 group-hover:text-violet-200">
                  {inspectorHandle(passport.inspector.id)}
                </span>
              </span>
            </Link>
            <p className="mt-3 text-sm text-zinc-400">
              {passport.credentials.certificationsValidAtSeal} certification(s) valid at inspection
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Wrench className="h-3.5 w-3.5" strokeWidth={2} /> Equipment
            </h2>
            <p className="text-base text-zinc-100">{passport.credentials.equipmentInCalibrationAtSeal} in calibration</p>
            <p className="mt-2 text-sm text-zinc-400">as of the inspection date</p>
          </div>
        </section>

        {/* Anchor */}
        <section className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <Anchor className="h-5 w-5 shrink-0 text-violet-300" strokeWidth={2} />
          <div className="flex-1">
            <p className="text-sm text-zinc-200">{anchorLabel(passport.anchor.status)}</p>
            {passport.anchor.confirmedAt && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock className="h-3 w-3" strokeWidth={2} /> {fmt(passport.anchor.confirmedAt)}
              </p>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-zinc-500">
          This passport is independently verifiable by anyone with this link — no NEXPEC account required.{' '}
          <Link href="/verify" className="text-violet-300 hover:text-violet-200">Recompute the full evidence pack →</Link>
        </p>
      </div>
    </div>
  );
}
