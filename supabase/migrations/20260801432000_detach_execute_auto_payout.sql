-- ════════════════════════════════════════════════════════════════════════════
--  20260801432000_detach_execute_auto_payout.sql
--
--  Lane C. The lane was expected to return this number unused — payout state
--  already has carriers and "payable" is derivable. Verification instead found
--  a live automatic-payout trigger, so the number is used after all.
--
--  ── THE FINDING ────────────────────────────────────────────────────────────
--  baseline:27790
--      CREATE OR REPLACE TRIGGER trigger_on_project_completion
--        AFTER UPDATE ON public.work_orders
--        FOR EACH ROW EXECUTE FUNCTION public.execute_auto_payout();
--
--  execute_auto_payout (baseline:8747) credits a wallet and writes a payout
--  transaction whenever work_orders.status becomes 'completed':
--
--      SELECT price INTO v_project_price FROM public.projects WHERE id = NEW.id;
--      UPDATE public.wallets SET balance = balance + v_project_price
--       WHERE user_id = NEW.inspector_id;
--      INSERT INTO public.transactions (user_id, project_id, amount, type)
--      VALUES (NEW.inspector_id, NEW.id, v_project_price, 'payout');
--
--  This is automatic settlement. It contradicts the standing prohibition that
--  payout is manual, and it survived 20260801372000 — that migration de-fanged
--  handle_job_completion / handle_job_cancellation and asserts no settlement
--  trigger is attached, but its check filters
--  `p.proname IN ('handle_job_completion','handle_job_cancellation')`
--  (372000:106) and never sees this one.
--
--  ── IT IS ALSO BROKEN, WHICH MAKES IT WORSE, NOT BETTER ────────────────────
--  It reads projects.price WHERE id = NEW.id — the WORK ORDER's id, matched
--  against projects.id. work_orders has its own price column, which it ignores.
--  For any work order whose id is not coincidentally a project id, the lookup
--  yields NULL, and then:
--
--      balance = balance + NULL  ->  balance becomes NULL
--
--  So the realistic outcome of this trigger firing is not an unauthorised
--  payout, it is a NULLed wallet balance plus a transactions row with a NULL
--  amount. A corruption path, not merely an authorisation one.
--
--  And it is SECURITY DEFINER with NO `SET search_path`. 20260801244000 names
--  it in a comment listing functions that "ship with NO" search_path (244000:10)
--  but never fixed it — grep for execute_auto_payout outside the baseline
--  returns that comment and nothing else.
--
--  ── WHY IT HAS NOT ALREADY HAPPENED ────────────────────────────────────────
--  work_orders is the legacy projects table (196000:12), RLS-locked at
--  196000:46-66, and has no application writer: no INSERT/UPDATE/UPSERT against
--  it exists anywhere in apps/web/src, src/, app/ or supabase/functions. It is
--  dormant — armed, functional, undocumented, and one legacy write away from
--  firing. Dormant is not safe; it is untested.
--
--  ── THE FIX, FOLLOWING THE 372000 PATTERN EXACTLY ──────────────────────────
--  Detach the trigger. PRESERVE the function, as 372000 preserved its pair —
--  this repository's convention is that legacy settlement code is made
--  unreachable, not deleted, so history and intent survive. Pin the missing
--  search_path so a preserved SECURITY DEFINER function is not an injection
--  surface while it sits there. Revoke it from every caller role.
--
--  Then EXTEND 372000's own self-test to cover it, so the next automatic payout
--  trigger cannot slip through the same name filter.
--
--  No wallet is read or written. No balance is repaired — if a legacy row was
--  already NULLed, that is a data question for Treasury with evidence, not
--  something to silently rewrite here. No behaviour changes for any live path,
--  because no live path writes work_orders.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Detach ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trigger_on_project_completion ON public.work_orders;

-- ── 2. Preserve, but make it inert and non-injectable ───────────────────────
--  Body unchanged on purpose: this migration removes reachability, it does not
--  rewrite legacy logic it cannot test. search_path is added because a
--  SECURITY DEFINER function with an unpinned search_path is a hazard even
--  when detached — anything that re-attaches or directly invokes it inherits
--  the caller's search_path.
ALTER FUNCTION public.execute_auto_payout() SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.execute_auto_payout() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.execute_auto_payout() IS
  'DEAD / DETACHED by 20260801432000. Legacy automatic payout: credited wallets.balance and wrote a type=''payout'' transaction when work_orders.status became ''completed''. Detached because payout at NEXPEC is MANUAL — no completion, report approval, visit or ITP event may settle money. It is also defective: it reads projects.price WHERE id = NEW.id (the work order''s id, ignoring work_orders.price), so the lookup normally yields NULL and `balance = balance + NULL` NULLs the wallet. Preserved rather than dropped, matching the 20260801372000 convention for legacy settlement code. Do NOT re-attach. Manual payout goes through admin_mark_payout_processed.';

-- ── 3. Close the gap in 372000's guard ──────────────────────────────────────
DO $selftest$
BEGIN
  -- Detached.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trigger_on_project_completion' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: trigger_on_project_completion is still attached — automatic payout remains live';
  END IF;

  -- Preserved, per the 372000 convention.
  IF to_regprocedure('public.execute_auto_payout()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: execute_auto_payout was dropped — this phase preserves legacy settlement code, it only makes it unreachable';
  END IF;

  -- No longer an injection surface.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'execute_auto_payout'
       AND p.proconfig IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: execute_auto_payout still has no pinned search_path';
  END IF;

  IF has_function_privilege('anon', 'public.execute_auto_payout()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.execute_auto_payout()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: execute_auto_payout is still executable by a client role';
  END IF;

  -- THE WIDENED GUARD. 372000:104-110 checks only the settlement pair by name,
  -- which is how this trigger survived it. Cover every known automatic-payout
  -- function, so the next one cannot slip past a name filter that never
  -- mentioned it.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE p.proname IN (
             'handle_job_completion',
             'handle_job_cancellation',
             'execute_auto_payout')
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: an automatic-settlement/payout trigger is attached — settlement and payout must stay manual';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
