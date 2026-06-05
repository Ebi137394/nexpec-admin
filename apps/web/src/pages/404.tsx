// ════════════════════════════════════════════════════════════════════════════
//  src/pages/404.tsx — Pages Router static 404 OVERRIDE
//
//  Companion to src/pages/_error.tsx. Next.js prefers pages/404.tsx over
//  the synthetic _error template when generating the static 404 artifact
//  during build. Providing both makes the override double-belt-and-braces:
//  whichever code path Next's static export takes, it finds a user-defined
//  page first and skips the broken synthetic that trips React #31 on
//  newer 15.5.x patches.
//
//  Pure primitives — no hooks, no client-only APIs, no external imports.
//  Mirrors the visual language of app/not-found.tsx so users see the same
//  brand-aligned 404 at runtime via App Router and at static-export build
//  time via Pages Router.
// ════════════════════════════════════════════════════════════════════════════

export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        background: '#020420',
        color: '#f4f4f5',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
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
        404, NEXPEC
      </p>
      <h1
        style={{
          marginTop: 12,
          fontSize: 40,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          color: '#ffffff',
          margin: '12px 0 0',
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          marginTop: 16,
          maxWidth: 480,
          fontSize: 16,
          lineHeight: 1.6,
          color: '#9CA3AF',
        }}
      >
        The page you were looking for doesn&apos;t exist. Either the link is
        older than the audit trail, or this page never shipped.
      </p>
      <a
        href="/"
        style={{
          marginTop: 32,
          background: '#7C3AED',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: 9999,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.02em',
          textDecoration: 'none',
          boxShadow: '0 0 32px -8px rgba(124, 58, 237, 0.45)',
          display: 'inline-block',
        }}
      >
        Return to the landing
      </a>
    </div>
  );
}
