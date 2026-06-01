import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

// This file lives at apps/web/, whose node_modules holds the React 19 copy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @nexpec/shared-core ships as TS source, consumed via a file: dependency
  // (apps/web is an ISOLATED install — see note below), so Next transpiles it.
  transpilePackages: ['@nexpec/shared-core'],

  // ── React #31 fix (2026-06) — dependency ISOLATION ─────────────────────────
  //  Two React majors live in this monorepo: the root pins react@18.3.1 (React
  //  Native 0.76), apps/web pins react@19. The fix: apps/web is EXCLUDED from
  //  the root `workspaces` and installed standalone (file: link to
  //  packages/shared-core), so its node_modules holds ONLY react@19 — every
  //  dependency resolves that single React 19. No webpack react-alias is used;
  //  it was a pre-isolation band-aid that forced a second React copy and fought
  //  Next's static-generation renderer (→ IntlProvider useMemo dispatcher-null
  //  on /verify).
  //
  //  The repo still has a root lockfile (for the mobile app), so Next would
  //  otherwise infer the monorepo root as its workspace root and reach back into
  //  the root's react@18 tree. Pin the tracing/resolution root to apps/web:
  outputFileTracingRoot: __dirname,

  // ── BOTH build gates fully ENABLED (2026-05-31). ────────────────────────
  //  Types: the 36 pre-existing errors are cleared (lucide → LucideIcon,
  //  dual-@types/react deduped via tsconfig paths, two supabase casts);
  //  `cd apps/web && npm run typecheck` is green, so ignoreBuildErrors is gone.
  //
  //  ESLint: a real flat config now exists (eslint.config.mjs) — pragmatic
  //  bug-only (crash-class rules error, stylistic noise off/warn). With no
  //  ignoreDuringBuilds override, `next build` runs ESLint and fails on errors.
  //  The same gate runs standalone via `cd apps/web && npm run lint` (CI).
  //  Linting only the app source keeps the gate fast and scoped.
  eslint: { dirs: ['src'] },

  // Phase 6 / Step 1 — production-grade defaults.
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    // Supabase storage host pattern — extend with the real project ref via env.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  // Removed `experimental.optimizePackageImports`. With Next 15.5.18 + React 19
  // this flag was a working suspect in the persistent React #31 we kept
  // hitting during static export of /_error: /404. The flag is an
  // optimization — not a correctness lever — and the cost of leaving it off
  // is a few extra kilobytes shipped to the client. Re-enable post-launch
  // once the build is provably stable.
  experimental: {
    serverActions: {
      // Inspector submit-report uploads up to 6 photos × 5MB each through a
      // server action multipart payload. Default 1MB cap would 413 us.
      // 35MB leaves headroom for form fields + multipart boundary overhead.
      bodySizeLimit: '35mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // microphone=(self) → required so the VoiceRecorder component can call
          // navigator.mediaDevices.getUserMedia({audio:true}) on the same origin.
          // camera=(self) → required for future photo capture from inspector iOS Safari.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // CI/release only — source-map upload
  silent: true,
  disableLogger: true,
});
