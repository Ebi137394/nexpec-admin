// ════════════════════════════════════════════════════════════════════════════
//  app/account/layout.tsx — shared chrome for public account-utility pages
//
//  Mirrors app/legal/layout.tsx: dark canvas + topo grid, slim Logo header,
//  readable prose width, marketing footer. Currently wraps /account/delete
//  (the public account-deletion page required by Google Play's data-deletion
//  policy and Apple 5.1.1(v) parity on the web).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/marketing/Footer';

export const dynamic = 'force-dynamic';

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 topo-grid opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-violet/20 blur-[110px]"
      />

      <header className="relative z-10 px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between">
          <Logo variant="wordmark" size="md" />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <Footer />
    </div>
  );
}
