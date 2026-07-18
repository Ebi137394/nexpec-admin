// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/feed.xml/route.ts — public syndication feed (RSS 2.0)
//
//  The single OUTBOUND CONTRACT for social syndication (Ports & Adapters): we
//  emit a sanitized, public RSS feed of open inspection demand (jobs + RFQs),
//  each item linking to its canonical /inspections/<slug> page. An automation
//  layer (Make / Zapier / n8n) polls this and posts to the channels it supports
//  — NEXPEC carries ZERO Meta/LinkedIn SDKs or tokens. (Note: Facebook Groups
//  posting was removed from all APIs in 2024; Pages / LinkedIn are tool-driven.)
//
//  Safe by construction: the feed reads public_demand_feed, which already emits
//  no identity, no price, and only a coarse timeframe. Cached at the edge.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import {
  demandTitle,
  domainLabel,
  fetchDemandTeasers,
  humanizeSlug,
  inspectionSlug,
} from '@/lib/data/teaser';

export const revalidate = 300; // 5-minute edge cache; pollers stay cheap

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://nexpecapp.com';
}

function xml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const origin = siteOrigin();
  const items = await fetchDemandTeasers(50); // most recent, sanitized
  const now = new Date().toUTCString();

  const channelTitle = 'NEXPEC, Open Inspections & RFQs';
  const channelDesc =
    'Live industrial inspection demand on NEXPEC — vetted inspectors apply through the platform. Brokered, payment-protected, audit-grade.';

  const body = items
    .map((j) => {
      const url = `${origin}/inspections/${inspectionSlug(j)}`;
      const where = [j.location_city, j.country].filter(Boolean).join(', ');
      const specs = (j.specialty_slugs ?? []).filter(Boolean).slice(0, 4).map(humanizeSlug);
      const desc =
        `Open ${demandTitle(j).toLowerCase()}` +
        (where ? ` in ${where}` : '') +
        (j.timeframe ? `, ${j.timeframe}` : '') +
        `. Vetted inspectors engage through NEXPEC — brokered, payment-protected, audit-grade.` +
        (specs.length ? ` Scope: ${specs.join(', ')}.` : '');
      const pub = j.posted_at ? new Date(j.posted_at).toUTCString() : now;
      return [
        '    <item>',
        `      <title>${xml(`${demandTitle(j)}${where ? ` — ${where}` : ''}`)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <category>${xml(domainLabel(j.domain))}</category>`,
        `      <pubDate>${pub}</pubDate>`,
        `      <description>${xml(desc)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(channelTitle)}</title>
    <link>${origin}/discover</link>
    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${xml(channelDesc)}</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
${body}
  </channel>
</rss>`;

  return new NextResponse(rss, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
