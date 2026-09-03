// ════════════════════════════════════════════════════════════════════════════
//  telegram-webhook — the NEXPEC Admin Control Center command surface
//
//  SECURITY MODEL (§6). Three independent gates, all of which must pass:
//    1. Telegram's own X-Telegram-Bot-Api-Secret-Token header must equal
//       TELEGRAM_WEBHOOK_SECRET. Anyone can POST to a public function URL; this
//       proves the request came from Telegram.
//    2. The numeric chat id must be present and active in telegram_admin_chats.
//       Usernames and display names are NEVER used — they are user-changeable.
//    3. Mutating actions additionally require can_act on that row, plus a
//       single-use, chat-bound, 10-minute action token.
//  Unknown chats get a flat refusal with no operational detail leaked (§6
//  "deny by default"), and are not told why.
//
//  This function performs NO destructive operation (§5). Approve/reject,
//  payouts, deletions and access changes deliberately hand off to the
//  authenticated Admin console via a deep link rather than executing in chat.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req: Request) => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const hookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appBase = Deno.env.get('APP_BASE_URL') ?? 'https://www.nexpecapp.com';

  // Gate 1 — provenance. Always answer 200 to Telegram so it does not retry a
  // request we are deliberately ignoring.
  if (!botToken || !hookSecret || !url || !serviceKey) return ok();
  if (req.headers.get('x-telegram-bot-api-secret-token') !== hookSecret) return ok();

  let update: any;
  try { update = await req.json(); } catch { return ok(); }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const msg = update.message ?? update.edited_message;
  const cb = update.callback_query;
  const chatId: number | undefined = msg?.chat?.id ?? cb?.message?.chat?.id;
  const fromId: number | undefined = msg?.from?.id ?? cb?.from?.id;
  if (!chatId || !fromId) return ok();

  const send = async (text: string, keyboard?: unknown) => {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    }).catch(() => {});
  };

  // Gate 2 — allowlist, by numeric id only.
  const { data: chat } = await db
    .from('telegram_admin_chats')
    .select('chat_id, telegram_user_id, profile_id, is_active, can_act')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!chat || !chat.is_active || Number(chat.telegram_user_id) !== Number(fromId)) {
    await send('Not authorised.');   // no detail, no hint, no data
    return ok();
  }
  await db.from('telegram_admin_chats')
    .update({ last_seen_at: new Date().toISOString() }).eq('chat_id', chatId);

  const link = (p: string) => `${appBase}${p}`;

  // ── Callback (button) handling ──────────────────────────────────────────
  if (cb) {
    const data = String(cb.data ?? '');
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cb.id }),
    }).catch(() => {});

    if (!data.startsWith('act:')) return ok();
    if (!chat.can_act) { await send('This chat is read-only.'); return ok(); }

    const token = data.slice(4);
    // Single-use + chat-bound + expiry, enforced atomically in SQL: a
    // double-tapped button executes at most once (§16 duplicate callback).
    const { data: consumed } = await db.rpc('tg_consume_action_token', {
      p_token: token, p_chat_id: chatId,
    });
    const row = Array.isArray(consumed) ? consumed[0] : consumed;
    if (!row) { await send('That confirmation has expired or was already used.'); return ok(); }

    let result = 'failed';
    try {
      if (row.action === 'request_profile_completion') {
        const { error } = await db.rpc('admin_request_profile_completion',
          { p_user_id: row.subject_id, p_note: null });
        result = error ? `error: ${error.message}` : 'sent';
      } else if (row.action === 'request_job_edits') {
        const { error } = await db.rpc('admin_request_job_edits',
          { p_job_id: row.subject_id, p_notes: String(row.payload?.notes ?? 'Please review and complete the job details.') });
        result = error ? `error: ${error.message}` : 'sent';
      } else {
        result = 'unsupported action';
      }
    } catch (e) { result = `error: ${(e as Error).message}`; }

    await db.from('telegram_action_tokens').update({ result }).eq('token', token);

    // §7 — every Telegram-triggered state change is audited in the canonical table.
    await db.from('audit_events').insert({
      event_type: 'telegram.admin_action',
      severity: 'warning',
      actor_id: chat.profile_id,
      actor_label: `Telegram Admin Control Center (chat ${chatId})`,
      subject_table: row.action === 'request_job_edits' ? 'jobs' : 'profiles',
      subject_id: row.subject_id,
      summary: `Telegram action ${row.action} → ${result}`,
      metadata: {
        source: 'telegram_admin_control_center',
        action: row.action, telegram_chat_id: chatId, telegram_user_id: fromId,
        confirmed: true, token_single_use: true, result,
      },
    });

    await send(result === 'sent' ? '✅ Done.' : `⚠️ ${esc(result)}`);
    return ok();
  }

  // ── Commands ────────────────────────────────────────────────────────────
  const text = String(msg?.text ?? '').trim();
  const cmd = text.split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, '');

  if (cmd === '/start' || cmd === '/help') {
    await send(
      '<b>NEXPEC Admin Control Center</b>\n\n' +
      '/status — operational summary\n' +
      '/pending — what needs attention now\n' +
      '/jobs — jobs awaiting moderation\n' +
      '/users — recent registrations\n' +
      '/incomplete — profiles missing details\n' +
      '/support — support threads awaiting reply\n' +
      '/health — delivery &amp; alert health\n\n' +
      '<i>High-impact operations open the Admin console rather than running in chat.</i>',
      { inline_keyboard: [[{ text: 'Open Admin', url: link('/admin') }]] });
    return ok();
  }

  if (cmd === '/status' || cmd === '/today' || cmd === '/pending') {
    const { data: s } = await db.rpc('tg_admin_status');
    if (!s) { await send('Status unavailable.'); return ok(); }
    await send(
      '<b>NEXPEC — Operational Status</b>\n\n' +
      `🟠 Awaiting moderation: <b>${s.jobs_awaiting_moderation}</b>\n` +
      `🔵 Open jobs: <b>${s.jobs_open}</b>\n` +
      `⚠️ Open 48h, no applicants: <b>${s.jobs_zero_applicants_48h}</b>\n` +
      `📥 Applications (24h): <b>${s.applications_24h}</b>\n` +
      `👤 New users (24h): <b>${s.users_24h}</b>\n` +
      `📝 Incomplete profiles: <b>${s.incomplete_profiles}</b>\n` +
      `💬 Support awaiting reply: <b>${s.support_unread}</b>\n` +
      `📄 Reports awaiting review: <b>${s.reports_awaiting_review}</b>\n` +
      `🔴 Critical alerts (24h): <b>${s.critical_alerts_24h}</b>`,
      { inline_keyboard: [
        [{ text: 'Moderation queue', url: link('/admin/jobs') }],
        [{ text: 'Incomplete profiles', url: link('/admin/users/incomplete') }],
        [{ text: 'Messages', url: link('/admin/messages') }],
      ] });
    return ok();
  }

  if (cmd === '/jobs') {
    const { data: jobs } = await db
      .from('jobs').select('id, title, created_at, moderation_status')
      .eq('moderation_status', 'pending_review').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(8);
    if (!jobs?.length) { await send('No jobs awaiting moderation. ✅'); return ok(); }
    // Titles only — no client price or payout is ever put into a chat transcript.
    await send(
      `<b>Awaiting moderation (${jobs.length})</b>\n\n` +
      jobs.map((j: any) => `• ${esc(j.title)}`).join('\n'),
      { inline_keyboard: jobs.slice(0, 5).map((j: any) =>
          [{ text: esc(String(j.title)).slice(0, 40), url: link(`/admin/jobs/${j.id}`) }]) });
    return ok();
  }

  if (cmd === '/users') {
    const { data: users } = await db
      .from('profiles').select('id, full_name, email, role, created_at')
      .not('email', 'ilike', '%@nexpec.test')
      .order('created_at', { ascending: false }).limit(8);
    await send(
      `<b>Recent registrations</b>\n\n` +
      (users ?? []).map((u: any) =>
        `• ${esc(u.full_name ?? 'Unnamed')} — <i>${esc(u.role)}</i>`).join('\n'),
      { inline_keyboard: (users ?? []).slice(0, 5).map((u: any) =>
          [{ text: esc(u.full_name ?? u.email ?? 'user').slice(0, 40), url: link(`/admin/users/${u.id}`) }]) });
    return ok();
  }

  if (cmd === '/incomplete') {
    const { data: rows } = await db.rpc('admin_list_incomplete_profiles', { p_role: null, p_limit: 8 });
    if (!rows?.length) { await send('No incomplete profiles. ✅'); return ok(); }
    const lines = rows.map((r: any) =>
      `• ${esc(r.full_name ?? 'Unnamed')} (${esc(r.role)}) — missing ${esc((r.missing_fields ?? []).join(', '))}`);
    // Offer the safe, reversible action with an explicit confirmation step.
    const first = rows[0];
    const token = crypto.randomUUID().replace(/-/g, '');
    await db.from('telegram_action_tokens').insert({
      token, chat_id: chatId, action: 'request_profile_completion', subject_id: first.id, payload: {},
    });
    await send(
      `<b>Incomplete profiles (${rows.length})</b>\n\n${lines.join('\n')}`,
      { inline_keyboard: [
        [{ text: `Request completion — ${String(first.full_name ?? 'first').slice(0, 24)}`, callback_data: `act:${token}` }],
        [{ text: 'Open list in Admin', url: link('/admin/users/incomplete') }],
      ] });
    return ok();
  }

  if (cmd === '/support') {
    const { data: convs } = await db
      .from('conversations').select('id, user_id, last_message_preview, unread_for_admin')
      .eq('kind', 'help_support').gt('unread_for_admin', 0)
      .order('last_message_at', { ascending: false }).limit(6);
    if (!convs?.length) { await send('No support threads awaiting reply. ✅'); return ok(); }
    await send(
      `<b>Support awaiting reply (${convs.length})</b>\n\n` +
      convs.map((c: any) => `• ${esc(String(c.last_message_preview ?? '').slice(0, 60))}`).join('\n'),
      { inline_keyboard: convs.slice(0, 5).map((c: any) =>
          [{ text: 'Open thread', url: link(`/admin/messages/${c.id}`) }]) });
    return ok();
  }

  if (cmd === '/health') {
    const { data: s } = await db.rpc('tg_admin_status');
    await send(
      '<b>Delivery health</b>\n\n' +
      `Telegram send failures (24h): <b>${s?.telegram_delivery_failures_24h ?? '?'}</b>\n` +
      `Critical alerts (24h): <b>${s?.critical_alerts_24h ?? '?'}</b>`);
    return ok();
  }

  await send('Unknown command. Send /help.');
  return ok();
});
