// ════════════════════════════════════════════════════════════════════════════
//  app/discover/page.tsx — public Teaser Marketplace (ISR, SEO surface)
//
//  The canonical, crawlable home of the live feed. Unlike the landing (forced
//  dynamic for its auth-aware Nav), this page is fully public and reads only the
//  cookieless anon feeds, so it is genuinely ISR-cacheable.
//
//  ~60s revalidate: fresh-feeling for a marketing surface, near-zero DB load.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { Nav } from '@/components/marketing/Nav';
import { Footer } from '@/components/marketing/Footer';
import { TeaserMarketplaceSection } from '@/components/teaser/TeaserMarketplaceSection';

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

export const metadata: Metadata = {
  title: 'Live Inspection Marketplace, Open Jobs & Vetted Inspectors',
  description:
    'Browse live industrial inspection demand and NEXPEC-verified specialists across NDT, civil, electrical, mechanical, and process. Identities protected; every engagement brokered, with funds on payment hold.',
  alternates: {
    canonical: '/discover',
    types: { 'application/rss+xml': '/feed.xml' },
  },
  openGraph: {
    title: 'NEXPEC, Live Inspection Marketplace',
    description:
      'Open inspection jobs and vetted specialists, brokered through NEXPEC with funds on payment hold.',
    url: `${SITE_URL}/discover`,
    siteName: 'NEXPEC',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NEXPEC, Live Inspection Marketplace',
    description: 'Open inspection jobs and vetted specialists, brokered through NEXPEC.',
  },
  robots: { index: true, follow: true },
};

export default function DiscoverPage() {
  return (
    <>
      <Nav viewer={null} />
      <main id="top">
        <TeaserMarketplaceSection variant="full" />
      </main>
      <Footer />
    </>
  );
}
