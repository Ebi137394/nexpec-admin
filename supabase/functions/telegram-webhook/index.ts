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

  const link = (p: string) => `${appBase}${p}`;

  // Gate 2 — allowlist, by numeric id only.
  const { data: chat } = await db
    .from('telegram_admin_chats')
    .select('chat_id, telegram_user_id, profile_id, is_active, can_act')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!chat || !chat.is_active || Number(chat.telegram_user_id) !== Number(fromId)) {
    // ── One-tap owner pairing ────────────────────────────────────────────
    //  The ONLY way an unknown chat can gain access. It requires a single-use,
    //  expiring token that arrives via a t.me deep link, so a stranger sending
    //  a bare /start matches nothing. There is never an open enrolment window.
    const startArg = String(msg?.text ?? '').trim().match(/^\/start\s+(\S+)$/)?.[1];
    if (startArg) {
      const { data: paired } = await db.rpc('tg_consume_bootstrap', {
        p_token: startArg,
        p_chat_id: chatId,
        p_user_id: fromId,
        p_username: msg?.from?.username ?? null,
      });
      if (paired === true) {
        await send(
          '<b>✅ NEXPEC Admin Control Center paired</b>\n\n' +
          'This chat is now linked to your admin account and the pairing link is ' +
          'spent.\n\nSend /help to see what I can do.',
          { inline_keyboard: [[{ text: 'Open Admin', url: link('/admin') }]] });
        return ok();
      }
    }
    await send('Not authorised.');   // no detail, no hint, no data
    return ok();
  }
  await db.from('telegram_admin_chats')
    .update({ last_seen_at: new Date().toISOString() }).eq('chat_id', chatId);

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
      // These go through tg_do_* rather than the admin_* RPCs directly. The
      // service-role JWT has no `sub`, so auth.uid() is NULL and nx_is_admin()
      // is FALSE for this client — calling the admin RPCs from here always
      // failed. The wrappers derive the acting admin from THIS chat's
      // allowlist row, so the canonical RPC still runs with a real admin actor
      // and keeps every check it already had.
      if (row.action === 'request_profile_completion') {
        const { error } = await db.rpc('tg_do_request_profile_completion',
          { p_chat_id: chatId, p_user_id: row.subject_id, p_note: null });
        result = error ? `error: ${error.message}` : 'sent';
      } else if (row.action === 'request_job_edits') {
        const { error } = await db.rpc('tg_do_request_job_edits',
          { p_chat_id: chatId, p_job_id: row.subject_id,
            p_note: String(row.payload?.notes ?? 'Please review and complete the job details so it can be approved.') });
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

  // "3h" under a day, "12d" beyond it — an owner reads elapsed time, not a float.
  const age = (h: number) => {
    const n = Number(h) || 0;
    return n < 48 ? `${Math.round(n)}h` : `${Math.round(n / 24)}d`;
  };
  const TIER = {
    urgent:       { icon: '🔴', name: 'Urgent' },
    needs_action: { icon: '🟠', name: 'Needs action' },
    follow_up:    { icon: '🔵', name: 'Follow-up' },
  } as const;

  if (cmd === '/start' || cmd === '/help') {
    await send(
      '<b>NEXPEC Admin Control Center</b>\n\n' +
      '/pending — ranked attention queue\n' +
      '/status — operational counts\n' +
      '/today — last 24 hours\n' +
      '/jobs — jobs awaiting moderation\n' +
      '/users — recent registrations\n' +
      '/incomplete — profiles missing details\n' +
      '/support — support threads awaiting reply\n' +
      '/health — delivery &amp; alert health\n\n' +
      '<i>High-impact operations open the Admin console rather than running in chat.</i>',
      { inline_keyboard: [[{ text: 'Open Admin', url: link('/admin') }]] });
    return ok();
  }

  // ── /pending — one ranked queue, not four independent dumps ─────────────
  if (cmd === '/pending') {
    const { data: q, error } = await db.rpc('tg_attention_queue');
    if (error || !q) { await send('Attention queue unavailable.'); return ok(); }
    const t = q.totals ?? {};
    const sup = q.suppressed ?? {};

    const section = (key: 'urgent' | 'needs_action' | 'follow_up') => {
      const rows = q[key] ?? [];
      if (!rows.length) return '';
      const shown = rows.length;
      const total = Number(t[key] ?? shown);
      const more = total > shown ? `  <i>(+${total - shown} more)</i>` : '';
      return `\n${TIER[key].icon} <b>${TIER[key].name} — ${total}</b>${more}\n` +
        rows.map((r: any) => `• ${esc(String(r.label))} — <i>${age(r.age_hours)}</i>`).join('\n') + '\n';
    };

    const body = section('urgent') + section('needs_action') + section('follow_up');

    // A filtered queue must never read as a clean database, so what was held
    // back is always reported — and nothing was deleted to produce it.
    const held = [
      Number(sup.test_account_moderation ?? 0) && `${sup.test_account_moderation} QA-account jobs`,
      Number(sup.stale_moderation_job_not_open ?? 0) && `${sup.stale_moderation_job_not_open} stale moderation records`,
      Number(sup.test_account_support ?? 0) && `${sup.test_account_support} QA support threads`,
      Number(sup.dormant_incomplete_profiles ?? 0) && `${sup.dormant_incomplete_profiles} dormant profiles`,
    ].filter(Boolean).join(', ');
    const footer = held
      ? `\n<i>Not shown: ${esc(held)}. Nothing was deleted — all of it is still in Admin.</i>`
      : '';

    await send(
      body
        ? `<b>Needs your attention</b>\n${body}${footer}`
        : `<b>Nothing needs your attention.</b> ✅${footer}`,
      { inline_keyboard: [
        [{ text: 'View all — moderation', url: link('/admin/jobs') }],
        [{ text: 'View all — support', url: link('/admin/messages') }],
        [{ text: 'View all — incomplete profiles', url: link('/admin/users/incomplete') }],
      ] });
    return ok();
  }

  // ── /status — counts, with the non-actionable ones shown separately ─────
  if (cmd === '/status') {
    const { data: s, error } = await db.rpc('tg_admin_status');
    if (error || !s) { await send('Status unavailable.'); return ok(); }
    const aside: string[] = [];
    if (Number(s.jobs_moderation_stale ?? 0))
      aside.push(`${s.jobs_moderation_stale} pending on jobs already completed or in progress`);
    if (Number(s.jobs_moderation_test ?? 0))
      aside.push(`${s.jobs_moderation_test} on QA accounts`);
    if (Number(s.incomplete_profiles_all_real ?? 0) > Number(s.incomplete_profiles ?? 0))
      aside.push(`${Number(s.incomplete_profiles_all_real) - Number(s.incomplete_profiles)} dormant incomplete profiles`);
    if (Number(s.support_unread_test ?? 0))
      aside.push(`${s.support_unread_test} QA support threads`);

    await send(
      '<b>NEXPEC — Operational Status</b>\n\n' +
      `🟠 Awaiting moderation: <b>${s.jobs_awaiting_moderation}</b>\n` +
      `🔵 Open jobs: <b>${s.jobs_open}</b>\n` +
      `⚠️ Open 48h, no applicants: <b>${s.jobs_zero_applicants_48h}</b>\n` +
      `📥 Applications (24h): <b>${s.applications_24h}</b>\n` +
      `👤 New users (24h): <b>${s.users_24h}</b>\n` +
      `📝 Incomplete, actively using: <b>${s.incomplete_profiles}</b>\n` +
      `💬 Support awaiting reply: <b>${s.support_unread}</b>\n` +
      `📄 Reports awaiting QA: <b>${s.reports_awaiting_review}</b>\n` +
      `🔴 Critical alerts (24h): <b>${s.critical_alerts_24h}</b>` +
      (aside.length ? `\n\n<i>Excluded as not actionable: ${esc(aside.join('; '))}.</i>` : ''),
      { inline_keyboard: [
        [{ text: 'Moderation queue', url: link('/admin/jobs') }],
        [{ text: 'Incomplete profiles', url: link('/admin/users/incomplete') }],
        [{ text: 'Messages', url: link('/admin/messages') }],
      ] });
    return ok();
  }

  // ── /today — deterministic 24h rollup, no model in the loop ─────────────
  if (cmd === '/today') {
    const { data: d, error } = await db.rpc('tg_today_summary', { p_hours: 24 });
    if (error || !d) { await send('Summary unavailable.'); return ok(); }
    const byRole = Object.entries(d.new_users_by_role ?? {})
      .map(([r, n]) => `${esc(r)} ${n}`).join(' · ');
    await send(
      '<b>NEXPEC — Last 24 hours</b>\n\n' +
      `👤 New users: <b>${d.new_users}</b>${byRole ? ` <i>(${byRole})</i>` : ''}\n` +
      `🆕 Jobs created: <b>${d.jobs_created}</b>\n` +
      `✅ Jobs approved: <b>${d.jobs_approved}</b>\n` +
      `↩️ Jobs sent back: <b>${d.jobs_rejected}</b>\n` +
      `📥 Applications: <b>${d.applications}</b>\n` +
      `💬 Support messages: <b>${d.support_messages}</b>\n` +
      `📄 Reports submitted: <b>${d.reports_submitted}</b>\n` +
      `🔴 Critical alerts: <b>${d.critical_alerts}</b>\n` +
      `📡 Delivery failures: <b>${d.delivery_failures}</b>`,
      { inline_keyboard: [[{ text: 'Open Admin', url: link('/admin') }]] });
    return ok();
  }

  // ── /jobs — the actionable moderation queue only ────────────────────────
  if (cmd === '/jobs') {
    const { data: q } = await db.rpc('tg_attention_queue');
    const rows = [...(q?.urgent ?? []), ...(q?.needs_action ?? [])]
      .filter((r: any) => r.kind === 'moderation');
    const heldBack = Number(q?.suppressed?.test_account_moderation ?? 0)
                   + Number(q?.suppressed?.stale_moderation_job_not_open ?? 0);
    if (!rows.length) {
      await send('No jobs awaiting moderation. ✅' +
        (heldBack ? `\n\n<i>${heldBack} pending records are QA-account or already-closed jobs; they are untouched in Admin.</i>` : ''),
        { inline_keyboard: [[{ text: 'Open moderation queue', url: link('/admin/jobs') }]] });
      return ok();
    }
    // Titles only — no client price or payout is ever put into a chat transcript.
    await send(
      `<b>Awaiting moderation (${rows.length})</b>\n\n` +
      rows.map((j: any) => `• ${esc(String(j.label))} — <i>${age(j.age_hours)}</i>`).join('\n'),
      { inline_keyboard: rows.slice(0, 5).map((j: any) =>
          [{ text: String(j.label).slice(0, 40), url: link(`/admin/jobs/${j.id}`) }]) });
    return ok();
  }

  if (cmd === '/users') {
    const { data: users, error } = await db.rpc('tg_recent_users', { p_chat_id: chatId, p_limit: 8 });
    if (error) { await send('Registrations unavailable.'); return ok(); }
    const rows = users ?? [];
    if (!rows.length) { await send('No recent registrations.'); return ok(); }
    await send(
      '<b>Recent registrations</b>\n\n' +
      rows.map((u: any) =>
        `• ${esc(String(u.name))} — <i>${esc(String(u.role))}</i>, ${age(u.age_hours)}` +
        (u.missing ? `\n  <i>missing: ${esc(String(u.missing))}</i>` : '')).join('\n'),
      { inline_keyboard: rows.slice(0, 5).map((u: any) =>
          [{ text: String(u.name).slice(0, 40), url: link(`/admin/users/${u.id}`) }]) });
    return ok();
  }

  if (cmd === '/incomplete') {
    const { data: rows, error } = await db.rpc('tg_incomplete_profiles', { p_chat_id: chatId, p_limit: 8 });
    if (error) { await send('Incomplete list unavailable.'); return ok(); }
    const list = rows ?? [];
    if (!list.length) { await send('No incomplete profiles. ✅'); return ok(); }
    const label = (r: any) =>
      (r.missing_fields ?? []).map((f: string) => f
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
        .replace(/^Company Name$/, 'Company')
        .replace(/^Full Name$/, 'Name')).join(', ');
    const lines = list.map((r: any) =>
      `• ${esc(String(r.full_name ?? 'Unnamed'))} (${esc(String(r.role))}) — missing: ${esc(label(r))}`);
    const first = list[0];
    const token = crypto.randomUUID().replace(/-/g, '');
    await db.from('telegram_action_tokens').insert({
      token, chat_id: chatId, action: 'request_profile_completion', subject_id: first.id, payload: {},
    });
    await send(
      `<b>Incomplete profiles (${list.length})</b>\n\n${lines.join('\n')}`,
      { inline_keyboard: [
        [{ text: `Request completion — ${String(first.full_name ?? 'first').slice(0, 24)}`, callback_data: `act:${token}` }],
        [{ text: 'View all in Admin', url: link('/admin/users/incomplete') }],
      ] });
    return ok();
  }

  if (cmd === '/support') {
    const { data: q } = await db.rpc('tg_attention_queue');
    const rows = [...(q?.urgent ?? []), ...(q?.needs_action ?? [])]
      .filter((r: any) => r.kind === 'support');
    const qa = Number(q?.suppressed?.test_account_support ?? 0);
    if (!rows.length) {
      await send('No support threads awaiting reply. ✅' +
        (qa ? `\n\n<i>${qa} waiting threads belong to QA accounts; they are untouched in Admin.</i>` : ''),
        { inline_keyboard: [[{ text: 'Open support', url: link('/admin/messages') }]] });
      return ok();
    }
    await send(
      `<b>Support awaiting reply (${rows.length})</b>\n\n` +
      rows.map((c: any) => `• ${esc(String(c.label))} — <i>${age(c.age_hours)}</i>`).join('\n'),
      { inline_keyboard: rows.slice(0, 5).map((c: any) =>
          [{ text: 'Open thread', url: link(`/admin/messages/${c.id}`) }]) });
    return ok();
  }

  if (cmd === '/health') {
    const { data: s } = await db.rpc('tg_admin_status');
    await send(
      '<b>Delivery health</b>\n\n' +
      `📡 Telegram send failures (24h): <b>${s?.telegram_delivery_failures_24h ?? '?'}</b>\n` +
      `✉️ Email send failures (24h): <b>${s?.email_delivery_failures_24h ?? '?'}</b>\n` +
      `🔴 Critical alerts (24h): <b>${s?.critical_alerts_24h ?? '?'}</b>`);
    return ok();
  }

  await send('Unknown command. Send /help.');
  return ok();
});
