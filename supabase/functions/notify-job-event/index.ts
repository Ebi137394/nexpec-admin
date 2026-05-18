// ─────────────────────────────────────────────────────────────────
//  notify-job-event
//  Triggered (via pg_net) by AFTER INSERT on public.job_events.
//
//  Pipeline:
//    1. Re-read the event row (service-role bypass of RLS).
//    2. Resolve recipients per event_type (and per status transition).
//    3. Skip recipients already notified for this event_id (idempotency).
//    4. Insert in-app notification rows (powers the bell + /notifications).
//    5. Look up recipients' push tokens in public.push_tokens (one row
//       per user today, multi-device-ready) and fan out an Expo push
//       per device.
//    6. On Expo "DeviceNotRegistered", delete the dead token row from
//       public.push_tokens so it isn't retried. The next sign-in
//       re-upserts a fresh token via the client hook.
//
//  Deploy: `supabase functions deploy notify-job-event`
//  Then run the one-time _app_config INSERT to wire pg_net to this URL.
// ─────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── TYPES ──────────────────────────────────────────────────────────

interface JobEvent {
  id: string;
  job_id: string;
  actor_id: string | null;
  event_type:
    | 'created'
    | 'status_change'
    | 'contractor_assigned'
    | 'contractor_unassigned'
    | 'soft_deleted'
    | 'restored'
    | 'application_created'
    | 'application_status_change';
  old_status: string | null;
  new_status: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: { application_id?: string; applicant_id?: string } | null;
  created_at: string;
}

interface JobLite {
  id: string;
  title: string | null;
  client_id: string;
  contractor_id: string | null;
  agency_id: string | null;
}

interface Payload {
  recipientId: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
}

