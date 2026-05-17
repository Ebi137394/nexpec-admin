// ════════════════════════════════════════════════════════════════════════════
//  src/pages/_error.tsx — Pages Router error template OVERRIDE
//
//  Why this file exists in an App Router project:
//  Next.js 15.5.x emits a synthetic Pages Router `_error` template during
//  static export to produce the static /404 fallback artifact, even when
//  the codebase is App Router-only. That synthetic template has an
//  incompatibility with React 19's client-reference shape — it tries to
//  render an object with keys {$$typeof, type, key, ref, props} as a
//  React child, which trips minified React error #31 and kills the build:
//      "Export encountered an error on /_error: /404, exiting the build."
//
//  Providing our own `_error.tsx` in the legacy `pages/` directory tells
//  Next to use THIS file instead of the synthetic one. The file is a
//  minimal Pages Router component — no hooks, no client-only APIs, no
//  external imports. Plain primitives only, guaranteed static-export safe.
//
//  This does NOT replace App Router's `app/not-found.tsx` or
//  `app/error.tsx` at runtime — those still handle live 404s and 500s.
//  This file's sole purpose is to satisfy the synthetic build step.
//  Once Next ships a fix for the React 19 incompatibility, this file
//  can be deleted.
// ════════════════════════════════════════════════════════════════════════════

interface ErrorPageProps {
  statusCode?: number;
}

function ErrorPage({ statusCode }: ErrorPageProps) {
  const code = statusCode ?? 404;
  const heading = code === 404 ? 'Page not found' : 'Unexpected error';
  const sub =
    code === 404
      ? 'The page you were looking for does not exist.'
      : 'Something failed before this page could render. Please try again.';

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
        {code} · NEXPEC
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
        {heading}
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
        {sub}
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

// getInitialProps must be defined for a Pages Router _error page to receive
// the status code on the server side. Kept as a plain function — no hooks,
// no React imports, no async work beyond reading the response object.
ErrorPage.getInitialProps = (ctx: {
  res?: { statusCode?: number };
  err?: { statusCode?: number };
}) => {
  const statusCode = ctx.res?.statusCode ?? ctx.err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;
