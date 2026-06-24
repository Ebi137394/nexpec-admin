// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/sitemap.ts
//
//  Sprint 13.2 — emits sitemap.xml with:
//    • a small static list of marketing-safe routes
//    • one entry per active inspector (read via the public view, so
//      no profile-level auth needed)
//
//  Capped at 1000 inspector entries by fetchInspectorIdsForSitemap so
//  the sitemap stays well under the 50k-URL / 50 MB limit and keeps
//  the generation fast. If the directory ever grows past 1k inspectors
//  this should be split into a sitemap index — but that's a long way off.
// ════════════════════════════════════════════════════════════════════════════

import type { MetadataRoute } from 'next';
import { fetchInspectorIdsForSitemap } from '@/lib/data/inspectorsDirectory';
import {
  agencyPath,
  fetchAllAgencyHandles,
  fetchAllDemand,
  fetchAllSupplyHandles,
  inspectionSlug,
  talentPath,
} from '@/lib/data/teaser';

// fetchInspectorIdsForSitemap reads via a Supabase server client that touches
// cookies, so this route is inherently dynamic and can't be statically exported
// at build time (that threw "Dynamic server usage" during prerender).
export const dynamic = 'force-dynamic';

const STATIC_ROUTES: Array<{ path: string; priority: number }> = [
  { path: '/', priority: 1.0 },
  { path: '/discover', priority: 0.9 },
  { path: '/inspectors', priority: 0.9 },
  { path: '/contact', priority: 0.5 },
  { path: '/legal/terms', priority: 0.3 },
  { path: '/legal/privacy', priority: 0.3 },
  { path: '/legal/compliance-notices', priority: 0.3 },
];

function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  return env || 'https://nexpecapp.com';
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: r.priority,
  }));

  let inspectorEntries: MetadataRoute.Sitemap = [];
  try {
    const inspectors = await fetchInspectorIdsForSitemap();
    inspectorEntries = inspectors.map((i) => ({
      url: `${base}/p/${i.id}`,
      lastModified: i.lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    }));
  } catch (err) {
    console.error('[sitemap] inspector fetch threw', err);
  }

  // Teaser Marketplace canonical pages: talent + agencies + inspections.
  let talentEntries: MetadataRoute.Sitemap = [];
  let agencyEntries: MetadataRoute.Sitemap = [];
  let inspectionEntries: MetadataRoute.Sitemap = [];
  try {
    const [handles, agencies, demand] = await Promise.all([
      fetchAllSupplyHandles(),
      fetchAllAgencyHandles(),
      fetchAllDemand(),
    ]);
    talentEntries = handles.map((h) => ({
      url: `${base}${talentPath(h)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
    agencyEntries = agencies.map((h) => ({
      url: `${base}${agencyPath(h)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
    inspectionEntries = demand.map((j) => ({
      url: `${base}/inspections/${inspectionSlug(j)}`,
      lastModified: j.posted_at ? new Date(j.posted_at) : new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    }));
  } catch (err) {
    console.error('[sitemap] teaser fetch threw', err);
  }

  return [
    ...staticEntries,
    ...inspectorEntries,
    ...talentEntries,
    ...agencyEntries,
    ...inspectionEntries,
  ];
}
