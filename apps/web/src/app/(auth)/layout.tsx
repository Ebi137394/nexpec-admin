// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/layout.tsx
//
//  Wrapping layout for /sign-in and /sign-up. Centered card on the same
//  dark canvas as the landing page, with the violet bloom + topographic
//  grid carrying the brand through the auth flow.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      {/* atmospheric layers — match the landing hero */}
      <div aria-hidden className="pointer-events-none absolute inset-0 topo-grid opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-violet/20 blur-[110px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 -z-10 h-[300px] w-[500px] rounded-full bg-cyan-glow/10 blur-[100px]"
      />

      {/* top bar */}
      <header className="relative z-10 px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
          <Logo variant="wordmark" size="md" />
          <Link
            href="/"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            ← Back home
          </Link>
        </div>
      </header>

      {/* card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-12 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>

      {/* footer microcopy */}
      <footer className="relative z-10 px-6 pb-8 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} NEXPEC · Audited by default.
      </footer>
    </div>
  );
}
