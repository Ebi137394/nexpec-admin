// ─────────────────────────────────────────────────────────────────
//  supabase/functions/_shared/http.ts
//  Shared fetch-with-timeout for Edge Functions.
//
//  QA-F1: a hung upstream (e.g. an OpenTimestamps calendar that stops
//  responding) must NEVER stall a whole batch until the Edge runtime wall-clock
//  kills the function. We abort the request after `ms` and let the caller's
//  per-item try/catch move on to the next item / next scheduled run.
// ─────────────────────────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 9000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
