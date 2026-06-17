-- ════════════════════════════════════════════════════════════════════════════
--  20260801132000_inspector_payout_sync_robust.sql
--
--  Strengthens 20260801131000. That migration synced the job payout off
--  jobs.contractor_id — but RFQ-spawned jobs may link the hired inspector via a
--  different column / hire path, so the $360 still didn't land. This keys the
--  sync off the APPLICATION itself (the winning application IS the source of
--  truth, and it carries job_id), so it works regardless of which jobs.* column
--  links the inspector.
--
--  Rule: jobs.inspector_payout_cents = jobs.payout_amount_cents = the winning
--  application's bid_amount_cents (the post-negotiation agreed price; an accepted
--  admin counter is already folded into bid_amount_cents by 20260518350000).
--
--  Three layers: (A) applications-side trigger (fires on hire from any path),
--  (B) the jobs-side trigger from 131000 stays (covers admin_dispatch_job's
--  explicit job-payout write that runs after the app→hired update), (C) a robust
--  backfill keyed on the winning application — which repairs the reported job.
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── A. Applications-side authoritative sync ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_app_sync_job_payout_to_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- When an application is in a winning state and carries a real bid, push that
  -- agreed price into its job's payout columns (both the canonical
  -- inspector_payout_cents the inspector UI reads and the legacy mirror).
  IF NEW.status IN ('hired', 'accepted', 'CLIENT_SELECTED')
     AND NEW.bid_amount_cents IS NOT NULL
     AND NEW.bid_amount_cents > 0 THEN
    UPDATE public.jobs
       SET inspector_payout_cents = NEW.bid_amount_cents,
           payout_amount_cents    = NEW.bid_amount_cents,
           updated_at             = now()
     WHERE id = NEW.job_id
       AND ( inspector_payout_cents IS DISTINCT FROM NEW.bid_amount_cents
          OR payout_amount_cents    IS DISTINCT FROM NEW.bid_amount_cents );
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_app_sync_job_payout ON public.applications;
CREATE TRIGGER trg_app_sync_job_payout
  AFTER INSERT OR UPDATE OF status, bid_amount_cents ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_app_sync_job_payout_to_bid();

-- ── C. Robust backfill — winning application per job, link-column-agnostic ────
--    Repairs the reported job ($350 → $360) and any other drift. unique
--    constraint unique_job_application(job_id, applicant_id) keeps this 1-per-job
--    once the winner is picked.
WITH winner AS (
  SELECT DISTINCT ON (a.job_id)
         a.job_id,
         a.bid_amount_cents
    FROM public.applications a
   WHERE a.bid_amount_cents IS NOT NULL
     AND a.bid_amount_cents > 0
     AND a.status IN ('hired', 'accepted', 'CLIENT_SELECTED')
   ORDER BY a.job_id,
            CASE a.status WHEN 'hired' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
            a.updated_at DESC NULLS LAST
)
UPDATE public.jobs j
   SET inspector_payout_cents = w.bid_amount_cents,
       payout_amount_cents    = w.bid_amount_cents,
       updated_at             = now()
  FROM winner w
 WHERE w.job_id = j.id
   AND ( j.inspector_payout_cents IS DISTINCT FROM w.bid_amount_cents
      OR j.payout_amount_cents    IS DISTINCT FROM w.bid_amount_cents );

-- ── Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_app_sync_job_payout' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: applications payout-sync trigger missing';
  END IF;
  -- No job with a winning application + bid may disagree with that bid.
  SELECT count(*) INTO v_bad FROM (
    SELECT DISTINCT ON (a.job_id)
           a.bid_amount_cents AS bid, j.inspector_payout_cents AS payout
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.bid_amount_cents IS NOT NULL AND a.bid_amount_cents > 0
       AND a.status IN ('hired', 'accepted', 'CLIENT_SELECTED')
     ORDER BY a.job_id,
              CASE a.status WHEN 'hired' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
              a.updated_at DESC NULLS LAST
  ) s
  WHERE s.payout IS DISTINCT FROM s.bid;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % job(s) still mismatch the agreed bid', v_bad;
  END IF;
  RAISE NOTICE 'Inspector payout reconciled to agreed bid via applications + jobs triggers + backfill.';
END $$;

COMMIT;
