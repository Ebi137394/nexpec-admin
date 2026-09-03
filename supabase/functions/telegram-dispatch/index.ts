// ════════════════════════════════════════════════════════════════════════════
//  telegram-dispatch — drains the Telegram delivery outbox
//
//  Invoked by pg_cron via cron_kickoff_telegram_dispatch(), exactly like
//  dispatch-notification-emails. It reads notifications already written by the
//  normal producers (nx_notify_admins etc.), so Telegram never becomes a second
//  source of truth — it is a delivery channel over the same rows.
//
//  FAILURE SAFETY (§13): this runs out-of-band. Nothing here can block signup,
//  job creation, approval, applications, reports or support messaging. A failed
//  send increments telegram_attempts and records the error; after 5 attempts the
//  row is left alone rather than retried forever.
//
//  Auth: Bearer CRON_SECRET or the service-role key — the same contract the
//  email dispatcher uses. verify_jwt is disabled for this function because the
//  caller is pg_cron, which cannot present a user JWT.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Telegram's HTML subset. Escaping is mandatory: job titles and user names are
// user-authored and would otherwise break the message or inject markup.
const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SEVERITY_BADGE: Record<string, string> = {
  critical: '🔴 CRITICAL',
  action_required: '🟠 ACTION REQUIRED',
  operational: '🔵 Operational',
  informational: 'ℹ️',
};

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!((cronSecret && bearer === cronSecret) || (serviceKey && bearer === serviceKey))) {
    return json(401, { error: 'unauthorised' });
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const url = Deno.env.get('SUPABASE_URL');
  if (!botToken || !url || !serviceKey) {
    // Unconfigured is not an error state worth retrying against Telegram.
    return json(200, { skipped: 'telegram not configured', sent: 0 });
  }
  const appBase = Deno.env.get('APP_BASE_URL') ?? 'https://www.nexpecapp.com';
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Active, still-allowlisted admin chats.
  const { data: chats } = await db
    .from('telegram_admin_chats')
    .select('chat_id')
    .eq('is_active', true);
  if (!chats?.length) return json(200, { skipped: 'no active admin chats', sent: 0 });

  const { data: pending } = await db
    .from('notifications')
    .select('id, title, body, kind, severity, link_href, job_id, telegram_attempts')
    .eq('telegram_required', true)
    .is('telegram_dispatched_at', null)
    .lt('telegram_attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (!pending?.length) return json(200, { sent: 0, pending: 0 });

  let sent = 0, failed = 0;

  for (const n of pending) {
    const badge = SEVERITY_BADGE[n.severity ?? 'informational'] ?? 'ℹ️';
    const deep = n.link_href?.startsWith('/') ? `${appBase}${n.link_href}` : null;
    const text =
      `<b>${badge}</b>\n` +
      `<b>${esc(n.title ?? 'NEXPEC')}</b>\n` +
      (n.body ? `${esc(n.body)}\n` : '') +
      (n.kind ? `\n<i>${esc(n.kind)}</i>` : '');

    // Deep links open the authenticated Admin console — the bot never becomes a
    // second UI for anything that already has a proper screen (§5).
    const keyboard = deep
      ? { inline_keyboard: [[{ text: 'Open in Admin', url: deep }]] }
      : undefined;

    let ok = false, errText: string | null = null, messageId: number | null = null;
    for (const chat of chats) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chat.chat_id,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...(keyboard ? { reply_markup: keyboard } : {}),
          }),
        });
        const jr = await r.json().catch(() => ({}));
        if (r.ok && jr?.ok) { ok = true; messageId = jr.result?.message_id ?? null; }
        else errText = `${r.status}: ${jr?.description ?? 'send failed'}`;
      } catch (e) {
        errText = String((e as Error)?.message ?? e);
      }
    }

    // Marking dispatched is what makes this idempotent: a row is only ever
    // delivered once, even if the cron fires again mid-batch.
    if (ok) {
      await db.from('notifications').update({
        telegram_dispatched_at: new Date().toISOString(),
        telegram_attempts: (n.telegram_attempts ?? 0) + 1,
        telegram_last_attempt_at: new Date().toISOString(),
        telegram_message_id: messageId,
        telegram_send_error: null,
      }).eq('id', n.id);
      sent++;
    } else {
      await db.from('notifications').update({
        telegram_attempts: (n.telegram_attempts ?? 0) + 1,
        telegram_last_attempt_at: new Date().toISOString(),
        telegram_send_error: errText,
      }).eq('id', n.id);
      failed++;
    }
  }

  return json(200, { sent, failed, batch: pending.length });
});
