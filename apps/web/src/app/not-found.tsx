// ════════════════════════════════════════════════════════════════════════════
//  app/not-found.tsx — 404 page (minimal-inline render, dynamic)
//
//  `dynamic = 'force-dynamic'` is the surgical fix for the
//  React error #31 we kept hitting in Vercel's static export step.
//  With the minimal inline-only renderer, the FILE is provably clean —
//  the prerender path itself was producing the failure. Forcing dynamic
//  means Next.js renders /404 on demand (server-side) instead of
//  statically prerendering it during the build.
//
//  Trade-off: every 404 pays a ~50ms server render. For a 404 page
//  that's an acceptable cost in exchange for build-time certainty.
//
//  Two earlier versions used <Logo>, next/link, lucide icons, and Tailwind
//  utilities; both tripped React error #31 during Vercel's static export
//  of /404. The static-export step renders this component inside the root
//  layout and SOMETHING in that combined render tree produced an
//  unrecoverable child-validator failure.
//
//  This rewrite uses ONLY plain HTML + inline styles + a static gradient
//  div for the brand mark. No external imports. Mirrors the inline-only
//  pattern of global-error.tsx, which has never failed to prerender.
//  The aesthetic is preserved: dark canvas, gradient mark, hero typography.
// ════════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default function NotFound() {
  const year = new Date().getFullYear();

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at top, rgba(124, 58, 237, 0.18) 0%, rgba(2, 4, 32, 0) 55%), #020420',
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
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background:
                'linear-gradient(135deg, #7C3AED 0%, #00CFD5 100%)',
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
          style={{
            fontSize: 14,
            color: '#a1a1aa',
            textDecoration: 'none',
          }}
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
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: '#A78BFA',
              margin: 0,
            }}
          >
            404 · Not Found
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
            This page is off-spec.
          </h1>
          <p
            style={{
              marginTop: 16,
              fontSize: 16,
              lineHeight: 1.6,
              color: '#9CA3AF',
            }}
          >
            We can&apos;t find what you were looking for. Either it never
            existed, or the link is older than the audit trail.
          </p>
          <div
            style={{
              marginTop: 40,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              justifyContent: 'center',
            }}
          >
            <a
              href="/"
              style={{
                background: '#7C3AED',
                color: '#ffffff',
                padding: '14px 24px',
                borderRadius: 9999,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '0.02em',
                textDecoration: 'none',
                boxShadow: '0 0 32px -8px rgba(124, 58, 237, 0.45)',
              }}
            >
              Return to the landing
            </a>
            <a
              href="/contact"
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
              Tell us what broke
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
