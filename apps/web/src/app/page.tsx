// ════════════════════════════════════════════════════════════════════════════
//  src/app/page.tsx — NEXPEC landing
//
//  Server Component shell (no client directive). Each interactive section is
//  itself a client component so the first paint stays static and the
//  interaction layer hydrates progressively.
//
//  ISR for the marketing surface: revalidate hourly. The public-stats
//  ticker will live in its own client-fetched island so the page stays
//  cacheable at the edge.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { Nav } from '@/components/marketing/Nav';
import { Hero } from '@/components/marketing/Hero';
import { LiveTicker } from '@/components/marketing/LiveTicker';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { TrustPillars } from '@/components/marketing/TrustPillars';
import { Industries } from '@/components/marketing/Industries';
import { CTASection } from '@/components/marketing/CTASection';
import { Footer } from '@/components/marketing/Footer';
import { fetchPublicStats } from '@/lib/data/publicStats';

// ── Render policy ─────────────────────────────────────────────────────
// Forced dynamic to bypass Next.js's static-export step entirely. The
// previous `revalidate = 3600` was triggering ISR static generation,
// which on Vercel's pipeline kept failing prerender of /404 with React
// error #31 (the file itself was clean — the static path was the issue).
// Server-rendering on each request is a ~50ms cost; revisit ISR after
// upgrading next or root-causing the prerender failure.
export const dynamic = 'force-dynamic';

/**
 * Page-level metadata — stripped to title + description while we resolve
 * the static-export React #31. OpenGraph + Twitter cards re-added
 * post-launch once the build pipeline is stable.
 */
export const metadata: Metadata = {
  title: 'Industrial Inspection, Engineered for Trust',
  description:
    'Hire vetted industrial inspectors. Escrow holds every dollar. Every report is cryptographically signed and audit-grade.',
};

export default async function LandingPage() {
  // Server-side fetch. Runs once per ISR window, not per request.
  const stats = await fetchPublicStats();

  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <LiveTicker stats={stats} />
        <HowItWorks />
        <TrustPillars />
        <Industries />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
