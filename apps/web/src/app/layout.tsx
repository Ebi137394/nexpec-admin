// ════════════════════════════════════════════════════════════════════════════
//  src/app/layout.tsx — root layout (minimal mode for deploy)
//
//  STRIPPED METADATA: Next.js's static export of /_error: /404 kept
//  failing React error #31 across five rounds of fixes. The renderer was
//  clean (verified by inline-only not-found.tsx still failing). The
//  cause was somewhere in the metadata processing — likely the
//  metadata.icons array, openGraph nested object, or metadataBase URL
//  instance — getting serialised as a React child by Next's internal
//  /_error template wrapping our root layout.
//
//  This version keeps ONLY the title + description metadata + the font
//  setup. Page-level metadata (page.tsx + contact/page.tsx) still
//  provides per-page openGraph + twitter cards. Icons and complex root
//  metadata can be re-added incrementally post-launch once the platform
//  is serving live traffic.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'NEXPEC — Industrial Inspection, Engineered for Trust',
  description:
    'Hire vetted industrial inspectors. Escrow protects every dollar. Every report is cryptographically signed and audit-grade.',
};

export const viewport: Viewport = {
  themeColor: '#020420',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
