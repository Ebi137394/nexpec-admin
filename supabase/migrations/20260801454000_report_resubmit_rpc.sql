-- ════════════════════════════════════════════════════════════════════════════
--  20260801454000_report_resubmit_rpc.sql
--
--  Lane F (offline half) — nx_report_resubmit.
--
--  ── THE PROVEN GAP ─────────────────────────────────────────────────────────
--  UI work needs no migration and this lane tried hard not to need one. But the
--  Inspector's correction currently lives ONLY in a Next.js server action
--  (apps/web/.../submit-report/actions.ts), which is an HTTP endpoint of the web
--  app. The mobile outbox replays through PostgREST against Supabase; it cannot
--  reach a Next server action. Queuing a correction offline therefore had no
--  server-side landing point at all.
--
--  Duplicating the logic in a mobile-side sequence of table writes would create
--  a second, drifting copy of the authorisation rules — precisely the "no V2"
--  failure mode. Instead this migration lifts the SAME rules into one RPC that
--  BOTH surfaces can call. 454000 verified free before use.
--
--  ── RULES MIRRORED FROM actions.ts, IN THE SAME ORDER ──────────────────────
--   1. authenticated caller                    (28000 if not)
--   2. the report is this caller's own         (42501 — never another's)
--   3. LIVE CONTRACT: is_active_contract_inspector — the replacement rule
--   4. the report is genuinely back with its author (status =
--      'returned_to_inspector'); anything else is not awaiting correction
--   5. optimistic lock on updated_at — the row has not moved on
--
--  Every one is re-evaluated AT EXECUTION TIME. That is the whole point for the
--  offline path: an inspector replaced during the offline window, or a report
--  that gained a new review round while the device was dark, must be refused at
--  replay rather than at enqueue. 42501 and 22000 are already FATAL_CODEs in
--  shared-core/offline/syncErrors.ts, so the outbox surfaces the refusal to the
--  user instead of retrying it forever.
--
--  ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
--  No photo upload: binary goes through the existing photo_upload outbox kind
--  and Storage, not through an RPC. No money of any kind — no wallet,
--  transaction, payout, earning or funding stage is read or written, and no
--  funding gate is consulted. Resubmission is a report act.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_report_resubmit(
  p_job_id               uuid,
  p_report_id            uuid,
  p_expected_updated_at  timestamp with time zone,
  p_summary              text,
  p_response_to_reviewer text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid; v_owner uuid; v_status text; v_active boolean; v_hit int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF p_summary IS NULL OR length(btrim(p_summary)) = 0 THEN
    RAISE EXCEPTION 'SUMMARY_REQUIRED: a correction must say what changed'
      USING ERRCODE = '22000';
  END IF;

  -- 2. the report must be this caller's own
  SELECT inspector_id, status INTO v_owner, v_status
    FROM public.inspection_reports
   WHERE id = p_report_id AND job_id = p_job_id
   FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'NOT_THE_REPORT_AUTHOR: this report belongs to another inspector'
      USING ERRCODE = '42501';
  END IF;

  -- 3. LIVE CONTRACT — the replacement rule, fails closed
  SELECT public.is_active_contract_inspector(p_job_id, v_uid) INTO v_active;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'NOT_ACTIVE_INSPECTOR: you are no longer the assigned inspector on this job, so it can no longer be resubmitted by you. Your review history stays readable.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. it must actually be back with its author
  IF v_status IS DISTINCT FROM 'returned_to_inspector' THEN
    RAISE EXCEPTION
      'NOT_AWAITING_CORRECTION: this report is not awaiting corrections right now (status %)', v_status
      USING ERRCODE = '22000';
  END IF;

  -- 5. optimistic lock — the row has not moved on while this was queued
  UPDATE public.inspection_reports
     SET status     = 'submitted',
         notes      = p_summary,
         updated_at = now()
   WHERE id = p_report_id
     AND inspector_id = v_uid
     AND status = 'returned_to_inspector'
     AND updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RAISE EXCEPTION
      'REPORT_CHANGED: this report changed while you were editing — it may have been reassigned or already resubmitted. Nothing was overwritten.'
      USING ERRCODE = '22000';
  END IF;

  -- The reviewer's next round needs the author's response; it is stored on the
  -- report, not on the closed review round, because those rounds are immutable
  -- (nx_guard_senior_review_immutable, 20260801450000).
  IF p_response_to_reviewer IS NOT NULL
     AND length(btrim(p_response_to_reviewer)) > 0 THEN
    UPDATE public.inspection_reports
       SET notes = notes || E'\n\n--- Response to reviewer ---\n' || p_response_to_reviewer
     WHERE id = p_report_id;
  END IF;

  -- Tell the live reviewer their correction has arrived. Pointer only, per the
  -- Lane F privacy rule (20260801452000).
  PERFORM public.nx_notify_lifecycle(
    (SELECT reviewer_id FROM public.report_senior_reviews
      WHERE inspection_report_id = p_report_id
        AND decision IS NULL AND superseded_at IS NULL
      LIMIT 1),
    'A corrected report is ready for your review',
    'The Inspector resubmitted a report you returned. Open it to review the correction.',
    'report_resubmitted',
    '/inspector/reviews/' || p_report_id::text,
    p_job_id);

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'job_id', p_job_id);
END $fn$;

ALTER FUNCTION public.nx_report_resubmit(uuid, uuid, timestamp with time zone, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_resubmit(uuid, uuid, timestamp with time zone, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_resubmit(uuid, uuid, timestamp with time zone, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_resubmit(uuid, uuid, timestamp with time zone, text, text) IS
  'Inspector correction after a Senior Inspector return. ONE authority shared by the web '
  'server action and the mobile offline outbox, so the replacement and optimistic-lock '
  'rules cannot drift between surfaces. Re-evaluates authorship, live contract, report '
  'state and the updated_at lock AT EXECUTION TIME — which is what makes offline replay '
  'safe. Moves no money and consults no funding gate.';

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF has_function_privilege('anon',
       'public.nx_report_resubmit(uuid,uuid,timestamp with time zone,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon can resubmit a report';
  END IF;

  -- every one of the five rules must be present in the body
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_report_resubmit'
       AND p.prosrc ~* 'is_active_contract_inspector'
       AND p.prosrc ~* 'returned_to_inspector'
       AND p.prosrc ~* 'p_expected_updated_at'
       AND p.prosrc ~* 'NOT_THE_REPORT_AUTHOR') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_report_resubmit is missing one of authorship / live-contract / awaiting-correction / optimistic-lock';
  END IF;

  -- and it must move no money
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_report_resubmit'
       AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
           '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|job_funding_stages)\M') THEN
    RAISE EXCEPTION 'SELFTEST: nx_report_resubmit touches money';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
