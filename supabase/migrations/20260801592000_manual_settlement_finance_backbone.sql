-- ════════════════════════════════════════════════════════════════════════════
--  20260801592000_manual_settlement_finance_backbone.sql
--
--  NEXPEC v1 settles manually. Card payment is a later release; the manual
--  workflow must therefore be first-class, not a fallback — and every party
--  needs a truthful financial picture of their own side without ever seeing
--  the other side's commercials.
--
--  ── WHAT THE AUDIT FOUND ───────────────────────────────────────────────────
--  manual_payment_records already models everything settlement needs
--  (direction, partial amounts, method, reference, notes, status, paid_on).
--  Two real defects around it:
--
--   1. Its ONLY policy is manual_payment_records_admin_all. A buyer could not
--      see that their own bank transfer had been recorded, and an inspector
--      could not see their own payout. The ledger was write-only from the
--      user's perspective — which is precisely why Finance felt unfinished.
--
--   2. `authenticated` holds INSERT/UPDATE/DELETE/TRUNCATE on the table at the
--      grant layer. RLS blocks it today, making this latent rather than live,
--      but a financial ledger must not be one policy edit away from being
--      user-writable. Recording money is an admin RPC, never a table write.
--
--  ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  Three role-scoped views, each showing one side only:
--
--    my_job_settlement_view    buyer side. Total contract value, settled,
--                              pending confirmation, outstanding — derived from
--                              client_price_cents and client_payment records
--                              ONLY. Never payout, never spread.
--    my_earnings_view          provider side. Earned, paid, due — from
--                              inspector_payout_cents and inspector_payout
--                              records ONLY. Never buyer price, never spread.
--    my_settlement_activity    the party's own ledger rows, direction-filtered.
--
--  The views use the codebase's *_secure_view pattern: OWNER rights (the
--  anon-grant lockdown removed table-level jobs SELECT from users on purpose)
--  with security_barrier and an explicit per-row authorization predicate in
--  the WHERE clause. Column exposure is fixed by the view definition, row
--  exposure by the predicate — proven non-leaking by
--  manual_settlement_finance_test (both directions).
--
--  Partial payments fall out naturally: every view sums the records, so two
--  half payments read the same as one full payment and `outstanding` is simply
--  what remains.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The ledger is admin-written, party-readable ─────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.manual_payment_records
  FROM authenticated, anon;

DROP POLICY IF EXISTS manual_payment_records_party_read ON public.manual_payment_records;
CREATE POLICY manual_payment_records_party_read
  ON public.manual_payment_records FOR SELECT TO authenticated
  USING (
    --  Buyer principal sees the money they owe/paid, and only that direction.
    (direction = 'client_payment'
      AND public.nx_job_buyer_principal(job_id) = auth.uid())
    OR
    --  The engaged provider sees their own payouts, and only that direction.
    (direction = 'inspector_payout'
      AND EXISTS (SELECT 1 FROM public.jobs j
                   WHERE j.id = manual_payment_records.job_id
                     AND j.contractor_id = auth.uid()))
  );

COMMENT ON POLICY manual_payment_records_party_read ON public.manual_payment_records IS
  'Each party reads its OWN settlement direction only: buyers see client_payment, the engaged provider sees inspector_payout. Writes stay admin-only via admin_record_manual_payment().';

-- ── 2. Buyer-side settlement ───────────────────────────────────────────────
DROP VIEW IF EXISTS public.my_job_settlement_view CASCADE;
CREATE VIEW public.my_job_settlement_view
WITH (security_barrier = true) AS
SELECT
  j.id                          AS job_id,
  j.title,
  j.status                      AS job_status,
  j.created_at,
  j.client_price_cents          AS total_cents,
  COALESCE(c.settled_cents, 0)                AS paid_cents,
  COALESCE(c.pending_cents, 0)                AS pending_cents,
  GREATEST(j.client_price_cents
           - COALESCE(c.settled_cents, 0), 0)            AS outstanding_cents,
  CASE
    WHEN j.client_price_cents IS NULL OR j.client_price_cents = 0 THEN 'not_priced'
    WHEN COALESCE(c.settled_cents, 0) >= j.client_price_cents  THEN 'paid'
    WHEN COALESCE(c.pending_cents, 0)   > 0                      THEN 'awaiting_confirmation'
    WHEN COALESCE(c.settled_cents, 0) > 0                      THEN 'part_paid'
    ELSE 'payment_required'
  END                           AS settlement_status,
  c.last_payment_on
