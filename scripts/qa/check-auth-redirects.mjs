#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 *  Fail the build if a Production auth redirect could resolve to a dev host.
 *
 *  Written after the 2026-09-05 P0: Supabase Production Site URL was still the
 *  stock http://127.0.0.1:3000 and no nexpecapp.com entry was on the redirect
 *  allowlist, so a real user completing Google sign-in was bounced to
 *  http://127.0.0.1:3000/?code=... . Nothing in the pipeline noticed.
 *
 *  Checks the LIVE Production config when SUPABASE_ACCESS_TOKEN is available;
 *  otherwise checks what it can and says loudly what it could not verify.
 * ════════════════════════════════════════════════════════════════════════════ */
const PROJECT = process.env.NEXPEC_PROD_PROJECT_REF ?? 'sxqpjxhslzzcdrdctatm';
const CANON   = 'www.nexpecapp.com';
const DEV = /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)|^exp:\/\//i;

const fail = [];
const warn = [];

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  warn.push('SUPABASE_ACCESS_TOKEN not set — LIVE Supabase auth config was NOT verified.');
} else {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/config/auth`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    fail.push(`Could not read Supabase auth config (HTTP ${res.status}).`);
  } else {
    const cfg = await res.json();
    const site = String(cfg.site_url ?? '');
    const allow = String(cfg.uri_allow_list ?? '');

    // The Site URL is the fallback for EVERY redirect that is not allowlisted,
    // so a dev host here is the single most dangerous value in auth config.
    if (DEV.test(site)) {
      fail.push(`Supabase Site URL is a development host: ${site}`);
    }
    if (!site.includes(CANON)) {
      fail.push(`Supabase Site URL is not the canonical domain: ${site}`);
    }
    // Without this entry Supabase silently discards the web redirectTo and
    // falls back to Site URL — the exact 2026-09-05 failure.
    if (!allow.includes(CANON)) {
      fail.push('Redirect allowlist has no www.nexpecapp.com entry.');
    }
    // Native deep links must survive: the published apps depend on them.
    for (const scheme of ['nexpec://oauth-callback', 'nexpec://reset-password']) {
      if (!allow.includes(scheme)) fail.push(`Allowlist lost native scheme ${scheme}.`);
    }
    // A wildcard on a host anyone can deploy to would leak the PKCE code.
    if (/\*\.vercel\.app/i.test(allow)) {
      fail.push('Allowlist contains a *.vercel.app wildcard (open redirect).');
    }
  }
}

// Application-side: production env must not resolve auth to a dev host.
if (process.env.VERCEL_ENV === 'production') {
  const siteEnv = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  if (!siteEnv) fail.push('NEXT_PUBLIC_SITE_URL is unset in production (code falls back to localhost).');
  else if (DEV.test(siteEnv)) fail.push(`NEXT_PUBLIC_SITE_URL is a development host: ${siteEnv}`);
}

for (const w of warn) console.warn(`  WARN  ${w}`);
if (fail.length) {
  console.error('\n  AUTH REDIRECT CHECK FAILED\n');
  for (const f of fail) console.error(`  ✗ ${f}`);
  console.error('\n  Production users would be sent to a development host.\n');
  process.exit(1);
}
console.log('  auth redirects OK — no production path resolves to a development host');
