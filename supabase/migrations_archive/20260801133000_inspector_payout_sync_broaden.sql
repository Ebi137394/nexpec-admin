-- ════════════════════════════════════════════════════════════════════════════
--  20260801133000_inspector_payout_sync_broaden.sql
--
--  131000/132000 synced the job payout off the inspector's application only when
--  that application was in a winning workflow status (hired/accepted/
--  CLIENT_SELECTED). The reported RFQ-spawned job was hired through a path that
--  left its application at an EARLIER status, so the backfill skipped it and the
--  payout stayed $350 even after db push.
--
--  The agreed price lives on the inspector's application (bid_amount_cents)
--  regardless of its workflow status, so broaden the match to ANY non-rejected /
--  non-withdrawn application from the assigned inspector. Re-runs the backfill
--  broadly (repairs the reported job) and broadens the jobs-side trigger.
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── Broaden the jobs-side trigger (was hired/accepted/CLIENT_SELECTED only) ───
CREATE OR REPLACE FUNCTION public.tg_sync_inspector_payout_to_agreed_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bid bigint;
BEGIN
  IF NEW.contractor_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.contractor_id IS DISTINCT FROM NEW.contractor_id) THEN
    RETURN NEW;
  END IF;

  SELECT a.bid_amount_cents
    INTO v_bid
    FROM public.applications a
   WHERE a.job_id = NEW.id
     AND a.applicant_id = NEW.contractor_id
     AND a.status NOT IN ('rejected', 'withdrawn')
     AND a.bid_amount_cents IS NOT NULL
     AND a.bid_amount_cents > 0
   ORDER BY a.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_bid IS NOT NULL THEN
    NEW.inspector_payout_cents := v_bid;
    NEW.payout_amount_cents    := v_bid;
  END IF;

  RETURN NEW;
END $fn$;

-- ── Broad backfill — every assigned/engaged job → its inspector's agreed bid ──
WITH winner AS (
  SELECT DISTINCT ON (a.job_id)
         a.job_id,
         a.bid_amount_cents
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
   WHERE a.bid_amount_cents IS NOT NULL
     AND a.bid_amount_cents > 0
     AND a.status NOT IN ('rejected', 'withdrawn')
     AND ( j.contractor_id IS NOT NULL
        OR j.status IN ('assigned', 'in_progress', 'completed', 'disputed', 'closed') )
   ORDER BY a.job_id,
            CASE WHEN a.applicant_id = j.contractor_id THEN 0 ELSE 1 END,  -- prefer the assigned inspector
            CASE a.status WHEN 'hired' THEN 0 WHEN 'accepted' THEN 1 WHEN 'CLIENT_SELECTED' THEN 2 ELSE 3 END,
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
  SELECT count(*) INTO v_bad FROM (
    SELECT DISTINCT ON (a.job_id)
           a.bid_amount_cents AS bid,
           j.inspector_payout_cents AS payout
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.bid_amount_cents IS NOT NULL AND a.bid_amount_cents > 0
       AND a.status NOT IN ('rejected', 'withdrawn')
       AND ( j.contractor_id IS NOT NULL
          OR j.status IN ('assigned', 'in_progress', 'completed', 'disputed', 'closed') )
     ORDER BY a.job_id,
              CASE WHEN a.applicant_id = j.contractor_id THEN 0 ELSE 1 END,
              CASE a.status WHEN 'hired' THEN 0 WHEN 'accepted' THEN 1 WHEN 'CLIENT_SELECTED' THEN 2 ELSE 3 END,
              a.updated_at DESC NULLS LAST
  ) s
  WHERE s.payout IS DISTINCT FROM s.bid;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % assigned/engaged job(s) still mismatch the agreed bid', v_bad;
  END IF;
  RAISE NOTICE 'Inspector payout reconciled (broadened) to the agreed bid for every assigned/engaged job.';
END $$;

COMMIT;
