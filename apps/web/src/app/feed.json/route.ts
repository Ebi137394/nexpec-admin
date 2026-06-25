// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/feed.json/route.ts — public syndication feed (JSON Feed 1.1)
//
//  The JSON sibling of /feed.xml. Same single OUTBOUND CONTRACT (Ports &
//  Adapters): a sanitized, public feed of open inspection demand (jobs + RFQs),
//  each item linking to its canonical /inspections/<slug> page. RSS suits
//  RSS-trigger tools (Make/Zapier "RSS"); JSON Feed suits HTTP/webhook modules
//  (n8n, custom adapters) that parse JSON more reliably. NEXPEC carries ZERO
//  channel SDKs/tokens — the automation layer owns posting.
//
//  Safe by construction: reads public_demand_feed (no identity, no price, coarse
//  timeframe only). Edge-cached.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import {
  demandTitle,
  domainLabel,
  fetchDemandTeasers,
  humanizeSlug,
  inspectionSlug,
} from '@/lib/data/teaser';

export const revalidate = 300;

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://nexpecapp.com';
}

export async function GET() {
  const origin = siteOrigin();
  const items = await fetchDemandTeasers(50);

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'NEXPEC, Open Inspections & RFQs',
    home_page_url: `${origin}/discover`,
    feed_url: `${origin}/feed.json`,
    description:
      'Live industrial inspection demand on NEXPEC — vetted inspectors apply through the platform. Brokered, escrowed, audit-grade.',
    language: 'en',
    items: items.map((j) => {
      const url = `${origin}/inspections/${inspectionSlug(j)}`;
      const where = [j.location_city, j.country].filter(Boolean).join(', ');
      const specs = (j.specialty_slugs ?? []).filter(Boolean).slice(0, 4).map(humanizeSlug);
      return {
        id: url,
        url,
        title: `${demandTitle(j)}${where ? ` — ${where}` : ''}`,
        content_text:
          `Open ${demandTitle(j).toLowerCase()}` +
          (where ? ` in ${where}` : '') +
          (j.timeframe ? `, ${j.timeframe}` : '') +
          '. Vetted inspectors engage through NEXPEC — brokered, escrowed, audit-grade.' +
          (specs.length ? ` Scope: ${specs.join(', ')}.` : ''),
        ...(j.posted_at ? { date_published: new Date(j.posted_at).toISOString() } : {}),
        tags: [domainLabel(j.domain), ...specs],
      };
    }),
  };

  return new NextResponse(JSON.stringify(feed), {
    status: 200,
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
