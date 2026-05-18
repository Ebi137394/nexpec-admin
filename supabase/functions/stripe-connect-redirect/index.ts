// ─────────────────────────────────────────────────────────────────
//  supabase/functions/stripe-connect-redirect/index.ts
//
//  HTTPS → custom-scheme bridge for Stripe Connect onboarding.
//
//  Stripe's accountLinks.create() rejects non-HTTP(S) URLs as
//  return_url / refresh_url, so we can't pass `nexpec://...` directly.
//  Instead we point Stripe at this Edge Function (HTTPS) and have
//  it serve a tiny HTML page that JS-redirects to the deep link.
//
//  expo-web-browser's openAuthSessionAsync() detects the eventual
//  `nexpec://finance/connect-return` redirect and closes the
//  browser, returning control to the app.
//
//  Deploy with:
//    supabase functions deploy stripe-connect-redirect --no-verify-jwt
//
//  Why no-verify-jwt: Stripe redirects the user's browser to this
//  endpoint without any auth header. The page itself reveals no
//  secrets — it just does a deep-link redirect.
// ─────────────────────────────────────────────────────────────────

const APP_SCHEME = 'nexpec';

// Whitelist the paths we'll redirect to. Prevents this EF from
// becoming an open redirect that could be abused.
const ALLOWED_PATHS: Record<string, string> = {
  'connect-return': '/finance/connect-return',
  'connect-refresh': '/finance/connect-refresh',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const requested = url.searchParams.get('to') ?? 'connect-return';
  const path = ALLOWED_PATHS[requested] ?? ALLOWED_PATHS['connect-return'];

  const deepLink = `${APP_SCHEME}://${path.replace(/^\//, '')}`;

  // ★ HTTP 302 redirect directly to the deep link. The browser sees
  //   Location: nexpec://... and follows it; iOS/Android intercept
  //   the custom scheme and hand off to the registered app.
  //
  //   Why not HTML + JS redirect? The Supabase Edge Function gateway
  //   sometimes overrides Content-Type and the browser renders the
  //   HTML as source instead of executing it — the JS redirect never
  //   fires and the WebBrowser auth session never closes. The 302
  //   approach sidesteps that entire layer.
  //
  //   This is the same pattern used by OAuth redirects in nearly
  //   every native app handoff scenario.
  return new Response(null, {
    status: 302,
    headers: {
      'Location': deepLink,
      'Cache-Control': 'no-store',
    },
  });
});
