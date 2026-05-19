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
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { isRTL } from '@/i18n/config';
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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

export const metadata: Metadata = {
  // metadataBase resolves all relative /og/* paths against the production
  // origin so social scrapers (Twitter, LinkedIn, Slack, iMessage) see
  // absolute URLs without us repeating them on every page.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'NEXPEC — Industrial Inspection, Engineered for Trust',
    template: '%s · NEXPEC',
  },
  description:
    'Hire vetted industrial inspectors. Escrow protects every dollar. Every report is cryptographically signed and audit-grade.',
  // Default openGraph + twitter for any route that doesn't override.
  openGraph: {
    title: 'NEXPEC — Industrial Inspection, Engineered for Trust',
    description:
      'Hire vetted industrial inspectors. Escrow protects every dollar. Every report is cryptographically signed and audit-grade.',
    url: SITE_URL,
    siteName: 'NEXPEC',
    type: 'website',
    images: [
      {
        url: '/og/landing.png',
        width: 1200,
        height: 630,
        alt: 'NEXPEC — the industrial black box.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NEXPEC — Industrial Inspection, Engineered for Trust',
    description: 'Hire vetted industrial inspectors. Escrow protects every dollar.',
    images: ['/og/landing.png'],
  },
  icons: {
    icon: [
      { url: '/brand/logo-mark.png', type: 'image/png' },
      { url: '/brand/logo-mark.svg', type: 'image/svg+xml' },
    ],
    apple: '/brand/logo-mark.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#020420',
  colorScheme: 'dark',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // i18n: locale comes from the NEXT_LOCALE cookie via src/i18n/request.ts.
  // We set <html lang> + <html dir> dynamically so Arabic (and future RTL
  // languages) flip text direction at the document root.
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = isRTL(locale) ? 'rtl' : 'ltr';
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
