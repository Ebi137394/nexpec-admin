# Phase 2 — Financial Integrity & Notification Consent (applied changeset)

**Status: implemented + verified in the working tree.** This document consolidates every Phase 2 change as an exact, reviewable changeset. Apply order at the bottom.

> Correction to the original framing: the forensic recon showed two of the feared items were **already handled** — both Stripe webhooks already verify signatures (`constructEventAsync`) and already use the `claim/complete/release` idempotency ledger, and **job pricing is already server-derived** (`create-payment-intent` reads `jobs.client_price_cents`). The genuine criticals were (a) `process-payout` had **no idempotency key** (double-pay on retry) and (b) **four endpoints were open** (trusted `body.user_id` with no JWT → IDOR). Deposit/withdrawal *amounts* are client-chosen **by design** and balance-gated, so they are not a pricing vuln. Phase 2 fixes (a) and (b), DRYs the surface with shared helpers, and enforces notification mutes.

---

## 1. NEW — `supabase/functions/_shared/auth.ts` (dependency-free JWT + self-guard)

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Verify the caller's Supabase JWT. Returns { userId, email } or THROWS a 401 Response.
export async function requireUser(req: Request): Promise<{ userId: string; email: string | null }> {
  const authz = req.headers.get('Authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!token) throw json(401, { error: 'missing_authorization', code: 'AUTH_MISSING' });
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw json(401, { error: 'invalid_token', code: 'AUTH_INVALID' });
  return { userId: data.user.id, email: data.user.email ?? null };
}

// Enforce caller == subject (closes IDOR on endpoints taking a user_id in the body).
export function requireSelf(callerId: string, requestedId: unknown): void {
  if (typeof requestedId !== 'string' || requestedId.length === 0) return;
  if (requestedId !== callerId) throw json(403, { error: 'forbidden_not_self', code: 'AUTH_FORBIDDEN' });
}
```

## 2. NEW — `supabase/functions/_shared/stripe.ts` (Stripe plumbing; auth re-exported)

```ts
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
export { corsHeaders, json, requireUser, requireSelf } from './auth.ts';
import { json } from './auth.ts';

export function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw json(503, { error: 'payment_service_unconfigured', code: 'NO_STRIPE_KEY' });
  if (!key.startsWith('sk_live_') && !key.startsWith('sk_test_'))
    throw json(503, { error: 'payment_service_misconfigured', code: 'BAD_STRIPE_KEY' });
  return new Stripe(key, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
```

## 3. CRITICAL — `process-payout/index.ts` idempotency (double-pay fix)

```diff
   const account = await stripe.accounts.create({
     ...
     metadata: { platform: 'nexpec', inspector_id: payout.inspector_id },
-  });
+  }, { idempotencyKey: `nexpec_connect_acct_${payout.inspector_id}` });
```
```diff
-    const transfer = await stripe.transfers.create({
+    // Without an idempotency key a retry after a failed DB write-back creates a
+    // SECOND real transfer = double-pay.
+    const transfer = await stripe.transfers.create({
       amount: amountCents, currency: 'cad', destination: connectedAccountId,
       description: `NEXPEC payout · ${payoutId.slice(0, 8)}`,
       metadata: { payout_request_id: payoutId, inspector_id: typedPayout.inspector_id, platform: 'nexpec' },
-    });
+    }, { idempotencyKey: `nexpec_payout_transfer_${payoutId}` });
```

## 4. HIGH — close IDOR on the four open endpoints (JWT + self-guard)

**`create-setup-intent` / `sync-payment-method`** (both already compute `sanitizedUserId`): add import + guard.
```diff
+ import { requireUser } from '../_shared/auth.ts';
  ...
    const sanitizedUserId = userId.trim();
+   try {
+     const { userId: callerId } = await requireUser(req);
+     if (sanitizedUserId !== callerId)
+       return errorResponse('You can only manage your own payment methods.', 403, 'FORBIDDEN_NOT_SELF');
+   } catch (e) {
+     if (e instanceof Response) return e;
+     return errorResponse('Authentication failed.', 401, 'AUTH_FAILED');
+   }
```

**`create-stripe-connect-link` / `sync-stripe-connect-status`** (replace the trusted `const { user_id } = await req.json()`):
```diff
+ import { requireUser } from '../_shared/auth.ts';
  ...
-    const { user_id } = await req.json();
-    if (!user_id) return json({ error: 'Missing user_id' }, 400);
+    let user_id: string;
+    {
+      let callerId: string;
+      try { callerId = (await requireUser(req)).userId; }
+      catch (e) { if (e instanceof Response) return e; return json({ error: 'auth_failed' }, 401); }
+      const body = await req.json().catch(() => ({} as Record<string, unknown>));
+      if (typeof body?.user_id === 'string' && body.user_id !== callerId)
+        return json({ error: 'forbidden_not_self' }, 403);
+      user_id = callerId;   // always act on the authenticated caller
+    }
```

**Webhooks** (`stripe-payments-webhook`, `stripe-connect-webhook`): **no change** — already verify signatures + use the `claim_stripe_webhook_event` idempotency ledger. Confirmed, not modified.

## 5. Notification mutes — `supabase/migrations/20260801120300_notification_consent.sql`

The store the mobile UI actually uses is `notification_preferences.preferences` (JSONB) — created here (was missing). The predicate is the single source of truth; the email gate is a `BEFORE INSERT` chokepoint catching every path; external `override_to` (vendor) emails are exempt.

```sql
-- canonical store (matches app/notification-settings.tsx)
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);  -- + RLS self/admin, + updated_at trigger