// ─── ENTRY ──────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    const { event_id } = await req.json();
    if (!event_id) {
      return jsonResp({ error: 'Missing event_id' }, 400);
    }

    // 1. Re-read the event
    const { data: event, error: evErr } = await supa
      .from('job_events')
      .select('*')
      .eq('id', event_id)
      .single<JobEvent>();
    if (evErr || !event) {
      console.error('[notify] event not found', event_id, evErr);
      return jsonResp({ error: 'Event not found' }, 404);
    }

    // 2. Read the job
    const { data: job } = await supa
      .from('jobs')
      .select('id, title, client_id, contractor_id, agency_id')
      .eq('id', event.job_id)
      .maybeSingle<JobLite>();
    if (!job) {
      console.warn('[notify] job not found for event', event.id);
      return jsonResp({ error: 'Job not found' }, 404);
    }

    // 3. Resolve recipients
    const payloads = await buildPayloads(event, job);
    if (payloads.length === 0) {
      return jsonResp({
        ok: true,
        delivered: 0,
        reason: 'no recipients for event_type',
      });
    }

    // 4. Bulk-fetch recipient profiles + push tokens
    //
    // ★ NOTIF-FANOUT-001 — Push tokens previously lived on the
    //   non-existent `profiles.push_token` column; pre-strike this
    //   SELECT silently returned `push_token=undefined` for every
    //   recipient and no push went out (only the in-app row was
    //   written). Tokens now live in their own table — public.push_tokens
    //   (PUSH-TOKENS-001) — and we read them in a separate query
    //   keyed on the same recipientIds set.
    //
    //   Profiles are still queried as the "does this user exist"
    //   guard: a recipient deleted between event creation and fan-out
    //   is silently skipped via the profileMap.has(...) check below.
    //
    //   The token map is shaped as Map<user_id, string[]> rather than
    //   Map<user_id, string> on purpose: today's schema has a PRIMARY
    //   KEY on push_tokens.user_id (one row per user), but a future
    //   composite-key migration (multi-device) is a no-op on this
    //   side of the codebase. The fan-out loop already iterates the
    //   token list per recipient.
    const recipientIds = [...new Set(payloads.map((p) => p.recipientId))];
    const { data: profiles } = await supa
      .from('profiles')
      .select('id, full_name')
      .in('id', recipientIds);
    const profileMap = new Map(
      (profiles ?? []).map((p: any) => [p.id as string, p]),
    );

    const { data: tokenRows } = await supa
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', recipientIds);
    const tokenMap = new Map<string, string[]>();
    for (const r of tokenRows ?? []) {
      const uid = (r as any).user_id as string;
      const tok = (r as any).token as string;
      if (!uid || !tok) continue;
      const list = tokenMap.get(uid) ?? [];
      list.push(tok);
      tokenMap.set(uid, list);
    }

    // 5. Idempotency — skip recipients already notified for this event
    const { data: existing } = await supa
      .from('notifications')
      .select('user_id')
      .eq('data->>event_id', event.id);
    const alreadyDelivered = new Set(
      (existing ?? []).map((n: any) => n.user_id as string),
    );

    // 6. Build push messages + in-app notification rows
    const pushMessages: ExpoMessage[] = [];
    const notifRows: Record<string, unknown>[] = [];

    for (const p of payloads) {
      if (alreadyDelivered.has(p.recipientId)) continue;
      const profile = profileMap.get(p.recipientId);
      if (!profile) continue;

      // Always log the in-app row (so the bell badge updates even
      // for users with no push_token registered).
      notifRows.push({
        user_id: p.recipientId,
        title: p.title,
        message: p.body,
        type: p.type,
        data: p.data,
      });

      // ★ NOTIF-FANOUT-001 — One Expo message per device. ExponentPushToken[…]
      //   prefix guard preserves the prior validation behaviour (rejects
      //   tokens written by buggy clients or simulator mock paths). Users
      //   with no token entry in push_tokens still get the in-app row
      //   logged above — they just don't receive a push, same as before.
      const tokens = tokenMap.get(p.recipientId) ?? [];
      for (const token of tokens) {
        if (!token.startsWith('ExponentPushToken[')) continue;
        pushMessages.push({
          to: token,
          title: p.title,
          body: p.body,
          data: p.data,
          sound: 'default',
          priority: 'high',
        });
      }
    }

    // 7. Insert in-app rows. The unique index on
    //    notifications(user_id, (data->>'event_id')) protects us from
    //    pg_net duplicate deliveries.
    if (notifRows.length > 0) {
      const { error: insErr } = await supa
        .from('notifications')
        .insert(notifRows);
      if (insErr) {
        // Likely unique-violation on retry — fall back to per-row insert
        // and swallow conflicts silently.
        console.warn('[notify] bulk insert failed, falling back', insErr.message);
        for (const row of notifRows) {
          await supa
            .from('notifications')
            .insert(row)
            .then(
              () => {},
              () => {},
            );
        }
      }
    }

    // 8. Send push batch (max 100/req per Expo docs)
    if (pushMessages.length > 0) {
      await sendExpoPush(pushMessages);
    }

    return jsonResp({
      ok: true,
      event_type: event.event_type,
      pushed: pushMessages.length,
      logged: notifRows.length,
    });
  } catch (e) {
    console.error('[notify] fatal', e);
    return jsonResp({ error: 'Internal error', detail: String(e) }, 500);
  }
});

// ─── RECIPIENT RESOLUTION ───────────────────────────────────────────

