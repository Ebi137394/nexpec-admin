-- ════════════════════════════════════════════════════════════════════════════
--  20260801450000_senior_inspector_review.sql
--
--  Senior Inspector review, report-level. Completes the flow:
--
--    Inspector submits report
--      → Admin assigns an authorised Senior Inspector
--        → Senior Inspector approves, or returns with comments
--          → Inspector resubmits when required
--            → Admin performs final Client delivery
--
--  ── WHY THE LEGACY PATH IS SUPERSEDED, NOT REPAIRED ────────────────────────
--  baseline:16605
--      CREATE FUNCTION public.request_senior_review(p_job_id uuid) …
--        UPDATE public.jobs SET status = 'senior_review', is_senior_review = TRUE
--         WHERE id = p_job_id AND client_id = auth.uid();
--
--  It is broken on two independent counts, both verified at this HEAD:
--
--   1. `senior_review` IS NOT A VALID JOB STATUS. The authoritative
--      jobs_status_check admits pending_approval | open | assigned |
--      in_progress | completed | cancelled | disputed | paid
--      (20260801328000:42). Writing 'senior_review' violates the constraint, so
--      this function RAISES every time it is called. It is dead on arrival —
--      no job has ever transitioned through it.
--
--   2. IT IS DRIVEN BY THE CLIENT (`client_id = auth.uid()`). The contracted
--      flow has the ADMIN assign a reviewer. A client cannot be the party that
--      triggers internal QA.
--
--  The correct fix is therefore not to add 'senior_review' to the job status
--  vocabulary — that would push an internal QA state into the commercial job
--  lifecycle, where it does not belong and where every consumer of
--  jobs.status would have to learn it. Review state is REPORT-level. This
--  migration puts it there and makes the legacy function refuse loudly.
--
--  ── REUSE, NOT DUPLICATION ─────────────────────────────────────────────────
--  Lane B (20260801430000) already built the immutable audit substrate:
--    • report_review_history — append-only (trg…_append_only), TRUNCATE-guarded
--      (trg…_no_truncate), and AUTO-CAPTURED from inspection_reports.status
--      changes by trg…_capture, recording actor_id from auth.uid() — never a
--      parameter, so the actor cannot be forged.
--    • nx_report_review_transition(text) — the shared status vocabulary.
--  This lane drives inspection_reports.status through the RPCs below, so every
--  transition lands in that history automatically. No second history table, no
--  second actor model, no copy of a report row.
--
--  ── ZERO PAYMENT SIDE EFFECTS ──────────────────────────────────────────────
--  Nothing here writes wallets, transactions, earnings or payouts. Approval by
--  a Senior Inspector does not pay anybody. Final delivery is GATED ON funding
--  (Lane 5's nx_funding_delivery_satisfied) but does not MOVE money: Inspector
--  settlement and payout remain manual and Admin-controlled (444000/446000).
--  Asserted in §7.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Report-level review state ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_senior_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_report_id  uuid NOT NULL REFERENCES public.inspection_reports(id) ON DELETE CASCADE,
  job_id                uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,

  -- 1-based review round. A return -> resubmit -> reassign cycle increments it,
  -- so history is a sequence of rounds rather than a mutated row.
  round                 integer NOT NULL,

  reviewer_id           uuid NOT NULL,
  assigned_by           uuid NOT NULL,
  assigned_at           timestamp with time zone NOT NULL DEFAULT now(),

  decision              text,
  decided_at            timestamp with time zone,
  decided_by            uuid,
  comments              text,

  -- Replacement isolation: a superseded assignment is closed out, never
  -- rewritten, so the replaced reviewer's round remains legible on its own.
  superseded_at         timestamp with time zone,
  superseded_by         uuid,

  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT report_senior_reviews_round_uq UNIQUE (inspection_report_id, round),
  CONSTRAINT report_senior_reviews_decision_check CHECK (
    decision IS NULL OR decision = ANY (ARRAY['approved','returned'])),
  -- a decision must carry its timestamp and author, and vice versa
  CONSTRAINT report_senior_reviews_decided_coherent CHECK (
    (decision IS NULL     AND decided_at IS NULL     AND decided_by IS NULL)
 OR (decision IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  -- a returned review must say why
  CONSTRAINT report_senior_reviews_return_needs_comment CHECK (
    decision IS DISTINCT FROM 'returned'
    OR (comments IS NOT NULL AND length(btrim(comments)) > 0)),
  -- a superseded review cannot also have been decided
  CONSTRAINT report_senior_reviews_supersede_coherent CHECK (
    superseded_at IS NULL OR decision IS NULL)
);

-- At most ONE live assignment per report: not decided, not superseded.
CREATE UNIQUE INDEX IF NOT EXISTS report_senior_reviews_one_open_uq
  ON public.report_senior_reviews (inspection_report_id)
  WHERE decision IS NULL AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS report_senior_reviews_reviewer_idx
  ON public.report_senior_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS report_senior_reviews_job_idx
  ON public.report_senior_reviews (job_id);

COMMENT ON TABLE public.report_senior_reviews IS
  'Senior Inspector review state, held at REPORT level. Supersedes the dead job-level '
  'request_senior_review path (baseline:16605), which wrote the invalid job status '
  '''senior_review'' and was client-driven. Rounds are append-style: a replacement '
  'supersedes rather than overwrites, so each reviewer''s round stays legible. Carries no '
  'money column and triggers no payment.';

ALTER TABLE public.report_senior_reviews ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_report_senior_reviews_touch ON public.report_senior_reviews;
CREATE TRIGGER trg_report_senior_reviews_touch
  BEFORE UPDATE ON public.report_senior_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

-- ─── 2. Structural guards ───────────────────────────────────────────────────
--  Enforced as triggers rather than only inside the RPCs, so they bind
--  PostgREST and any future writer, not just the one call path.

--  2a. No self-review. A CHECK cannot reach another table, so this is a trigger.
CREATE OR REPLACE FUNCTION public.nx_guard_no_self_senior_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_author uuid;
BEGIN
  SELECT inspector_id INTO v_author
    FROM public.inspection_reports WHERE id = NEW.inspection_report_id;
  IF v_author IS NOT NULL AND NEW.reviewer_id = v_author THEN
    RAISE EXCEPTION
      'SELF_REVIEW_FORBIDDEN: % authored this report and cannot be its Senior Inspector reviewer',
      NEW.reviewer_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_report_senior_reviews_no_self ON public.report_senior_reviews;
CREATE TRIGGER trg_report_senior_reviews_no_self
  BEFORE INSERT OR UPDATE OF reviewer_id ON public.report_senior_reviews
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_no_self_senior_review();

--  2b. A decided round is immutable. Only supersession of an UNDECIDED round,
--      and the decision write itself, are permitted.
CREATE OR REPLACE FUNCTION public.nx_guard_senior_review_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.decision IS NOT NULL THEN
    IF NEW.decision      IS DISTINCT FROM OLD.decision
    OR NEW.decided_at    IS DISTINCT FROM OLD.decided_at
    OR NEW.decided_by    IS DISTINCT FROM OLD.decided_by
    OR NEW.comments      IS DISTINCT FROM OLD.comments
    OR NEW.reviewer_id   IS DISTINCT FROM OLD.reviewer_id
    OR NEW.round         IS DISTINCT FROM OLD.round
    OR NEW.inspection_report_id IS DISTINCT FROM OLD.inspection_report_id THEN
      RAISE EXCEPTION
        'REVIEW_IMMUTABLE: round % of this report was already decided (%); assign a new round instead of rewriting it',
        OLD.round, OLD.decision
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_report_senior_reviews_immutable ON public.report_senior_reviews;
CREATE TRIGGER trg_report_senior_reviews_immutable
  BEFORE UPDATE ON public.report_senior_reviews
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_senior_review_immutable();

--  2c. Deletion is not a review workflow.
CREATE OR REPLACE FUNCTION public.nx_guard_senior_review_no_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION
    'REVIEW_HISTORY_IMMUTABLE: senior review rounds are not deletable; supersede instead'
    USING ERRCODE = '42501';
END $fn$;

DROP TRIGGER IF EXISTS trg_report_senior_reviews_no_delete ON public.report_senior_reviews;
CREATE TRIGGER trg_report_senior_reviews_no_delete
  BEFORE DELETE ON public.report_senior_reviews
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_senior_review_no_delete();

-- ─── 3. Admin assigns a Senior Inspector ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_assign_senior_reviewer(
  p_report_id uuid, p_reviewer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_role text; v_uid uuid; v_job uuid; v_round int; v_open uuid;
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
  SELECT id INTO v_open
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

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'reviewer_id', p_reviewer_id,
                            'superseded_round', v_open IS NOT NULL);
END $fn$;

-- ─── 4. The assigned reviewer decides ───────────────────────────────────────
--  Only the reviewer named on the LIVE round may decide it. auth.uid() is read
--  from the session, never accepted as a parameter, so a sign-off cannot be
--  forged by passing someone else's id.
CREATE OR REPLACE FUNCTION public.nx_senior_review_decide(
  p_report_id uuid, p_decision text, p_comments text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid; v_id uuid; v_reviewer uuid; v_round int;
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

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'decision', p_decision);
END $fn$;

-- ─── 5. Admin delivers to the Client — the only delivery path ───────────────
--  Gated on (a) a live senior approval and (b) Lane 5's remaining funding.
--  Moves no money.
CREATE OR REPLACE FUNCTION public.nx_admin_deliver_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_jwt_role text; v_uid uuid; v_job uuid; v_approved boolean;
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

  -- Lane 5 (20260801448000): the remaining tranche must be in first.
  IF NOT public.nx_funding_delivery_satisfied(v_job) THEN
    RAISE EXCEPTION
      'FUNDING_REQUIRED: the remaining funding tranche is not in; the final signed report cannot be delivered'
      USING ERRCODE = '22000',
            HINT = 'Client funds the final tranche, then deliver. Delivery moves no money — Inspector payout stays manual.';
  END IF;

  UPDATE public.inspection_reports SET status = 'delivered' WHERE id = p_report_id;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'job_id', v_job);
END $fn$;

-- ─── 6. Supersede the legacy path ───────────────────────────────────────────
--  Preserved, not dropped (the 20260801432000 precedent). It could never have
--  worked — 'senior_review' violates jobs_status_check — so nothing regresses.
DO $legacy$
BEGIN
  IF to_regprocedure('public.request_senior_review(uuid)') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.request_senior_review(p_job_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
      AS $b$
      BEGIN
        RAISE EXCEPTION
          'SUPERSEDED: senior review is report-level and Admin-assigned as of 20260801450000. '
          'Use nx_admin_assign_senior_reviewer(report_id, reviewer_id). The job status '
          '''senior_review'' this function wrote is not in jobs_status_check, so this path '
          'never functioned.'
          USING ERRCODE = '42501';
      END $b$;
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.request_senior_review(uuid) FROM anon, PUBLIC, authenticated';
    EXECUTE 'COMMENT ON FUNCTION public.request_senior_review(uuid) IS '
         || quote_literal('SUPERSEDED and inert. Was client-driven and wrote the invalid job '
            || 'status ''senior_review'', so it raised on every call. Replaced by the '
            || 'report-level, Admin-assigned flow in 20260801450000. Preserved for history.');
  END IF;
END
$legacy$;

-- ─── 7. Privacy RLS ─────────────────────────────────────────────────────────
--  Internal QA. The Client is deliberately NOT a reader here: it receives the
--  delivered report, not the reviewer's internal comments.
DROP POLICY IF EXISTS report_senior_reviews_admin_all   ON public.report_senior_reviews;
DROP POLICY IF EXISTS report_senior_reviews_reviewer    ON public.report_senior_reviews;
DROP POLICY IF EXISTS report_senior_reviews_author_read ON public.report_senior_reviews;

CREATE POLICY report_senior_reviews_admin_all ON public.report_senior_reviews
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

CREATE POLICY report_senior_reviews_reviewer ON public.report_senior_reviews
  FOR SELECT USING (reviewer_id = auth.uid());

--  The authoring Inspector must see why their report came back.
CREATE POLICY report_senior_reviews_author_read ON public.report_senior_reviews
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.inspection_reports r
             WHERE r.id = report_senior_reviews.inspection_report_id
               AND r.inspector_id = auth.uid())
  );

