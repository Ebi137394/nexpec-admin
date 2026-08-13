-- ════════════════════════════════════════════════════════════════════════════
--  20260801462000_insert_side_guards_and_delivery_gate.sql
--
--  The second independent review found three P0s. Two of them are mine, and
--  they falsify a claim 20260801458000 made in its own header.
--
--  ── P0-A / P0-G1: "STRUCTURAL" WAS ONLY HALF THE SURFACE ───────────────────
--  458000 said its guards were structural, "so a direct PostgREST PATCH is
--  bound by the same rule as the RPC". Both triggers were declared
--  BEFORE UPDATE (458000:137, :256). PostgREST does not only PATCH. It POSTs.
--
--    POST /rest/v1/inspection_reports
--         {"job_id":J,"inspector_id":<self>,"status":"delivered"}
--
--  creates an already-delivered report with no senior approval and no final
--  tranche. inspection_reports.status has no CHECK constraint (baseline:23076),
--  `authenticated` retains INSERT (baseline:40372), the permissive INSERT
--  policies check only `auth.uid() = inspector_id` (baseline:29353/29505/29509),
--  and the restrictive reports_insert_requires_active_inspector passes for the
--  job's own inspector. The UPDATE guard simply never runs.
--
--  The same shape defeats the funding guard:
--    POST /rest/v1/jobs {"client_id":<self>,"client_settled_at":"…"}
--  jobs_insert (baseline:30609) pins no columns, and 20260801312000:34-35
--  states plainly that INSERT privileges were deliberately left untouched. With
--  no stage rows the job takes the legacy branch of both gate predicates
--  (448000:178-179, :198-199) and returns true — the 20% AND 80% gates are
--  satisfied for free. That same INSERT can carry status='assigned' plus a
--  contractor_id, and nx_guard_dispatch_requires_funding is BEFORE UPDATE too
--  (448000:348), so dispatch is never gated either.
--
--  Fixed by making all three guards BEFORE INSERT OR UPDATE and handling
--  TG_OP = 'INSERT', where OLD is NULL.
--
--  The same UPDATE-only omission affects nx_guard_report_no_self_approval
--  (430000:542), which also governs is_published / is_client_approved /
--  technical_approved. Widened here for the same reason.
--
--  ── P0-G2: THE 80% GATE DID NOT GATE THE DELIVERABLE ───────────────────────
--  Delivery status was gated; the FILE was not. nx_can_access_doc
--  (20260801236000:28+) returns true for j.client_id = p_uid against
--  inspection_reports.pdf_url / final_report_doc / photo_url with no status,
--  approval or funding condition, and mint-doc-url/index.ts:68-79 mints a
--  signed URL on that verdict. The client could download the final report the
--  moment the inspector attached it — before review, before the remaining
--  tranche, before delivery. The gate was decorative with respect to the thing
--  the client actually wanted.
--
--  Fixed by requiring, for a CLIENT reading a report document, that the report
--  is actually delivered. Inspector, admin and service paths are untouched:
--  the author must reach their own draft, and Admin must review before
--  releasing it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Delivery guard — now INSERT as well as UPDATE ───────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_report_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_approved boolean; v_was text;
BEGIN
  -- On INSERT there is no OLD; a row born 'delivered' is a transition INTO it.
  v_was := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;

  IF NEW.status IS DISTINCT FROM 'delivered'
     OR v_was IS NOT DISTINCT FROM 'delivered' THEN
    RETURN NEW;
  END IF;

  IF NOT public.nx_actor_is_platform() THEN
    RAISE EXCEPTION
      'DELIVERY_IS_ADMIN_ONLY: only an Admin delivers the final signed report to the Client. This binds INSERT and UPDATE alike — a report cannot be created already delivered.'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.report_senior_reviews r
     WHERE r.inspection_report_id = NEW.id
       AND r.decision = 'approved' AND r.superseded_at IS NULL
       AND r.round = (SELECT max(round) FROM public.report_senior_reviews
                       WHERE inspection_report_id = NEW.id)
  ) INTO v_approved;

  IF NOT v_approved THEN
    RAISE EXCEPTION
      'SENIOR_APPROVAL_REQUIRED: the latest review round has not been approved by a Senior Inspector'
      USING ERRCODE = '22000';
  END IF;

  IF NOT public.nx_funding_delivery_satisfied(NEW.job_id) THEN
    RAISE EXCEPTION
      'FUNDING_REQUIRED: the remaining funding tranche must be in before the final signed report is delivered'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_inspection_reports_delivery_guard ON public.inspection_reports;
CREATE TRIGGER trg_inspection_reports_delivery_guard
  BEFORE INSERT OR UPDATE ON public.inspection_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_report_delivery();

-- ─── 2. jobs funding columns — INSERT as well as UPDATE ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_jobs_funding_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_old timestamptz;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.client_settled_at END;

  IF NEW.client_settled_at IS DISTINCT FROM v_old
     AND NOT public.nx_actor_is_platform() THEN
    RAISE EXCEPTION
      'FUNDING_COLUMN_IS_PLATFORM_ONLY: jobs.client_settled_at records that money arrived. It is written by the payment path or an Admin — never by a client, and never by creating the row pre-settled.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jobs_funding_columns_guard ON public.jobs;