async function buildPayloads(
  event: JobEvent,
  job: JobLite,
): Promise<Payload[]> {
  const out: Payload[] = [];
  const jobTitle = job.title || 'a job';
  // Universal deep-link — your role-aware tab routes resolve it.
  const deepLink = `/jobs/${job.id}`;
  const dataFor = (extra: Record<string, unknown> = {}) => ({
    event_id: event.id,
    job_id: job.id,
    event_type: event.event_type,
    deep_link: deepLink,
    ...extra,
  });

  switch (event.event_type) {
    case 'created': {
      const { data: admins } = await supa
        .from('profiles')
        .select('id')
        .eq('role', 'super_admin');
      for (const a of admins ?? []) {
        out.push({
          recipientId: (a as any).id,
          title: 'New job for moderation',
          body: `${jobTitle} was just posted.`,
          type: 'job_created',
          data: dataFor(),
        });
      }
      break;
    }

    case 'status_change': {
      const trans = `${event.old_status ?? 'null'}→${event.new_status ?? 'null'}`;

      if (trans === 'open→assigned') {
        // Inspector hears about it via contractor_assigned (same RPC fires both).
        // Notify only the agency here to avoid double-pinging the inspector.
        if (job.agency_id && job.agency_id !== job.client_id) {
          out.push({
            recipientId: job.agency_id,
            title: 'Inspector assigned',
            body: `${jobTitle} now has an inspector.`,
            type: 'job_assigned',
            data: dataFor(),
          });
        }
      } else if (trans === 'assigned→in_progress') {
        out.push({
          recipientId: job.client_id,
          title: 'Inspection started',
          body: `Work has begun on ${jobTitle}.`,
          type: 'job_in_progress',
          data: dataFor(),
        });
        if (job.agency_id && job.agency_id !== job.client_id) {
          out.push({
            recipientId: job.agency_id,
            title: 'Inspection started',
            body: `Work has begun on ${jobTitle}.`,
            type: 'job_in_progress',
            data: dataFor(),
          });
        }
      } else if (trans === 'in_progress→completed') {
        out.push({
          recipientId: job.client_id,
          title: 'Inspection completed',
          body: `${jobTitle} has been completed.`,
          type: 'job_completed',
          data: dataFor(),
        });
      }
      // ─── Task 3 (Phase 2) — Dispute lifecycle ──────────────
      else if (event.new_status === 'disputed') {
        // Anyone → disputed. Notify super-admins + every other party.
        const { data: admins } = await supa
          .from('profiles')
          .select('id')
          .eq('role', 'super_admin');
        for (const a of admins ?? []) {
          out.push({
            recipientId: (a as any).id,
            title: 'Dispute opened',
            body: `${jobTitle} has been flagged for review.`,
            type: 'dispute_opened',
            data: dataFor({ urgency: 'high' }),
          });
        }
        const actorId = event.actor_id;
        const candidates = [job.client_id, job.contractor_id, job.agency_id]
          .filter((id): id is string => !!id && id !== actorId);
        const seen = new Set<string>();
        for (const recipientId of candidates) {
          if (seen.has(recipientId)) continue;
          seen.add(recipientId);
          out.push({
            recipientId,
            title: 'A dispute was opened',
            body: `${jobTitle} has been flagged. An admin will review it.`,
            type: 'dispute_opened',
            data: dataFor(),
          });
        }
      } else if (trans === 'disputed→completed') {
        // Resolved in inspector's favor — payment will be released.
        if (job.contractor_id) {
          out.push({
            recipientId: job.contractor_id,
            title: 'Dispute resolved — payment released',
            body: `Your payment for ${jobTitle} has been released.`,
            type: 'dispute_resolved_paid',
            data: dataFor(),
          });
        }
        out.push({
          recipientId: job.client_id,
          title: 'Dispute resolved',
          body: `The dispute on ${jobTitle} was resolved in the inspector's favor.`,
          type: 'dispute_resolved_paid',
          data: dataFor(),
        });
      } else if (trans === 'disputed→cancelled') {
        // Resolved in client's favor — refund issued.
        out.push({
          recipientId: job.client_id,
          title: 'Dispute resolved — refund issued',
          body: `Your refund for ${jobTitle} is being processed.`,
          type: 'dispute_resolved_refunded',
          data: dataFor(),
        });
        if (job.contractor_id) {
          out.push({
            recipientId: job.contractor_id,
            title: 'Dispute resolved',
            body: `The dispute on ${jobTitle} was resolved with a client refund.`,
            type: 'dispute_resolved_refunded',
            data: dataFor(),
          });
        }
        if (
          job.agency_id &&
          job.agency_id !== job.client_id &&
          job.agency_id !== job.contractor_id
        ) {
          out.push({
            recipientId: job.agency_id,
            title: 'Dispute resolved',
            body: `${jobTitle} was cancelled and refunded.`,
            type: 'dispute_resolved_refunded',
            data: dataFor(),
          });
        }
      }
      break;
    }

    case 'contractor_assigned': {
      // Winner
      if (job.contractor_id) {
        out.push({
          recipientId: job.contractor_id,
          title: 'You got the job!',
          body: `You've been hired for ${jobTitle}.`,
          type: 'hired',
          data: dataFor(),
        });
      }
      // Other applicants — "position filled"
      const { data: others } = await supa
        .from('applications')
        .select('applicant_id')
        .eq('job_id', job.id);
      const seen = new Set<string>();
      for (const r of others ?? []) {
        const aid = (r as any).applicant_id as string | null;
        if (!aid || aid === job.contractor_id) continue;
        if (seen.has(aid)) continue;
        seen.add(aid);
        out.push({
          recipientId: aid,
          title: 'Position filled',
          body: `Another inspector was selected for ${jobTitle}.`,
          type: 'application_rejected',
          data: dataFor(),
        });
      }
      break;
    }

    case 'application_created': {
      out.push({
        recipientId: job.client_id,
        title: 'New applicant',
        body: `A new inspector applied for ${jobTitle}.`,
        type: 'application_received',
        data: dataFor({ application_id: event.metadata?.application_id }),
      });
      if (job.agency_id && job.agency_id !== job.client_id) {
        out.push({
          recipientId: job.agency_id,
          title: 'New applicant',
          body: `A new inspector applied for ${jobTitle}.`,
          type: 'application_received',
          data: dataFor({ application_id: event.metadata?.application_id }),
        });
      }
      break;
    }

    case 'soft_deleted': {
      if (job.contractor_id) {
        out.push({
          recipientId: job.contractor_id,
          title: 'Job removed',
          body: `${jobTitle} was removed by the client.`,
          type: 'job_deleted',
          data: dataFor(),
        });
      }
      break;
    }

    // ─── Task 5 — Fraud alert fan-out ───────────────────────
    case 'fraud_alert': {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      const kind = (meta.kind as string | undefined) ?? 'unknown';
      const recent = (meta.recent_cancellations as number | undefined) ?? null;
      const windowMin = (meta.window_minutes as number | undefined) ?? null;
      const threshold = (meta.threshold as number | undefined) ?? null;
      const suspectClient = (meta.client_id as string | undefined) ?? null;

      let alertTitle: string;
      let alertBody: string;
      if (kind === 'cancellation_spam') {
        alertTitle = 'Cancellation spam detected';
        alertBody =
          `Client just cancelled ${recent ?? '?'} jobs in the last ` +
          `${windowMin ?? '?'} minutes (threshold ${threshold ?? '?'}). Review urgently.`;
      } else {
        alertTitle = `Fraud alert: ${kind}`;
        alertBody = 'Suspicious activity detected. Open the admin console to review.';
      }

      const { data: admins } = await supa
        .from('profiles')
        .select('id')
        .eq('role', 'super_admin');

      for (const a of admins ?? []) {
        out.push({
          recipientId: (a as any).id,
          title: alertTitle,
          body: alertBody,
          type: 'fraud_alert',
          data: dataFor({
            urgency: 'critical',
            fraud_kind: kind,
            suspect_client_id: suspectClient,
            recent_cancellations: recent,
            window_minutes: windowMin,
            threshold,
          }),
        });
      }
      break;
    }

    // contractor_unassigned, restored, application_status_change:
    // logged for audit but not pushed (avoids duplicates with
    // contractor_assigned which already fans out to losers).
    default:
      break;
  }

  return out;
}

// ─── EXPO PUSH ──────────────────────────────────────────────────────

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
        if (
          t?.status === 'error' &&
          t?.details?.error === 'DeviceNotRegistered'
        ) {
          // ★ NOTIF-FANOUT-001 — Pre-strike this nulled out the
          //   non-existent profiles.push_token column (silent no-op).
          //   Tokens now live in their own table; the cleanup is a
          //   DELETE keyed on the dead token value, which trivially
          //   removes the row(s) owned by whichever user(s) registered
          //   the stale device. The next sign-in re-upserts a fresh
          //   token via saveTokenToDatabase().
          const deadToken = slice[j].to;
          await supa
            .from('push_tokens')
            .delete()
            .eq('token', deadToken);
          console.warn('[notify] cleared dead token', deadToken);
        }
      }
    } catch (e) {
      console.error('[notify] expo push batch failed', e);
    }
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
