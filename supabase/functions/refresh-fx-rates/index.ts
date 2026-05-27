// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/refresh-fx-rates/index.ts
//
//  Live daily FX-rate refresher.
//
//  WORKFLOW
//  ────────
//    1. pg_cron (06:05 UTC daily) calls cron_kickoff_fx_refresh, which:
//         • inserts a row into public.fx_refresh_runs (status pending)
//         • dispatches POST /functions/v1/refresh-fx-rates via pg_net
//
//    2. THIS function then:
//         • validates the cron secret (rejects unauthenticated calls)
//         • fetches latest rates from OpenExchangeRates
//             — endpoint: https://openexchangerates.org/api/latest.json
//             — base = USD (OXR free tier locks base to USD)
//         • derives all (base, quote) pairs across our 9 supported
//           currencies and upserts them via public.cron_upsert_fx_rate
//         • writes the final result back via public.record_fx_refresh_result
//
//  WHY USD PIVOT
//  ─────────────
//  The OpenExchangeRates free tier only returns rates with base=USD,
//  e.g. {USD→EUR: 0.92, USD→GBP: 0.79, USD→JPY: 150.4, ...}. We can
//  trivially derive any (X, Y) pair via X→USD→Y:
//      rate(X, Y) = rate(USD, Y) / rate(USD, X)
//  The convert_cents() function in the database already walks USD as
//  a pivot, but storing the full N×N grid lets dashboards skip the
//  two-hop computation at read time.
//
//  ENVIRONMENT VARIABLES (required)
//  ────────────────────────────────
//    SUPABASE_URL                  — auto-set by Supabase
//    SUPABASE_SERVICE_ROLE_KEY     — auto-set by Supabase
//    OPENEXCHANGERATES_APP_ID      — your OXR API key
//    CRON_SECRET                   — shared secret with the database setting
//                                    `app.settings.cron_secret`
//
//  MANUAL INVOCATION
//  ─────────────────
//  You can also POST to this function manually from the Platform Owner
//  console without a run_id — it will create its own run record:
//    curl -X POST \
//      -H "Authorization: Bearer $CRON_SECRET" \
//      -H "Content-Type: application/json" \
//      "$SUPABASE_URL/functions/v1/refresh-fx-rates" -d '{}'
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'SGD', 'CHF', 'JPY',
] as const;
type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface OxrLatestResponse {
  disclaimer?: string;
  license?: string;
  timestamp: number;
  base: string;
  rates: Record<string, number>;
}

interface RefreshRequestBody {
  run_id?: string;
  triggered_by?: string;
  triggered_at?: string;
}

