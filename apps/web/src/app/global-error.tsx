// ════════════════════════════════════════════════════════════════════════════
//  app/global-error.tsx — root-layout error escape hatch
//
//  When an error escapes the root layout itself (e.g. a font-load failure
//  in layout.tsx), Next.js can't render the in-tree error.tsx because the
//  layout is the thing that failed. global-error.tsx MUST therefore
//  define its own <html> and <body> — the root layout's chrome cannot be
//  assumed to exist.
//
//  Kept intentionally minimal: inline styles for the dark canvas + a
//  single inline SVG mark. No Tailwind utilities (the stylesheet may not
//  have loaded). No imports beyond React.
// ════════════════════════════════════════════════════════════════════════════

'use client';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#020420',
          color: '#f4f4f5',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
          textAlign: 'center',
        }}
      >
        {/* Inline gradient mark — no external assets, no CSS file. */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #7C3AED 0%, #00CFD5 100%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: '-0.02em',
            boxShadow: '0 0 32px -6px rgba(124, 58, 237, 0.45)',
          }}
          aria-hidden
        >
          N
        </div>

        <p
          style={{
            marginTop: 32,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            color: '#A78BFA',
          }}
        >
          500 · Platform error
        </p>

        <h1
          style={{
            marginTop: 12,
            fontSize: 48,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            color: '#ffffff',
          }}
        >
          NEXPEC hit an unexpected error.
        </h1>

        <p
          style={{
            marginTop: 16,
            maxWidth: 540,
            fontSize: 16,
            lineHeight: 1.6,
            color: '#9CA3AF',
          }}
        >
          Something failed before the page could render. The platform is
          self-healing — most transient failures clear on the next
          attempt.
        </p>

        {error.digest && (
          <p
            style={{
              marginTop: 24,
              fontFamily:
                'ui-monospace, SFMono-Regular, "Menlo", monospace',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#71717a',
            }}
          >
            digest ·{' '}
            <span style={{ color: '#d4d4d8' }}>{error.digest}</span>
          </p>
        )}

        <div
          style={{
            marginTop: 32,
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
              padding: '12px 24px',
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
              padding: '12px 24px',
              borderRadius: 9999,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.02em',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Return to the landing
          </a>
        </div>

        <p
          style={{
            marginTop: 48,
            fontSize: 12,
            color: '#71717a',
          }}
        >
          © {new Date().getFullYear()} NEXPEC · Audited by default.
        </p>
      </body>
    </html>
  );
}
