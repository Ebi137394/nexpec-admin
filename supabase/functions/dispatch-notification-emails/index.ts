// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/dispatch-notification-emails/index.ts
//
//  Drains the public.notifications email queue. Picks up to 25 rows
//  per invocation, renders the matching template, posts to Resend,
//  and writes the outcome (sent / failed) back to the database.
//
//  CALLED BY
//  ─────────
//    • pg_cron every 5 minutes (via cron_kickoff_email_dispatch).
//      The cron function short-circuits if the queue is empty so we
//      don't burn invocations during quiet periods.
//    • Optional: web/mobile clients can POST to it for "drain now"
//      after a hot user action, with the service-role key. Not
//      required — the cron alone meets the SLA.
//
//  AUTHENTICATION
//  ──────────────
//    Authorization: Bearer <service-role-key>           — full access
//    Authorization: Bearer <CRON_SECRET>                — full access
//    Anything else → 401.
//
//  ENVIRONMENT VARIABLES (required)
//  ────────────────────────────────
//    SUPABASE_URL                  — auto-set
//    SUPABASE_SERVICE_ROLE_KEY     — auto-set
//    RESEND_API_KEY                — Resend API key
//    CRON_SECRET                   — shared secret, must match the
//                                    `app.settings.cron_secret` DB setting
//
//  OPTIONAL
//  ────────
//    EMAIL_FROM                    — defaults to 'NEXPEC <notifications@nexpec.com>'
//    APP_BASE_URL                  — public app URL for absolute links
//                                    in the email body (defaults to
//                                    'https://app.nexpec.com')
//
//  RETRY MODEL
//  ───────────
//    claim_pending_notification_emails atomically bumps email_attempts
//    on every claim, so a row that fails 5 times is parked permanently.
//    The platform owner can re-queue manually by clearing email_attempts.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { renderEmail, type NotificationRow } from './templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DispatchRequestBody {
  triggered_by?: string;
  triggered_at?: string;
  pending_estimate?: number;
  /** Optional override for tests / one-off drains. Defaults to 25. */
  limit?: number;
}

interface DispatchResponseBody {
  success: boolean;
  drained: number;
  sent: number;
  failed: number;
  parked: number;
  details?: Array<{
    notification_id: string;
    status: 'sent' | 'failed';
    resend_id?: string;
    error?: string;
  }>;
  error?: string;
}

interface ResendApiOk {
  id: string;
}

