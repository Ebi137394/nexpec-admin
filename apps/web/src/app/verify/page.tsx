// ════════════════════════════════════════════════════════════════════════════
//  app/verify/page.tsx — Public evidence-pack verifier
//
//  Unauthenticated by design. The middleware gates /admin, /client, and
//  /inspector but leaves the rest of the routes open — so an external
//  auditor at PwC / EY / Deloitte / KPMG can drop a customer's pack
//  here without ever creating a NEXPEC account.
//
//  Everything happens client-side inside <EvidencePackVerifier>. No
//  server roundtrip after page load. No database access. No NEXPEC
//  involvement. The page exists to prove the chain-of-custody claim
//  without requiring trust in our infrastructure.
// ════════════════════════════════════════════════════════════════════════════

import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Shield,
  ShieldCheck,
  Code,
  Fingerprint,
  ExternalLink,
} from 'lucide-react';

import { EvidencePackVerifier } from '@/components/compliance/EvidencePackVerifier';
import { SealClaimBanner } from '@/components/compliance/SealClaimBanner';

export const metadata: Metadata = {
  title: 'Verify a NEXPEC Evidence Pack',
  description:
    'Drag-drop a NEXPEC evidence pack to recompute its SHA-256 chain-of-custody in your browser. No NEXPEC account or server access required — pure client-side verification.',
  robots: { index: true, follow: true },
};

export const dynamic = 'force-static';

export default function VerifyPage() {
  return (
    <div className="relative isolate min-h-screen bg-ink-950 text-zinc-100">
      {/* atmospheric layers — same as the rest of the app */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-40 topo-grid"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-violet/10 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-40 left-0 -z-10 h-[360px] w-[520px] rounded-full bg-cyan-glow/[0.06] blur-[120px]"
      />

      {/* tiny public header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-industrial text-zinc-300 transition-colors hover:text-violet-glow"
          >
            <Shield className="h-3.5 w-3.5 text-violet-glow" strokeWidth={2} />
            NEXPEC · COMPLIANCE EVIDENCE LOCKER
          </Link>
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-industrial text-emerald-400">
            CLIENT-SIDE · NO UPLOAD
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        {/* Hero */}
        <section className="text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 font-mono text-[10px] uppercase tracking-industrial text-violet-glow">
            <Fingerprint className="h-3 w-3" strokeWidth={2} />
            CEL/1.0 · PUBLIC VERIFICATION
          </p>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Verify a NEXPEC evidence pack.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm text-zinc-400">
            Drag the pack onto the area below. Your browser recomputes
            every SHA-256 hash against the canonical-JSON serialisation of
            each artifact and checks the chain-of-custody. Nothing leaves
            your machine. NEXPEC does not see the file.
          </p>
        </section>

        {/* Optional URL claim — surfaces seal_id+hash when the mobile
            "Copy verifier link" lands the auditor here. Wrapped in
            Suspense because useSearchParams requires it under static rendering. */}
        <Suspense fallback={null}>
          <SealClaimBanner />
        </Suspense>

        {/* Verifier */}
        <section className="mt-10">
          <EvidencePackVerifier />
        </section>

        {/* How it works */}
        <section className="mt-16 space-y-4">
          <header className="text-center">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              VERIFICATION PROTOCOL
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">
              What this page proves
            </h2>
          </header>
          <ol className="space-y-3">
            <ProtocolStep
              n={1}
              title="Canonical JSON"
              body="Each artifact (job, parties, contracts, approvals, invoices, audit_events, …) is re-serialised with object keys sorted lexicographically and whitespace stripped. This produces the same byte stream NEXPEC produced at export time."
            />
            <ProtocolStep
              n={2}
              title="SHA-256 per artifact"
              body="Your browser computes SHA-256 over the canonical bytes via SubtleCrypto. The result is compared to the hash declared in the pack's manifest. Any single byte difference flips this hash."
            />
            <ProtocolStep
              n={3}
              title="Root hash"
              body="The manifest's artifacts array is itself canonicalised and hashed. The root hash is one number that summarises the entire pack — if any per-artifact hash changes, the root hash changes."
            />
            <ProtocolStep
              n={4}
              title="Verdict"
              body="If every per-artifact hash matches AND the recomputed root matches the declared root, the pack is verifiably unmodified since NEXPEC issued it. If anything mismatches, the page reports TAMPERED with the specific artifact that failed."
            />
          </ol>
        </section>

        {/* Properties */}
        <section className="mt-12 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <header className="mb-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              GUARANTEES
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
              What this page does not require
            </h2>
          </header>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PropertyTile
              icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
              title="No NEXPEC account"
              body="Auditors verify without onboarding."
            />
            <PropertyTile
              icon={<Code className="h-4 w-4" strokeWidth={1.75} />}
              title="No server roundtrip"
              body="Pure browser. The file never leaves your machine."
            />
            <PropertyTile
              icon={<Fingerprint className="h-4 w-4" strokeWidth={1.75} />}
              title="No trust assumption"
              body="The algorithm is the proof — not our reputation."
            />
          </ul>
        </section>

        {/* Algorithm reference */}
        <section className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-6">
          <header className="mb-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
              CANONICAL-JSON REFERENCE
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              The serialisation algorithm fits in about 50 lines of pure
              TypeScript. Auditors are welcome to read it and re-implement
              independently in their tooling.
            </p>
          </header>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-900/60 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">{`function canonicalJson(v) {
  if (v === null)             return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number')  return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  if (typeof v === 'string')  return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalJson).join(',') + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonicalJson(v[k]))
      .join(',') + '}';
  }
  return 'null';
}`}</pre>
          <p className="mt-3 text-[11px] text-zinc-500">
            Hash: <span className="font-mono text-zinc-300">SHA-256</span>
            {' · '}
            Encoding:{' '}
            <span className="font-mono text-zinc-300">UTF-8</span>
            {' · '}
            Output: lowercase hex.
          </p>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-white/[0.06] pt-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
            COMPLIANCE EVIDENCE LOCKER · CEL/1.0 · PART OF THE NEXPEC PLATFORM
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Questions about a pack you received?{' '}
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-violet-glow hover:text-white"
            >
              Contact NEXPEC
              <ExternalLink className="h-3 w-3" strokeWidth={2} />
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ─── small subcomponents ─────────────────────────────────────────── */

function ProtocolStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 font-mono text-sm font-semibold text-violet-glow ring-1 ring-inset ring-violet/30">
        {n}
      </span>
      <div>
        <p className="font-display text-base font-semibold text-white">
          {title}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{body}</p>
      </div>
    </li>
  );
}

function PropertyTile({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <span className="text-violet-glow">{icon}</span>
        {title}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{body}</p>
    </div>
  );
}
