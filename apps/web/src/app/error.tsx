// ════════════════════════════════════════════════════════════════════════════
//  app/error.tsx — in-tree error boundary (minimal-inline render)
//
//  Same simplification as not-found.tsx: no <Logo>, no <Link>, no lucide,
//  no Tailwind. Plain HTML + inline styles only — provably static-export
//  safe. Must be a Client Component per Next.js error-boundary contract.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[app/error] caught:', error);
    }
  }, [error]);

  const year = new Date().getFullYear();

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at top, rgba(239, 68, 68, 0.12) 0%, rgba(2, 4, 32, 0) 55%), #020420',
        color: '#f4f4f5',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 24px 0',
          maxWidth: 1152,
          width: '100%',
          margin: '0 auto',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #7C3AED 0%, #00CFD5 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 16,
              boxShadow: '0 0 24px -6px rgba(124, 58, 237, 0.45)',
            }}
          >
            N
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '-0.025em',
              color: '#ffffff',
            }}
          >
            NEXPEC
          </span>
        </span>
        <a
          href="/"
          style={{ fontSize: 14, color: '#a1a1aa', textDecoration: 'none' }}
        >
          ← Back home
        </a>
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <p
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: '#fca5a5',
              margin: 0,
            }}
          >
            500 · Unexpected error
          </p>
          <h1
            style={{
              marginTop: 12,
              fontSize: 56,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              color: '#ffffff',
            }}
          >
            Something broke.
          </h1>
          <p
            style={{
              marginTop: 16,
              fontSize: 16,
              lineHeight: 1.6,
              color: '#9CA3AF',
            }}
          >
            The platform hit an unexpected condition. Try again — most
            transient failures clear on the second attempt.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: 24,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#71717a',
              }}
            >
              digest ·{' '}
              <span style={{ color: '#d4d4d8' }}>{error.digest}</span>
            </p>
          ) : null}
          <div
            style={{
              marginTop: 40,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#7C3AED',
                color: '#ffffff',
                border: 'none',
                padding: '14px 24px',
                borderRadius: 9999,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                boxShadow: '0 0 32px -8px rgba(124, 58, 237, 0.45)',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                color: '#e4e4e7',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '13px 23px',
                borderRadius: 9999,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '0.02em',
                textDecoration: 'none',
              }}
            >
              Return to the landing
            </a>
          </div>
        </div>
      </main>

      <footer
        style={{
          padding: '24px',
          textAlign: 'center',
          fontSize: 12,
          color: '#71717a',
        }}
      >
        © {year} NEXPEC · Audited by default.
      </footer>
    </div>
  );
}