interface RefreshResponseBody {
  success: boolean;
  run_id?: string | null;
  rates_upserted: number;
  source: string;
  effective_date?: string;
  error?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      success: false,
      rates_upserted: 0,
      source: 'openexchangerates',
      error: 'method_not_allowed',
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const oxrAppId = Deno.env.get('OPENEXCHANGERATES_APP_ID');
  const cronSecret = Deno.env.get('CRON_SECRET');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      success: false,
      rates_upserted: 0,
      source: 'openexchangerates',
      error: 'missing_supabase_env',
    });
  }
  if (!oxrAppId) {
    return jsonResponse(500, {
      success: false,
      rates_upserted: 0,
      source: 'openexchangerates',
      error: 'missing_openexchangerates_app_id',
    });
  }

  // Authenticate the caller — must be either the service-role key OR
  // the shared cron secret.
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const callerIsAuthorised =
    bearer === serviceRoleKey ||
    (cronSecret && bearer === cronSecret);

  if (!callerIsAuthorised) {
    return jsonResponse(401, {
      success: false,
      rates_upserted: 0,
      source: 'openexchangerates',
      error: 'unauthorised',
    });
  }

  // Parse body (run_id is optional — cron sends it, manual calls don't).
  let body: RefreshRequestBody = {};
  try {
    if (req.headers.get('content-length') !== '0') {
      body = await req.json();
    }
  } catch {
    body = {};
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // If cron didn't pre-create a run row, create one now so we always
  // have a single row to update at the end.
  let runId = body.run_id ?? null;
  if (!runId) {
    const { data: runRow, error: runErr } = await supabase
      .from('fx_refresh_runs')
      .insert({
        source: 'openexchangerates',
      })
      .select('id')
      .single();
    if (runErr || !runRow) {
      // Don't abort — we can still upsert rates without bookkeeping.
      console.error('refresh-fx-rates: failed to create fx_refresh_runs row', runErr);
    } else {
      runId = runRow.id as string;
    }
  }

  try {
    // ────────── 1) Fetch live rates from OpenExchangeRates ──────────
    const oxrUrl =
      'https://openexchangerates.org/api/latest.json' +
      `?app_id=${encodeURIComponent(oxrAppId)}` +
      '&base=USD&prettyprint=false&show_alternative=false';

    const oxrRes = await fetch(oxrUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!oxrRes.ok) {
      const text = await safeText(oxrRes);
      const message = `openexchangerates ${oxrRes.status}: ${text.slice(0, 400)}`;
      await recordResult(supabase, runId, false, 0, message, oxrRes.status);
      return jsonResponse(502, {
        success: false,
        run_id: runId,
        rates_upserted: 0,
        source: 'openexchangerates',
        error: message,
      });
    }

    const oxrJson = (await oxrRes.json()) as OxrLatestResponse;
    if (!oxrJson || typeof oxrJson.rates !== 'object' || oxrJson.base !== 'USD') {
      const message = 'malformed OXR response';
      await recordResult(supabase, runId, false, 0, message, 502);
      return jsonResponse(502, {
        success: false,
        run_id: runId,
        rates_upserted: 0,
        source: 'openexchangerates',
        error: message,
      });
    }

    // ────────── 2) Build the supported-currency rate table ──────────
    // usdRates[X] = "1 USD in X"
    const usdRates: Record<SupportedCurrency, number> = {} as Record<
      SupportedCurrency,
      number
    >;
    for (const c of SUPPORTED_CURRENCIES) {
      if (c === 'USD') {
        usdRates[c] = 1;
        continue;
      }
      const r = oxrJson.rates[c];
      if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
        usdRates[c] = r;
      }
    }

    // Effective date = the OXR snapshot date in UTC.
    const effectiveDate = new Date(oxrJson.timestamp * 1000)
      .toISOString()
      .slice(0, 10);

    // ────────── 3) Upsert every directed pair (X, Y) ──────────
    // rate(X, Y) = usdRates[Y] / usdRates[X]
    let upserted = 0;
    const failures: Array<{ pair: string; error: string }> = [];

    for (const base of SUPPORTED_CURRENCIES) {
      const baseInUsd = usdRates[base];
      if (!baseInUsd) continue;

      for (const quote of SUPPORTED_CURRENCIES) {
        const quoteInUsd = usdRates[quote];
        if (!quoteInUsd) continue;

        const rate = base === quote ? 1 : quoteInUsd / baseInUsd;
        if (!Number.isFinite(rate) || rate <= 0) continue;

        const { error: rpcErr } = await supabase.rpc('cron_upsert_fx_rate', {
          p_base_currency: base,
          p_quote_currency: quote,
          p_rate: Number(rate.toFixed(10)),
          p_effective_date: effectiveDate,
          p_source: 'openexchangerates',
        });

        if (rpcErr) {
          failures.push({ pair: `${base}->${quote}`, error: rpcErr.message });
        } else {
          upserted += 1;
        }
      }
    }

    // ────────── 4) Record outcome ──────────
    if (failures.length > 0 && upserted === 0) {
      const message = `all upserts failed: ${failures.slice(0, 3).map(f => `${f.pair}:${f.error}`).join('; ')}`;
      await recordResult(supabase, runId, false, 0, message, 500);
      return jsonResponse(500, {
        success: false,
        run_id: runId,
        rates_upserted: 0,
        source: 'openexchangerates',
        effective_date: effectiveDate,
        error: message,
      });
    }

    await recordResult(
      supabase,
      runId,
      true,
      upserted,
      failures.length === 0
        ? null
        : `${failures.length} pair(s) failed: ${failures
            .slice(0, 3)
            .map(f => `${f.pair}:${f.error}`)
            .join('; ')}`,
      200,
    );

    return jsonResponse(200, {
      success: true,
      run_id: runId,
      rates_upserted: upserted,
      source: 'openexchangerates',
      effective_date: effectiveDate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordResult(supabase, runId, false, 0, message, 500);
    return jsonResponse(500, {
      success: false,
      run_id: runId,
      rates_upserted: 0,
      source: 'openexchangerates',
      error: message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: RefreshResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

async function recordResult(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  runId: string | null,
  succeeded: boolean,
  ratesUpserted: number,
  errorMessage: string | null,
  httpStatus: number,
): Promise<void> {
  if (!runId) return;
  const { error } = await supabase.rpc('record_fx_refresh_result', {
    p_run_id: runId,
    p_succeeded: succeeded,
    p_rates_upserted: ratesUpserted,
    p_error_message: errorMessage,
    p_http_status: httpStatus,
  });
  if (error) {
    console.error('refresh-fx-rates: record_fx_refresh_result failed', error);
  }
}