interface ResendApiErr {
  name?: string;
  message?: string;
  statusCode?: number;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, {
      success: false, drained: 0, sent: 0, failed: 0, parked: 0,
      error: 'method_not_allowed',
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const fromAddress = Deno.env.get('EMAIL_FROM') || 'NEXPEC <notifications@nexpec.com>';
  const appBaseUrl = (Deno.env.get('APP_BASE_URL') || 'https://app.nexpec.com').replace(/\/+$/, '');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      success: false, drained: 0, sent: 0, failed: 0, parked: 0,
      error: 'missing_supabase_env',
    });
  }
  if (!resendApiKey) {
    return jsonResponse(500, {
      success: false, drained: 0, sent: 0, failed: 0, parked: 0,
      error: 'missing_resend_api_key',
    });
  }

  // Auth gate.
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const callerAuthorised =
    bearer === serviceRoleKey ||
    (cronSecret && bearer === cronSecret);

  if (!callerAuthorised) {
    return jsonResponse(401, {
      success: false, drained: 0, sent: 0, failed: 0, parked: 0,
      error: 'unauthorised',
    });
  }

  // Parse body.
  let body: DispatchRequestBody = {};
  try {
    if (req.headers.get('content-length') !== '0') {
      body = await req.json();
    }
  } catch {
    body = {};
  }
  const limit = clamp(body.limit ?? 25, 1, 100);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ────────── 1) Atomically claim a batch of pending emails ──────────
    const { data: claimed, error: claimErr } = await supabase.rpc(
      'claim_pending_notification_emails',
      { p_limit: limit },
    );

    if (claimErr) {
      return jsonResponse(500, {
        success: false, drained: 0, sent: 0, failed: 0, parked: 0,
        error: `claim failed: ${claimErr.message}`,
      });
    }

    const rows = (Array.isArray(claimed) ? claimed : []) as NotificationRow[];
    if (rows.length === 0) {
      return jsonResponse(200, {
        success: true, drained: 0, sent: 0, failed: 0, parked: 0,
      });
    }

    // ────────── 2) For each row: render → send → record ──────────
    let sent = 0;
    let failed = 0;
    let parked = 0;
    const details: NonNullable<DispatchResponseBody['details']> = [];

    for (const row of rows) {
      if (!row.recipient_email || row.recipient_email.length < 3 || !row.recipient_email.includes('@')) {
        // Bad recipient — record permanent failure so we don't keep trying.
        const msg = `invalid recipient email for profile ${row.recipient_id}`;
        const { error: failErr } = await supabase.rpc('mark_notification_email_failed', {
          p_notification_id: row.id,
          p_error_message: msg,
        });
        if (failErr) console.error('mark failed RPC failed', failErr);
        failed += 1;
        if (row.email_attempts >= 5) parked += 1;
        details.push({ notification_id: row.id, status: 'failed', error: msg });
        continue;
      }

      let rendered;
      try {
        rendered = renderEmail(row, appBaseUrl);
      } catch (renderErr) {
        const msg = `render failure: ${renderErr instanceof Error ? renderErr.message : String(renderErr)}`;
        await supabase.rpc('mark_notification_email_failed', {
          p_notification_id: row.id,
          p_error_message: msg,
        });
        failed += 1;
        if (row.email_attempts >= 5) parked += 1;
        details.push({ notification_id: row.id, status: 'failed', error: msg });
        continue;
      }

      // Coordination Bridge templates carry the actual recipient address
      // in template_data.override_to, because the vendor is not a NEXPEC
      // profile and therefore the recipient_id-resolved email is not the
      // right destination. Other templates ignore this field.
      const overrideTo =
        row.email_template_data && typeof (row.email_template_data as Record<string, unknown>).override_to === 'string'
          ? String((row.email_template_data as Record<string, unknown>).override_to).trim()
          : '';
      const deliveryTo =
        overrideTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(overrideTo)
          ? overrideTo
          : row.recipient_email;

      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
            // Idempotency: if Resend receives the same key within 24h
            // it returns the prior response instead of double-sending.
            'Idempotency-Key': row.id,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [deliveryTo],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            headers: {
              'X-NEXPEC-Notification-Id': row.id,
              'X-NEXPEC-Notification-Kind': row.kind,
              'X-NEXPEC-Template': row.email_template_kind ?? 'generic',
            },
            tags: [
              { name: 'kind', value: sanitiseTag(row.kind) },
              { name: 'template', value: sanitiseTag(row.email_template_kind ?? 'generic') },
            ],
          }),
        });

        if (!resendRes.ok) {
          const errBody = (await safeJson(resendRes)) as ResendApiErr | null;
          const msg = `resend ${resendRes.status}: ${errBody?.message ?? errBody?.name ?? (await safeText(resendRes)).slice(0, 200)}`;
          await supabase.rpc('mark_notification_email_failed', {
            p_notification_id: row.id,
            p_error_message: msg,
          });
          failed += 1;
          if (row.email_attempts >= 5) parked += 1;
          details.push({ notification_id: row.id, status: 'failed', error: msg });
          continue;
        }

        const ok = (await resendRes.json()) as ResendApiOk;
        await supabase.rpc('mark_notification_email_sent', {
          p_notification_id: row.id,
          p_provider_id: ok.id ?? '',
        });
        sent += 1;
        details.push({ notification_id: row.id, status: 'sent', resend_id: ok.id });
      } catch (sendErr) {
        const msg = `network/dispatch error: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`;
        await supabase.rpc('mark_notification_email_failed', {
          p_notification_id: row.id,
          p_error_message: msg,
        });
        failed += 1;
        if (row.email_attempts >= 5) parked += 1;
        details.push({ notification_id: row.id, status: 'failed', error: msg });
      }
    }

    return jsonResponse(200, {
      success: true,
      drained: rows.length,
      sent,
      failed,
      parked,
      details,
    });
  } catch (err) {
    return jsonResponse(500, {
      success: false, drained: 0, sent: 0, failed: 0, parked: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

function jsonResponse(status: number, body: DispatchResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function sanitiseTag(s: string): string {
  // Resend tag values must be ascii letters, numbers, underscore, dash.
  return (s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}
