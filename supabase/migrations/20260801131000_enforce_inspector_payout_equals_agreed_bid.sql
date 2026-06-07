-- ════════════════════════════════════════════════════════════════════════════
--  20260801131000_enforce_inspector_payout_equals_agreed_bid.sql
--
--  MONEY-CORRECTNESS — the inspector's payout must equal the AGREED price.
--
--  Bug: an inspector proposed $360 (applications.bid_amount_cents = 36000), was
--  hired, but the job showed a $350 payout — the original RFQ-spawned posting.
--  The hire never propagated the agreed bid into the job's payout columns:
--    • admin_dispatch_job writes jobs.payout_amount_cents = whatever the dispatch
--      UI passed (which defaulted off a non-existent applications.payout_amount_cents
--      column → wrong value), and never touches the CANONICAL
--      jobs.inspector_payout_cents that the inspector UI actually reads.
--    • assign_job_contractor / mobile direct-hire don't set the payout at all.
--
--  Canonical agreed price = applications.bid_amount_cents. The negotiation loop
--  (20260518350000) already folds an ACCEPTED admin counter into
--  bid_amount_cents, so it is the single post-negotiation source of truth.
--
--  Fix (authoritative, all hire paths, all accounts, future-proof): a BEFORE
--  trigger on jobs that — at the moment a contractor is assigned — forces BOTH
--  inspector_payout_cents and payout_amount_cents to that inspector's agreed
--  bid. It intercepts the row write itself, so it cannot be bypassed by a wrong
--  UI value, whichever RPC performs the hire. A one-time backfill repairs the
--  reported job + any historical drift. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_sync_inspector_payout_to_agreed_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bid bigint;
BEGIN
  -- Only act at the assignment moment (contractor set, or changed).
  IF NEW.contractor_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.contractor_id IS DISTINCT FROM NEW.contractor_id) THEN
    RETURN NEW;
  END IF;

  -- Agreed inspector price = the hired application's bid_amount_cents.
  -- unique_job_application(job_id, applicant_id) guarantees ≤1 row here.
  SELECT a.bid_amount_cents
    INTO v_bid
    FROM public.applications a
   WHERE a.job_id = NEW.id
     AND a.applicant_id = NEW.contractor_id
     AND a.status IN ('hired', 'accepted', 'CLIENT_SELECTED')
     AND a.bid_amount_cents IS NOT NULL
     AND a.bid_amount_cents > 0
   ORDER BY CASE a.status WHEN 'hired' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
            a.updated_at DESC NULLS LAST
   LIMIT 1;

  -- Only override when there is a real agreed bid; otherwise leave the
  -- caller-supplied payout untouched (e.g. brokered-spine assignments that
  -- carry no legacy application row).
  IF v_bid IS NOT NULL THEN
    NEW.inspector_payout_cents := v_bid;
    NEW.payout_amount_cents    := v_bid;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sync_inspector_payout ON public.jobs;
CREATE TRIGGER trg_sync_inspector_payout
  BEFORE INSERT OR UPDATE OF contractor_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_inspector_payout_to_agreed_bid();

-- ── One-time backfill — repair already-assigned jobs that drifted ─────────────
WITH agreed AS (
  SELECT DISTINCT ON (a.job_id)
         a.job_id,
         a.bid_amount_cents
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
   WHERE j.contractor_id IS NOT NULL
     AND a.applicant_id = j.contractor_id
     AND a.status IN ('hired', 'accepted')
     AND a.bid_amount_cents IS NOT NULL
     AND a.bid_amount_cents > 0
   ORDER BY a.job_id,
            CASE a.status WHEN 'hired' THEN 0 ELSE 1 END,
            a.updated_at DESC NULLS LAST
)
UPDATE public.jobs j
   SET inspector_payout_cents = agreed.bid_amount_cents,
       payout_amount_cents    = agreed.bid_amount_cents,
       updated_at             = now()
  FROM agreed
 WHERE agreed.job_id = j.id
   AND ( j.inspector_payout_cents IS DISTINCT FROM agreed.bid_amount_cents
      OR j.payout_amount_cents    IS DISTINCT FROM agreed.bid_amount_cents );

-- ── Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad int;
BEGIN
  IF to_regprocedure('public.tg_sync_inspector_payout_to_agreed_bid()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: trigger function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_inspector_payout' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: trigger not attached to public.jobs';
  END IF;
  -- After backfill, no assigned job may disagree with its hired inspector's bid.
  SELECT count(*) INTO v_bad
    FROM public.jobs j
    JOIN public.applications a
      ON a.job_id = j.id AND a.applicant_id = j.contractor_id
   WHERE j.contractor_id IS NOT NULL
     AND a.status IN ('hired', 'accepted')
     AND a.bid_amount_cents IS NOT NULL AND a.bid_amount_cents > 0
     AND j.inspector_payout_cents IS DISTINCT FROM a.bid_amount_cents;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % assigned job(s) still mismatch the agreed bid', v_bad;
  END IF;
  RAISE NOTICE 'Inspector payout now authoritatively equals the agreed bid on assignment; existing jobs reconciled.';
END $$;

COMMIT;
