/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@nexpec/shared-core'],
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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
