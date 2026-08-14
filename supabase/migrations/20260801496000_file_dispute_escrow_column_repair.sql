-- ════════════════════════════════════════════════════════════════════════════
--  20260801496000_file_dispute_escrow_column_repair.sql
--
--  P0 — public.file_dispute() cannot file a dispute. It writes two columns that
--  do not exist.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  file_dispute() ends with:
--
--      UPDATE public.jobs
--         SET escrow_paused        = true,
--             escrow_paused_reason = format('Dispute filed: %s', p_category)
--       WHERE id = p_job_id;
--
--  public.jobs has NEITHER column. Its escrow carrier is:
--
--      escrow_status text DEFAULT 'pending'
--      CHECK (escrow_status IN ('pending','funded','released','refunded','disputed'))
--
--  So every call raises 42703 (undefined_column) and the whole dispute filing
--  rolls back — the INSERT into job_disputes with it. Disputes could not be
--  filed at all.
--
--  Confirmed against the live 185-migration database:
--      information_schema.columns for public.jobs LIKE 'escrow%'  →  escrow_status
--      (no escrow_paused, no escrow_paused_reason, and no ALTER TABLE anywhere
--       in supabase/migrations ever adds them)
--
--  ── WHY IT WAS NEVER CAUGHT ────────────────────────────────────────────────
--  20260801368000 repaired this function's INSERT and added a self-test, but
--  that test asserts on the function's SOURCE TEXT:
--
--      IF position('escrow_paused' IN dfd) = 0 THEN … RAISE
--
--  which passes precisely BECAUSE the broken string is still there. It proves
--  the text was preserved, never that the column exists. A static guard cannot
--  see this; only executing the function can, and the payment domain being
--  frozen meant nothing executed it until dispute_integrity_repair_test.sql ran
--  on a real database.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Write the pause to the carrier that exists. 'disputed' is a first-class value
--  of the escrow_status CHECK — the schema already anticipated exactly this
--  state, so this is expressing the intended behaviour, not inventing one.
--
--  The reason text is NOT lost and does NOT need a new column: the job_disputes
--  row inserted immediately above already carries reason_category and reason,
--  which is the durable, queryable record. escrow_paused_reason would have been
--  a denormalised duplicate of it.
--
--  ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--   • It does NOT create jobs.escrow_paused. There is no repository evidence
--     that column ever existed — not in the baseline CREATE TABLE, not in any
--     ALTER. Adding it would invent schema to match stale code, and leave two
--     competing escrow carriers.
--   • It moves NO money. This is a protective pause, exactly as the baseline
--     comment says. No settlement, payout, refund or ledger row is touched.
--   • It changes no authorization: the caller checks above are untouched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $repair$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'file_dispute';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ORDERING: public.file_dispute() does not exist yet';
  END IF;

  -- Idempotent: if a previous run already repaired it, do nothing.
  IF position('escrow_paused' IN v_src) = 0 THEN
    RAISE NOTICE 'file_dispute already writes escrow_status; nothing to repair';
    RETURN;
  END IF;

  v_new := replace(
    v_src,
    E'SET escrow_paused        = true,\n           escrow_paused_reason = format(\'Dispute filed: %s\', p_category)',
    E'SET escrow_status = \'disputed\''
  );

  -- If the exact shape moved, do not guess — a blind rewrite of a dispute
  -- function is worse than a loud failure.
  IF v_new = v_src THEN
    v_new := regexp_replace(
      v_src,
      'SET\s+escrow_paused\s*=\s*true\s*,\s*escrow_paused_reason\s*=\s*format\([^)]*\)',
      'SET escrow_status = ''disputed''',
      'g'
    );
  END IF;

  IF v_new = v_src OR position('escrow_paused' IN v_new) > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: could not rewrite the escrow pause in file_dispute — its shape changed; refusing to guess at a dispute function';
  END IF;

  EXECUTE v_new;
END
$repair$;

COMMENT ON FUNCTION public.file_dispute(uuid, text, text) IS
  'Files a JOB dispute into public.job_disputes and pauses escrow by setting jobs.escrow_status = ''disputed''. Repaired by 20260801496000: it previously wrote jobs.escrow_paused / escrow_paused_reason, neither of which exists on public.jobs, so every call raised 42703 and no dispute could be filed at all. ''disputed'' is a first-class value of the escrow_status CHECK. The reason lives on the job_disputes row (reason_category, reason) — it is not duplicated onto jobs. A pause, never a payment: no settlement, payout or refund is performed here.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_src text := pg_get_functiondef('public.file_dispute(uuid,text,text)'::regprocedure);
BEGIN
  -- The defect itself: the function must no longer name a column that does not exist.
  IF position('escrow_paused' IN v_src) > 0 THEN
    RAISE EXCEPTION 'SELFTEST: file_dispute still writes escrow_paused, a column public.jobs does not have';
  END IF;

  -- And it must write the carrier that DOES exist.
  IF position('escrow_status' IN v_src) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: file_dispute no longer pauses escrow at all — the protective pause was lost, not repaired';
  END IF;

  -- ★ The assertion 368000 should have made: prove the COLUMN exists, not that
  --   a string appears in the source. This is the check that would have caught
  --   the original defect.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='jobs' AND column_name='escrow_status'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: public.jobs has no escrow_status column — the repaired function would fail exactly as the old one did';
  END IF;

  -- 'disputed' must be permitted by the CHECK, or the repair swaps 42703 for 23514.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.jobs'::regclass
       AND pg_get_constraintdef(oid) LIKE '%escrow_status%'
       AND pg_get_constraintdef(oid) LIKE '%disputed%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: the escrow_status CHECK does not admit ''disputed'' — the pause would be rejected';
  END IF;

  -- The dispute record itself must still be written; the pause is secondary.
  IF position('job_disputes' IN v_src) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: file_dispute no longer records the dispute in job_disputes';
  END IF;

  -- Still a pause, never a payment.
  IF v_src ~* '\m(wallets|transactions|payout|settle_|credit_inspector|process_withdrawal)\M' THEN
    RAISE EXCEPTION 'SELFTEST: file_dispute names a money surface — filing a dispute must move no money';
  END IF;

  RAISE NOTICE 'file_dispute repaired: pauses escrow via escrow_status = disputed; dispute record intact; no money touched.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
