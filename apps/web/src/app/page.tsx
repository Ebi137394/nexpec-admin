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
import { Nav, type NavViewer } from '@/components/marketing/Nav';
import { Hero } from '@/components/marketing/Hero';
import { LiveTicker } from '@/components/marketing/LiveTicker';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { TrustPillars } from '@/components/marketing/TrustPillars';
import { Industries } from '@/components/marketing/Industries';
import { CTASection } from '@/components/marketing/CTASection';
import { Footer } from '@/components/marketing/Footer';
import { fetchPublicStats } from '@/lib/data/publicStats';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

export const metadata: Metadata = {
  title: 'Industrial Inspection, Engineered for Trust',
  description:
    'Hire vetted industrial inspectors. Escrow holds every dollar. Every report is cryptographically signed and audit-grade.',
  openGraph: {
    title: 'NEXPEC — Industrial Inspection, Engineered for Trust',
    description:
      'Hire vetted industrial inspectors. Escrow holds every dollar. Every report is cryptographically signed and audit-grade.',
    url: SITE_URL,
    siteName: 'NEXPEC',
    type: 'website',
    images: [
      {
        url: '/og/landing.png',
        width: 1200,
        height: 630,
        alt: 'NEXPEC — the industrial black box. Automated inspection, vetted inspectors, audited trust.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NEXPEC — Industrial Inspection, Engineered for Trust',
    description: 'Hire vetted industrial inspectors. Escrow holds every dollar.',
    images: ['/og/landing.png'],
  },
};

export default async function LandingPage() {
  // Server-side fetch. Runs once per ISR window, not per request.
  const stats = await fetchPublicStats();

  // Session-aware Nav: detect whether the visitor is authenticated, and if
  // so resolve their role + display label so the Nav can swap the public
  // "Sign in / Get started" CTAs for a contextual "Console" affordance.
  // Without this, a signed-in user clicking "Sign in" gets silently
  // bounced by middleware (correct behavior, confusing UX).
  const viewer = await resolveViewer();

  return (
    <>
      <Nav viewer={viewer} />
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

async function resolveViewer(): Promise<NavViewer | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // Skip the profile lookup. The marketing route doesn't always see the
    // freshest auth cookie state, and a stale lookup gives a misleading
    // role. Middleware does the real access check on /admin/* anyway.
    // We just need a label for the avatar pill.
    const label = user.email?.split('@')[0] || 'You';
    return { label };
  } catch {
    // Marketing surface degrades gracefully — never block first paint on
    // an auth lookup failure.
    return null;
  }
}