CREATE TRIGGER trg_jobs_funding_columns_guard
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_jobs_funding_columns();

-- ─── 3. Dispatch gate — a job cannot be BORN dispatched ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_dispatch_requires_funding()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mode text; v_dispatch boolean; v_buyer uuid; v_limit bigint;
  v_old_status text; v_old_contractor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_status := NULL; v_old_contractor := NULL;
  ELSE
    v_old_status := OLD.status; v_old_contractor := OLD.contractor_id;
  END IF;

  v_dispatch :=
       (NEW.status = 'assigned' AND v_old_status IS DISTINCT FROM 'assigned')
    OR (NEW.contractor_id IS NOT NULL AND v_old_contractor IS NULL);

  IF NOT v_dispatch THEN
    RETURN NEW;
  END IF;

  v_mode := COALESCE(NEW.payment_mode, 'prepay');

  IF v_mode = 'prepay' THEN
    IF NOT public.nx_funding_initial_satisfied(NEW.id) THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is prepay and its initial funding tranche is not in. Dispatching would send an inspector to site against nothing.',
        NEW.id
        USING ERRCODE = '22000',
              HINT = 'Client funds the initial tranche first. Legacy jobs with jobs.client_settled_at set already satisfy this.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_mode = 'net_terms' THEN
    v_buyer := public.nx_job_buyer_principal(NEW.id);
    IF v_buyer IS NULL THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but has no resolvable buyer principal.',
        NEW.id USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(p.client_credit_limit_cents, 0) INTO v_limit
      FROM public.profiles p WHERE p.id = v_buyer;
    IF COALESCE(v_limit, 0) <= 0 THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but buyer principal % holds no authorised credit line.',
        NEW.id, v_buyer USING ERRCODE = '22000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'FUNDING_REQUIRED: job % has unrecognised payment_mode %; refusing dispatch rather than guessing that it is funded.',
    NEW.id, v_mode USING ERRCODE = '22000';
END $fn$;

DROP TRIGGER IF EXISTS trg_jobs_dispatch_requires_funding ON public.jobs;
CREATE TRIGGER trg_jobs_dispatch_requires_funding
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_dispatch_requires_funding();

-- ─── 4. Self-approval guard — INSERT as well ────────────────────────────────
DROP TRIGGER IF EXISTS trg_reports_no_self_approval ON public.inspection_reports;
CREATE TRIGGER trg_reports_no_self_approval
  BEFORE INSERT OR UPDATE ON public.inspection_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_report_no_self_approval();

-- ─── 5. P0-G2 — the 80% gate now gates the FILE, not just the status ────────
--  A client may read a report document only once it is delivered. The author,
--  Admin and service_role paths are unchanged: the inspector must reach their
--  own draft, and Admin must be able to review before releasing.
CREATE OR REPLACE FUNCTION public.nx_client_may_read_report_doc(p_report_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_status text; v_author uuid; v_client uuid;
BEGIN
  SELECT r.status, r.inspector_id, j.client_id
    INTO v_status, v_author, v_client
    FROM public.inspection_reports r
    JOIN public.jobs j ON j.id = r.job_id
   WHERE r.id = p_report_id;

  IF v_status IS NULL THEN RETURN false; END IF;
  -- the author and the platform are not "the client" for this purpose
  IF p_uid = v_author THEN RETURN true; END IF;
  IF public.nx_is_admin() THEN RETURN true; END IF;
  -- the client: only after delivery
  IF p_uid = v_client THEN RETURN v_status = 'delivered'; END IF;

  RETURN false;
END $fn$;

ALTER FUNCTION public.nx_client_may_read_report_doc(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_client_may_read_report_doc(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_client_may_read_report_doc(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_client_may_read_report_doc(uuid, uuid) IS
  'Report-document read predicate. The author and Admin always pass; the CLIENT passes only '
  'once the report is delivered. Exists because nx_can_access_doc gated on job membership '
  'alone, which let a client download the final report before review, before the remaining '
  'funding tranche and before delivery — making the 80% gate decorative with respect to the '
  'actual deliverable.';

-- ─── 6. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_bad text;
BEGIN
  -- every guard must now cover INSERT, not just UPDATE
  FOR v_bad IN
    SELECT t.tgname
      FROM pg_trigger t
     WHERE t.tgname IN ('trg_inspection_reports_delivery_guard',
                        'trg_jobs_funding_columns_guard',
                        'trg_jobs_dispatch_requires_funding',
                        'trg_reports_no_self_approval')
       AND NOT t.tgisinternal
       -- tgtype bit 2 (value 4) = INSERT
       AND (t.tgtype & 4) = 0
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % is not an INSERT trigger — a row can still be BORN in the forbidden state', v_bad;
  END LOOP;

  -- and all four must actually exist
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgname IN ('trg_inspection_reports_delivery_guard',
                        'trg_jobs_funding_columns_guard',
                        'trg_jobs_dispatch_requires_funding',
                        'trg_reports_no_self_approval')
         AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'SELFTEST: one of the four INSERT/UPDATE guards is missing';
  END IF;

  IF to_regprocedure('public.nx_client_may_read_report_doc(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the report-document delivery predicate is missing';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
