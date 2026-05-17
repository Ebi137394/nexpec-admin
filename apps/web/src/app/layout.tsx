// ════════════════════════════════════════════════════════════════════════════
//  src/app/layout.tsx — root layout (minimal mode for deploy)
//
//  STRIPPED METADATA + first-party font loader. Next.js's static export of
//  /_error: /404 kept failing React error #31 across six rounds of fixes.
//  The renderer was provably clean (verified by stripping not-found.tsx,
//  error.tsx, and global-error.tsx to inline-only and still failing). The
//  last module-level executor in this file was `geist/font/*` — older
//  versions of that package ship a font-object shape that the Next 15
//  static-export pipeline mishandles inside the synthetic /_error template.
//
//  Switched to next/font/google (first-party, contract-stable with 15.x).
//  Inter ≈ Geist Sans, JetBrains Mono ≈ Geist Mono. CSS variable names
//  preserved (--font-geist-sans, --font-geist-mono) so the rest of the
//  stylesheet keeps working unchanged.
//
//  Page-level metadata (page.tsx + contact/page.tsx) still provides
//  per-page openGraph + twitter cards. Icons and complex root metadata
//  can be re-added incrementally post-launch once the platform is serving
//  live traffic.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

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
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
