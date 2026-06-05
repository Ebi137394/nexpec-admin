// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/bridge/[token]/page.tsx
//
//  COORDINATION BRIDGE — vendor magic-link portal (PUBLIC, no NEXPEC auth).
//
//  The vendor lands here from the invitation email. Their NEXPEC identity
//  is the URL token. Server-side: we don't validate the token here — the
//  client component does that via the vendor-bridge-auth Edge Function,
//  so the page itself stays static-renderable and the validation logic
//  has exactly one home.
//
//  Mobile-friendly. Dark/purple. Single-column. Stripped of NEXPEC chrome
//  because vendors are partners, not users.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { VendorBridgeClient } from '@/components/coordination/VendorBridgeClient';

export const metadata: Metadata = {
  title: 'Coordination Bridge, NEXPEC',
  description:
    'Coordinate your upcoming inspection with the assigned inspector, confirm dates, upload preliminary documents, declare site access.',
  robots: { index: false, follow: false },
};

interface Props {
  params: { token: string };
}

export default function VendorBridgePage({ params }: Props) {
  const token = typeof params?.token === 'string' ? params.token.trim() : '';

  return (
    <div className="relative isolate min-h-screen bg-[#020420] text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-violet-500/10 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-40 left-0 -z-10 h-[360px] w-[520px] rounded-full bg-violet-500/[0.05] blur-[120px]"
      />

      <header className="border-b border-white/[0.06] bg-[#020420]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-violet-300">
            <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />
            NEXPEC, COORDINATION BRIDGE
          </span>
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            PRIVATE LINK
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {token ? (
          <VendorBridgeClient token={token} />
        ) : (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300">
              MISSING TOKEN
            </p>
            <p className="mt-3 text-sm text-zinc-300">
              Open the link from your invitation email. The URL must include your
              private token after <code className="font-mono text-violet-300">/bridge/</code>.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-white/[0.06] py-6">
        <p className="mx-auto max-w-3xl px-5 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          COORDINATION BRIDGE, PART OF THE NEXPEC PLATFORM
        </p>
      </footer>
    </div>
  );
}