-- single predicate: in_app always; system/safety always; else master-channel AND category; default DELIVER; FAIL OPEN
CREATE OR REPLACE FUNCTION public.should_deliver(p_recipient uuid, p_kind text, p_channel text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_prefs jsonb; v_channel_key text; v_cat_key text;
BEGIN
  IF p_channel = 'in_app' THEN RETURN true; END IF;
  IF p_recipient IS NULL OR p_kind IS NULL THEN RETURN true; END IF;
  IF p_kind IN ('system','system_updates','urgent_safety','security') THEN RETURN true; END IF;
  SELECT preferences INTO v_prefs FROM public.notification_preferences WHERE user_id = p_recipient;
  IF v_prefs IS NULL THEN RETURN true; END IF;
  v_channel_key := CASE p_channel WHEN 'push' THEN 'push_notifications'
    WHEN 'email' THEN 'email_notifications' WHEN 'sms' THEN 'sms_alerts' ELSE NULL END;
  IF v_channel_key IS NOT NULL
     AND COALESCE((v_prefs ->> v_channel_key)::boolean,
                  CASE WHEN p_channel='sms' THEN false ELSE true END) IS FALSE
  THEN RETURN false; END IF;
  v_cat_key := CASE p_kind
    WHEN 'message' THEN 'new_message' WHEN 'new_message' THEN 'new_message'
    WHEN 'payout_released' THEN 'payout_processed' WHEN 'payout_processed' THEN 'payout_processed'
    WHEN 'assignment' THEN 'contract_assigned' WHEN 'contract_assigned' THEN 'contract_assigned'
    WHEN 'report_submitted' THEN 'report_approved_rejected' WHEN 'report_approved' THEN 'report_approved_rejected'
    WHEN 'document_uploaded' THEN 'document_uploaded' WHEN 'application_status' THEN 'new_applicant'
    WHEN 'invoice' THEN 'invoice_generated' WHEN 'invoice_generated' THEN 'invoice_generated' ELSE NULL END;
  IF v_cat_key IS NULL THEN RETURN true; END IF;
  RETURN COALESCE((v_prefs ->> v_cat_key)::boolean, true);
EXCEPTION WHEN OTHERS THEN RETURN true;  -- never silently drop a message
END $fn$;

-- email chokepoint: gate the email overlay on EVERY insert; exempt external override_to
CREATE OR REPLACE FUNCTION public.tg_notifications_consent_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.email_required IS NOT TRUE THEN RETURN NEW; END IF;
  IF COALESCE(NEW.email_template_data,'{}'::jsonb) ? 'override_to' THEN RETURN NEW; END IF;
  IF NEW.recipient_id IS NULL OR NEW.kind IS NULL THEN RETURN NEW; END IF;
  IF NOT public.should_deliver(NEW.recipient_id, NEW.kind, 'email') THEN
    NEW.email_required := false;   -- suppress email; in-app row still lands
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $fn$;
CREATE TRIGGER tg_notifications_consent_gate BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_consent_gate();
```

**Push gate — `notify-job-event/index.ts`** (in-app row still always written):
```diff
       notifRows.push({ user_id: p.recipientId, title: p.title, message: p.body, type: p.type, data: p.data });
+      // Consent gate: respect the recipient's PUSH mute (bell still reliable).
+      const { data: pushAllowed } = await supa.rpc('should_deliver', {
+        p_recipient: p.recipientId, p_kind: p.type, p_channel: 'push',
+      });
+      if (pushAllowed === false) continue;
       const tokens = tokenMap.get(p.recipientId) ?? [];
```

## 6. Storage migration rev 2 — `20260801120200_storage_bucket_hygiene.sql`
Removed the SQL `DELETE FROM storage.buckets` (blocked by `storage.protect_delete`); it now reports emptiness + drops orphan policies, and bucket removal runs via `scripts/ops/merge-bucket.mjs --drop-empty inspection_photos`.

---

## Apply order
1. Migrations (dashboard SQL editor): `20260801120200` (rev 2), `20260801120300`.
2. Redeploy edge functions: `_shared/auth.ts`, `_shared/stripe.ts`, `process-payout`, `create-setup-intent`, `create-stripe-connect-link`, `sync-payment-method`, `sync-stripe-connect-status`, `notify-job-event`.
3. Confirm env: `STRIPE_SECRET_KEY`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `SUPABASE_ANON_KEY`.
4. Verify: replay a webhook (idempotent), call a sync endpoint without a JWT (401) / with a mismatched `user_id` (403), mute email in `notification_preferences` and confirm in-app lands but email is suppressed.

## Known pre-existing (not in Phase 2 scope)
`notify-job-event` inserts in-app rows with `user_id/type/message`, but the v3 `notifications` schema uses `recipient_id/kind/body` — confirm job-event in-app notifications actually persist (separate schema-drift fix).
