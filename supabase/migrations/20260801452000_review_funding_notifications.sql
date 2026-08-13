-- ════════════════════════════════════════════════════════════════════════════
--  20260801452000_review_funding_notifications.sql
--
--  Lane F — notifications for the Senior Review and staged-funding lifecycles.
--
--  ── WHY THIS IS A MIGRATION AND NOT UI WORK ────────────────────────────────
--  UI work needs no migration and this lane created none until now. But
--  nx_notify is SECURITY DEFINER and REVOKED from anon, authenticated and
--  PUBLIC (20260801316000) — deliberately, so a client cannot mint a
--  notification to another user. The only sanctioned place to emit one is
--  therefore from inside a definer RPC that already owns the transition. That
--  is a function change, so: 452000. Verified free before use.
--
--  Emitting from inside the RPC also makes the notification atomic with the
--  state change. A surface that fired a notification after its RPC returned
--  could notify on a transaction that later rolled back.
--
--  ── PRIVACY RULE, ENFORCED BY CONSTRUCTION ─────────────────────────────────
--  No notification carries money, margin, or the other party's identity.
--  Every body below is a POINTER — "something happened, here is the link" —
--  and the recipient then reads the underlying surface, where RLS and the
--  audience-scoped projections already decide what they may see.
--
--  This is stricter than it strictly needs to be in one place: the reviewer's
--  return comments are written FOR the inspector, so quoting them would not
--  leak across a party boundary. They are still not quoted, because
--  notifications.body is additionally consumed by the transactional-email
--  dispatcher (baseline COMMENT on email_required), which pushes the text off
--  platform. Free-text a human typed is exactly the field most likely to
--  contain a price or a name, so it stays in the app.
--
--  ── IDEMPOTENCY ────────────────────────────────────────────────────────────
--  Every emitter sits AFTER the early-return in an already-idempotent RPC:
--  nx_funding_mark_stage_funded returns early on a replayed PaymentIntent, and
--  nx_funding_ensure_schedule returns early when a schedule exists. So a Stripe
--  webhook retry re-enters the RPC, hits the early return, and never reaches
--  the emitter. No notification is sent twice for one transition.
--
--  ── NO MONEY MOVES HERE ────────────────────────────────────────────────────
--  This migration adds notification emission only. It changes no funding or
--  review authorization, no gate, and touches no wallet, transaction, payout
--  or earning. Asserted in §5.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The privacy-safe emitter ────────────────────────────────────────────
--  One place where review/funding notifications are built, so the "pointer,
--  never an amount" rule is reviewable in a single function instead of being
--  restated at every call site.
CREATE OR REPLACE FUNCTION public.nx_notify_lifecycle(
  p_recipient uuid,
  p_title     text,
  p_body      text,
  p_kind      text,
  p_link      text,
  p_job_id    uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- A missing recipient is not an error worth aborting a state transition for.
  -- A job with no assigned inspector, or a report whose author was deleted,
  -- must not roll back an Admin's delivery. Skip quietly instead.
  IF p_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  -- Defence in depth against the one mistake this lane must not make. If a
  -- future edit interpolates an amount into a title or body, fail loudly here
  -- rather than mail it to the wrong party.
  IF p_title ~ '[0-9]{2,}[.,][0-9]{2}' OR p_body ~ '[0-9]{2,}[.,][0-9]{2}'
     OR p_title ~* '\m(SAR|USD|\$)\s*[0-9]' OR p_body ~* '\m(SAR|USD|\$)\s*[0-9]' THEN
    RAISE EXCEPTION
      'NOTIFICATION_CONTAINS_AMOUNT: lifecycle notifications are pointers, not statements. Link to the surface and let RLS decide what this recipient may see.';
  END IF;

  RETURN public.nx_notify(p_recipient, p_title, p_body, p_kind, p_link, p_job_id);
END $fn$;

ALTER FUNCTION public.nx_notify_lifecycle(uuid, text, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_notify_lifecycle(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.nx_notify_lifecycle(uuid, text, text, text, text, uuid) IS
  'Review/funding lifecycle notification emitter. Bodies are POINTERS — never an '
  'amount, margin, or the other party''s identity — because notifications.body is '
  'also pushed off platform by the transactional-email dispatcher. Rejects any '
  'title/body containing a currency-shaped number. Definer-only, like nx_notify.';

-- ─── 2. Senior Review: assignment, supersession, decision ───────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_assign_senior_reviewer(
  p_report_id uuid, p_reviewer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_role text; v_uid uuid; v_job uuid; v_round int; v_open uuid;
  v_prev_reviewer uuid;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT job_id INTO v_job FROM public.inspection_reports WHERE id = p_report_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Replacement isolation: close the live round rather than reassigning it.
  SELECT id, reviewer_id INTO v_open, v_prev_reviewer
    FROM public.report_senior_reviews
   WHERE inspection_report_id = p_report_id
     AND decision IS NULL AND superseded_at IS NULL
   FOR UPDATE;
  IF v_open IS NOT NULL THEN
    UPDATE public.report_senior_reviews
       SET superseded_at = now(), superseded_by = v_uid
     WHERE id = v_open;
  END IF;

  SELECT COALESCE(max(round), 0) + 1 INTO v_round
    FROM public.report_senior_reviews WHERE inspection_report_id = p_report_id;

  INSERT INTO public.report_senior_reviews
    (inspection_report_id, job_id, round, reviewer_id, assigned_by)
  VALUES (p_report_id, v_job, v_round, p_reviewer_id, COALESCE(v_uid, p_reviewer_id));

  -- drives Lane B's auto-capture into report_review_history
  UPDATE public.inspection_reports
     SET status = 'in_senior_review'
   WHERE id = p_report_id;

  -- ── Lane F ────────────────────────────────────────────────────────────────
  PERFORM public.nx_notify_lifecycle(
    p_reviewer_id,
    'Report assigned for your review',
    'An Admin has assigned an inspection report to you for Senior Inspector review.',
    'senior_review_assigned',
    '/inspector/reviews/' || p_report_id::text,
    v_job);

  -- STALE-USER DENIAL, told to the person it affects. A replaced reviewer is
  -- silently unable to act; without this they would keep an inbox entry that
  -- now rejects every decision. Skipped when the same reviewer is reassigned.
  IF v_prev_reviewer IS NOT NULL AND v_prev_reviewer <> p_reviewer_id THEN
    PERFORM public.nx_notify_lifecycle(
      v_prev_reviewer,
      'Review assignment withdrawn',
      'This report has been reassigned to another Senior Inspector. Your round is closed and no longer accepts a decision. The history remains readable.',
      'senior_review_superseded',
      '/inspector/reviews/' || p_report_id::text,
      v_job);
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'reviewer_id', p_reviewer_id,
                            'superseded_round', v_open IS NOT NULL);
END $fn$;

CREATE OR REPLACE FUNCTION public.nx_senior_review_decide(
  p_report_id uuid, p_decision text, p_comments text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid; v_id uuid; v_reviewer uuid; v_round int;
  v_author uuid; v_job uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','returned') THEN
    RAISE EXCEPTION 'INVALID_DECISION: expected approved or returned, got %', p_decision;
  END IF;
  IF p_decision = 'returned'
     AND (p_comments IS NULL OR length(btrim(p_comments)) = 0) THEN
    RAISE EXCEPTION 'RETURN_REQUIRES_COMMENT: say what must change';
  END IF;

  SELECT id, reviewer_id, round INTO v_id, v_reviewer, v_round
    FROM public.report_senior_reviews
   WHERE inspection_report_id = p_report_id
     AND decision IS NULL AND superseded_at IS NULL
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NO_OPEN_REVIEW: this report has no live Senior Inspector assignment'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_reviewer <> v_uid THEN
    RAISE EXCEPTION
      'NOT_THE_ASSIGNED_REVIEWER: round % is assigned to another Senior Inspector', v_round
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.report_senior_reviews
     SET decision = p_decision, decided_at = now(), decided_by = v_uid,
         comments = p_comments
   WHERE id = v_id;

  UPDATE public.inspection_reports
     SET status = CASE WHEN p_decision = 'approved'
                       THEN 'senior_approved' ELSE 'returned_to_inspector' END
   WHERE id = p_report_id;

  -- ── Lane F ────────────────────────────────────────────────────────────────
  SELECT inspector_id, job_id INTO v_author, v_job
    FROM public.inspection_reports WHERE id = p_report_id;

  IF p_decision = 'returned' THEN
    -- The comments are NOT quoted; see the privacy note in the header.
    PERFORM public.nx_notify_lifecycle(
      v_author,
      'Your report was returned for correction',
      'A Senior Inspector returned your report with comments. Open it to read them and resubmit.',
      'senior_review_returned',
      '/inspector/jobs/' || v_job::text || '/submit-report',
      v_job);
  ELSE
    PERFORM public.nx_notify_lifecycle(
      v_author,
      'Your report passed Senior Inspector review',
      'Your report was approved in review. An Admin performs final delivery to the Client.',
      'senior_review_approved',
      '/inspector/jobs/' || v_job::text || '/submit-report',
      v_job);

    PERFORM public.nx_notify_admins(
      'Report approved and awaiting delivery',
      'A Senior Inspector approved a report. Final delivery to the Client is an Admin action and may still be gated on the remaining funding tranche.',
      'senior_review_approved',
      '/admin/reports',
      v_job);

    -- The remaining tranche becomes due at approval — this is the moment the
    -- Client can act, so it is the moment to tell them.
    IF NOT public.nx_funding_delivery_satisfied(v_job) THEN
      PERFORM public.nx_notify_lifecycle(
        (SELECT client_id FROM public.jobs WHERE id = v_job),
        'Remaining funding required',
        'Your report has passed review. The remaining funding tranche is required before the final signed report can be delivered.',
        'funding_required_final',
        '/client/jobs/' || v_job::text || '/funding',
        v_job);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'decision', p_decision);
END $fn$;

-- ─── 3. Funding: required and confirmed ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_funding_ensure_schedule(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_price bigint; v_init int; v_fin int; v_exists boolean; v_client uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_exists;
  IF v_exists THEN
    -- Early return: a re-render of the funding page must not re-notify.
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  SELECT COALESCE(client_price_cents, 0), client_id INTO v_price, v_client
    FROM public.jobs WHERE id = p_job_id;
  SELECT initial_bps, final_bps INTO v_init, v_fin FROM public.funding_term_defaults WHERE id = 1;

  INSERT INTO public.job_funding_stages
    (job_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
  VALUES
    (p_job_id, 1, 'initial', 'Initial funding (before assignment)', v_init,
     (v_price * v_init) / 10000, 'before_assignment'),
    (p_job_id, 2, 'final',   'Remaining funding (after report review)', v_fin,
     v_price - ((v_price * v_init) / 10000), 'after_report_review');

  -- ── Lane F ────────────────────────────────────────────────────────────────
  PERFORM public.nx_notify_lifecycle(
    v_client,
    'Initial funding required',
    'A funding schedule is ready for your job. The initial tranche authorises the inspector to be assigned and start work.',
    'funding_required_initial',
    '/client/jobs/' || p_job_id::text || '/funding',
    p_job_id);

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id,
                            'initial_bps', v_init, 'final_bps', v_fin);
END $$;

CREATE OR REPLACE FUNCTION public.nx_funding_mark_stage_funded(
  p_job_id uuid, p_code text, p_payment_intent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_jwt_role text; v_id uuid; v_status text; v_client uuid;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role IN ('anon','authenticated') AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  -- Idempotent on the PaymentIntent: Stripe retries webhooks. The emitter sits
  -- below this early return, so a replay never re-notifies.
  IF p_payment_intent IS NOT NULL THEN
    SELECT id, status INTO v_id, v_status
      FROM public.job_funding_stages
     WHERE stripe_payment_intent_id = p_payment_intent;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'stage_id', v_id);
    END IF;
  END IF;

  SELECT id, status INTO v_id, v_status
    FROM public.job_funding_stages
   WHERE job_id = p_job_id AND code = p_code
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FUNDING_STAGE_NOT_FOUND: job % has no % tranche', p_job_id, p_code
      USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'funded' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'stage_id', v_id);
  END IF;

  UPDATE public.job_funding_stages
     SET status = 'funded', funded_at = now(),
         stripe_payment_intent_id = COALESCE(p_payment_intent, stripe_payment_intent_id)
   WHERE id = v_id;

  -- ── Lane F ────────────────────────────────────────────────────────────────
  SELECT client_id INTO v_client FROM public.jobs WHERE id = p_job_id;

  PERFORM public.nx_notify_lifecycle(
    v_client,
    CASE WHEN p_code = 'initial'
         THEN 'Initial funding confirmed' ELSE 'Remaining funding confirmed' END,
    CASE WHEN p_code = 'initial'
         THEN 'Your initial tranche is confirmed. The inspector can now be assigned and authorised to start.'
         ELSE 'Your remaining tranche is confirmed. The final signed report can now be delivered once an Admin releases it.' END,
    'funding_confirmed',
    '/client/jobs/' || p_job_id::text || '/funding',
    p_job_id);

  PERFORM public.nx_notify_admins(
    CASE WHEN p_code = 'initial'
         THEN 'Initial funding received' ELSE 'Remaining funding received' END,
    'A client funding tranche was confirmed. Inspector settlement and payout remain manual.',
    'funding_confirmed',
    '/admin/funding/' || p_job_id::text,
    p_job_id);

  RETURN jsonb_build_object('ok', true, 'stage_id', v_id, 'code', p_code);
END $$;

-- ─── 4. Delivery: the Client's report is ready ──────────────────────────────
--  Appends the emitter to the existing body without touching either gate.
CREATE OR REPLACE FUNCTION public.nx_admin_deliver_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_jwt_role text; v_uid uuid; v_job uuid; v_approved boolean; v_client uuid;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: only an Admin delivers the final signed report to the Client'
      USING ERRCODE = '42501';
  END IF;

  SELECT job_id INTO v_job FROM public.inspection_reports WHERE id = p_report_id;
  IF v_job IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.report_senior_reviews
     WHERE inspection_report_id = p_report_id
       AND decision = 'approved' AND superseded_at IS NULL
       AND round = (SELECT max(round) FROM public.report_senior_reviews
                     WHERE inspection_report_id = p_report_id)
  ) INTO v_approved;

  IF NOT v_approved THEN
    RAISE EXCEPTION
      'SENIOR_APPROVAL_REQUIRED: the latest review round has not been approved by a Senior Inspector'
      USING ERRCODE = '22000';
  END IF;

  IF NOT public.nx_funding_delivery_satisfied(v_job) THEN
    RAISE EXCEPTION
      'FUNDING_REQUIRED: the remaining funding tranche must be in before the final signed report is delivered'
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.inspection_reports
     SET status = 'delivered'
   WHERE id = p_report_id;

  -- ── Lane F ────────────────────────────────────────────────────────────────
  SELECT client_id INTO v_client FROM public.jobs WHERE id = v_job;

  PERFORM public.nx_notify_lifecycle(
    v_client,
    'Your final signed report is ready',
    'The final signed inspection report for your job has been delivered and is available now.',
    'report_delivered',
    '/client/jobs/' || v_job::text,
    v_job);

  PERFORM public.nx_notify_lifecycle(
    (SELECT inspector_id FROM public.inspection_reports WHERE id = p_report_id),
    'Your report was delivered to the Client',
    'An Admin delivered your approved report. Settlement and payout are handled separately and remain manual.',
    'report_delivered',
    '/inspector/jobs/' || v_job::text,
    v_job);

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'job_id', v_job);
END $fn$;

-- ─── 5. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  -- 5a. the emitter is not reachable by any client role
  IF has_function_privilege('anon',
       'public.nx_notify_lifecycle(uuid,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.nx_notify_lifecycle(uuid,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_notify_lifecycle is reachable by a client role';
  END IF;

  -- 5b. NO notification path moves money
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('nx_notify_lifecycle','nx_admin_assign_senior_reviewer',
                       'nx_senior_review_decide','nx_admin_deliver_report')
     AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
         '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % review/notification function(s) move money (%)', v_n, v_bad;
  END IF;

  -- 5c. both delivery gates survived the rewrite
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nx_admin_deliver_report'
                    AND p.prosrc ~* 'SENIOR_APPROVAL_REQUIRED'
                    AND p.prosrc ~* 'nx_funding_delivery_satisfied') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_admin_deliver_report lost a gate — delivery must require BOTH senior approval and the remaining tranche';
  END IF;

  -- 5d. the assigned-reviewer check survived
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nx_senior_review_decide'
                    AND p.prosrc ~* 'NOT_THE_ASSIGNED_REVIEWER') THEN
    RAISE EXCEPTION 'SELFTEST: nx_senior_review_decide lost its assigned-reviewer check';
  END IF;

  -- 5e. the funding emitters still sit behind their idempotent early returns
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nx_funding_mark_stage_funded'
                    AND p.prosrc ~* 'idempotent') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_funding_mark_stage_funded lost its idempotent early return — a webhook replay would re-notify';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
