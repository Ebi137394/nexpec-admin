// ─────────────────────────────────────────────────────────────────
//  notify-agreement
//  Device (Expo) push when a brokered agreement is PRESENTED to its
//  counterparty (supplier_supply / inspector_engagement / client_supply).
//
//  Division of labour:
//    • In-app row + bell badge + email   → DB trigger _brokered_notify_on_present
//      (public.notify_safe). ALWAYS fires, fully autonomous, consent-gated email.
//    • Device push (this function)        → fan out an Expo push to the
//      counterparty's registered devices, gated by should_deliver(...,'push').
//      It writes NO in-app row (the trigger owns that).
//
//  Invoked best-effort by the admin present/assign actions with { agreement_id }.
//  AuthZ: caller must be an admin (nx_is_admin) — a counterparty push is an
//  admin-only side effect, so we reject anonymous / non-admin callers.
//
//  Deploy: `supabase functions deploy notify-agreement`
// ─────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
}

serve(async (req) => {
  try {
    // ── AuthZ: only an admin may trigger a counterparty push ──
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: isAdmin, error: adminErr } = await userClient.rpc('nx_is_admin');
    if (adminErr || isAdmin !== true) return jsonResp({ error: 'Forbidden' }, 403);

    const { agreement_id } = await req.json();
    if (!agreement_id) return jsonResp({ error: 'Missing agreement_id' }, 400);

    // 1. Load the agreement (service role bypasses RLS).
    const { data: agr } = await supa
      .from('agreements')
      .select('id, kind, status, counterparty_id, deal_id')
      .eq('id', agreement_id)
      .maybeSingle();
    if (!agr || !agr.counterparty_id) {
      return jsonResp({ ok: true, pushed: 0, reason: 'no counterparty' });
    }

    // 2. Consent gate — master push switch + per-category toggle; fails OPEN.
    const { data: allowed } = await supa.rpc('should_deliver', {
      p_recipient: agr.counterparty_id,
      p_kind: 'agreement_presented',
      p_channel: 'push',
    });
    if (allowed === false) return jsonResp({ ok: true, pushed: 0, reason: 'muted' });

    // 3. Resolve the counterparty's device tokens.
    const { data: tokenRows } = await supa
      .from('push_tokens')
      .select('token')
      .eq('user_id', agr.counterparty_id);
    const tokens = (tokenRows ?? [])
      .map((r: { token: string }) => r.token)
      .filter((t: string) => !!t && t.startsWith('ExponentPushToken['));
    if (tokens.length === 0) return jsonResp({ ok: true, pushed: 0, reason: 'no tokens' });

    const body =
      agr.kind === 'supplier_supply'
        ? 'NEXPEC has presented a supply agreement for your signature.'
        : agr.kind === 'inspector_engagement'
          ? 'NEXPEC has presented an inspection engagement for your signature.'
          : 'You have a new agreement to review and sign.';

    const messages: ExpoMessage[] = tokens.map((to: string) => ({
      to,
      title: 'New agreement to sign',
      body,
      data: { deep_link: '/agreements', agreement_id: agr.id },
      sound: 'default',
      priority: 'high',
    }));

    await sendExpoPush(messages);
    return jsonResp({ ok: true, pushed: messages.length });
  } catch (e) {
    console.error('[notify-agreement] fatal', e);
    return jsonResp({ error: 'Internal error', detail: String(e) }, 500);
  }
});

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  const BATCH = 100;
  for (let i = 0; i < messages.length; i += BATCH) {
    const slice = messages.slice(i, i + BATCH);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slice),
      });
      const json = await res.json().catch(() => ({}));
      const tickets = json?.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        const t = tickets[j];
        if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
          await supa.from('push_tokens').delete().eq('token', slice[j].to);
          console.warn('[notify-agreement] cleared dead token', slice[j].to);
        }
      }
    } catch (e) {
      console.error('[notify-agreement] expo batch failed', e);
    }
  }
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