REVOKE ALL ON TABLE public.report_senior_reviews FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.report_senior_reviews TO authenticated;
GRANT ALL    ON TABLE public.report_senior_reviews TO service_role;

REVOKE ALL ON FUNCTION public.nx_admin_assign_senior_reviewer(uuid,uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_senior_review_decide(uuid,text,text)    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_admin_deliver_report(uuid)              FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_admin_assign_senior_reviewer(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_senior_review_decide(uuid,text,text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_admin_deliver_report(uuid)              TO authenticated, service_role;

-- ─── 8. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  -- 8a. no invalid job status was introduced
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_status_check'
       AND pg_get_constraintdef(oid) ILIKE '%senior_review%') THEN
    RAISE EXCEPTION
      'SELFTEST: ''senior_review'' was added to jobs_status_check — review state is report-level and must not enter the job lifecycle';
  END IF;

  -- 8b. legacy path is inert and unreachable by clients
  IF to_regprocedure('public.request_senior_review(uuid)') IS NOT NULL THEN
    IF has_function_privilege('authenticated','public.request_senior_review(uuid)','EXECUTE')
       OR has_function_privilege('anon','public.request_senior_review(uuid)','EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST: the superseded request_senior_review is still client-reachable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='request_senior_review'
                      AND p.prosrc ILIKE '%SUPERSEDED%') THEN
      RAISE EXCEPTION 'SELFTEST: request_senior_review was not superseded';
    END IF;
  END IF;

  -- 8c. structural guards are attached (not merely enforced inside the RPCs)
  FOREACH v_bad IN ARRAY ARRAY[
      'trg_report_senior_reviews_no_self',
      'trg_report_senior_reviews_immutable',
      'trg_report_senior_reviews_no_delete']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = v_bad AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'SELFTEST: structural guard % is not attached', v_bad;
    END IF;
  END LOOP;

  -- 8d. only one live assignment per report is representable
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='report_senior_reviews_one_open_uq') THEN
    RAISE EXCEPTION 'SELFTEST: the one-open-review-per-report index is missing';
  END IF;

  -- 8e. ZERO payment side effects
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('nx_admin_assign_senior_reviewer','nx_senior_review_decide',
                       'nx_admin_deliver_report','nx_guard_no_self_senior_review',
                       'nx_guard_senior_review_immutable')
     AND regexp_replace(p.prosrc,'--[^\n]*',' ','g') ~*
         '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % senior-review function(s) move money (%)', v_n, v_bad;
  END IF;

  -- 8f. delivery is gated on Lane 5 funding
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nx_admin_deliver_report'
                    AND p.prosrc ~* 'nx_funding_delivery_satisfied') THEN
    RAISE EXCEPTION 'SELFTEST: final delivery does not consult the remaining-funding gate';
  END IF;

  -- 8g. anon is locked out entirely
  IF has_table_privilege('anon','public.report_senior_reviews','SELECT')
     OR has_function_privilege('anon','public.nx_admin_deliver_report(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon can reach the senior-review surface';
  END IF;

  -- 8h. Lane B's immutable history substrate is still in place and reused
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='report_review_history') THEN
    RAISE EXCEPTION 'SELFTEST: report_review_history is missing — this lane reuses it rather than adding a second history';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
