// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/robots.ts
//
//  Sprint 13.2 — robots.txt policy.
//
//  Public surfaces (/, /inspectors, /p/[userId], marketing pages) are
//  crawlable. All authenticated areas (/admin, /client, /inspector,
//  /api, /auth) are disallowed so internal pages don't get indexed
//  even if a link leaks. Sitemap pointer included.
// ════════════════════════════════════════════════════════════════════════════

import type { MetadataRoute } from 'next';

function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  return env || 'https://nexpecapp.com';
}

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/inspectors', '/p/'],
        disallow: [
          '/admin',
          '/admin/*',
          '/client',
          '/client/*',
          '/inspector',
          '/inspector/*',
          '/api/',
          '/auth/',
          '/sign-in',
          '/sign-up',
          '/orgs/accept/',
          '/notifications',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