FROM public.jobs j
LEFT JOIN LATERAL (
  SELECT
    SUM(m.amount_cents) FILTER (WHERE m.status = 'paid_manually') AS settled_cents,
    SUM(m.amount_cents) FILTER (WHERE m.status = 'pending')   AS pending_cents,
    MAX(m.paid_on)      FILTER (WHERE m.status = 'paid_manually') AS last_payment_on
  FROM public.manual_payment_records m
  WHERE m.job_id = j.id AND m.direction = 'client_payment'
) c ON TRUE
WHERE public.nx_job_buyer_principal(j.id) = auth.uid()
   OR public.nx_is_admin();

COMMENT ON VIEW public.my_job_settlement_view IS
  'Buyer-side settlement per job: total, paid, pending confirmation, outstanding. Exposes NO payout and NO platform spread (GOLDEN_RULE_2).';

-- ── 3. Provider-side earnings ──────────────────────────────────────────────
DROP VIEW IF EXISTS public.my_earnings_view CASCADE;
CREATE VIEW public.my_earnings_view
WITH (security_barrier = true) AS
SELECT
  j.id                          AS job_id,
  j.title,
  j.status                      AS job_status,
  j.created_at,
  j.inspector_payout_cents      AS earned_cents,
  COALESCE(p.paid_cents, 0)                   AS paid_cents,
  COALESCE(p.pending_cents, 0)                AS pending_cents,
  GREATEST(j.inspector_payout_cents
           - COALESCE(p.paid_cents, 0), 0)                 AS due_cents,
  CASE
    WHEN j.inspector_payout_cents IS NULL OR j.inspector_payout_cents = 0 THEN 'not_set'
    WHEN COALESCE(p.paid_cents, 0) >= j.inspector_payout_cents THEN 'paid'
    WHEN COALESCE(p.pending_cents, 0) > 0                      THEN 'payout_scheduled'
    WHEN COALESCE(p.paid_cents, 0)   > 0                       THEN 'part_paid'
    WHEN j.status IN ('completed','delivered')                 THEN 'due'
    ELSE 'in_progress'
  END                           AS payout_status,
  p.last_payout_on
FROM public.jobs j
LEFT JOIN LATERAL (
  SELECT
    SUM(m.amount_cents) FILTER (WHERE m.status = 'paid_manually') AS paid_cents,
    SUM(m.amount_cents) FILTER (WHERE m.status = 'pending')   AS pending_cents,
    MAX(m.paid_on)      FILTER (WHERE m.status = 'paid_manually') AS last_payout_on
  FROM public.manual_payment_records m
  WHERE m.job_id = j.id AND m.direction = 'inspector_payout'
) p ON TRUE
WHERE j.contractor_id = auth.uid()
   OR public.nx_is_admin();

COMMENT ON VIEW public.my_earnings_view IS
  'Provider-side earnings per job: earned, paid, pending, due. Exposes NO buyer price and NO platform spread (GOLDEN_RULE_2).';

-- ── 4. The party's own settlement activity ─────────────────────────────────
DROP VIEW IF EXISTS public.my_settlement_activity CASCADE;
CREATE VIEW public.my_settlement_activity
WITH (security_barrier = true) AS
SELECT
  m.id, m.job_id, j.title AS job_title, m.direction,
  m.amount_cents, m.currency, m.method, m.reference,
  m.status, m.paid_on, m.recorded_at
FROM public.manual_payment_records m
JOIN public.jobs j ON j.id = m.job_id
WHERE public.nx_is_admin()
   OR (m.direction = 'client_payment'
       AND public.nx_job_buyer_principal(m.job_id) = auth.uid())
   OR (m.direction = 'inspector_payout' AND j.contractor_id = auth.uid());

COMMENT ON VIEW public.my_settlement_activity IS
  'Recent settlement activity, filtered by the ledger RLS: buyers see their payments, providers see their payouts, admins see both.';

GRANT SELECT ON public.my_job_settlement_view TO authenticated;
GRANT SELECT ON public.my_earnings_view       TO authenticated;
GRANT SELECT ON public.my_settlement_activity TO authenticated;

COMMIT;
