-- ════════════════════════════════════════════════════════════════════════════
--  20260801428000_retire_client_invoiced_at.sql
--
--  Lane A, and the only real finding in it.
--
--  Every other lifecycle timestamp on jobs has a canonical writer — started_at
--  (inspector_start_job, `started_at = COALESCE(started_at, now())`),
--  contract_generated_at, moderation_reviewed_at, admin_confirmed_at,
--  client_settled_at, payout_paid_at, cancelled_at, and job_inspectors.
--  assigned_at (NOT NULL DEFAULT now(), 376000:50).
--
--  jobs.client_invoiced_at has none. It has exactly three occurrences in the
--  whole migration tree:
--
--      baseline:3719   the column definition
--      294000:88       an entry in an audit redaction list
--      422000:43       a comment I wrote explaining why the funding gate
--                      could NOT use it
--
--  Nothing has ever written it. It is a column shaped like net-terms invoicing
--  state that has never held any, and it already cost one real decision: it was
--  the obvious signal for the net_terms half of the dispatch funding gate, and
--  gating on it would have blocked every net_terms job forever. The gate uses
--  profiles.client_credit_limit_cents instead.
--
--  ── WHY COMMENT AND NOT DROP ───────────────────────────────────────────────
--  DROP is destructive and this repository has a documented history of SQL
--  applied by hand outside supabase/migrations (50+ loose root-level .sql
--  files, and stripe_complete_job was one of them). A column unwritten by any
--  migration may still hold rows written by a script nobody committed.
--  Retiring it in the catalogue is reversible and costs nothing; dropping it is
--  neither.
--
--  ── WHY NOT ADD A WRITER INSTEAD ───────────────────────────────────────────
--  Because there is no invoicing event to write from. net_terms authorisation
--  is a credit-limit fact about the buyer, not a per-job invoice timestamp. If
--  NEXPEC later issues real invoices per job, THAT feature writes this column
--  and deletes this comment — the column is left in place precisely so that
--  remains possible.
--
--  ── DELIBERATELY NOT DONE ──────────────────────────────────────────────────
--  No jobs.assigned_at is added. Dispatch time is already recoverable from
--  canonical events — job_events.event_type includes 'contractor_assigned' —
--  and job_inspectors.assigned_at covers teams. The standing instruction is not
--  to duplicate what canonical events already carry.
--
--  Catalogue metadata only. No column added, dropped or rewritten. No row
--  touched. No behaviour changes.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

COMMENT ON COLUMN public.jobs.client_invoiced_at IS
  'NOT AUTHORITATIVE — RETIRED BY 20260801428000. No code has ever written this column: as of that migration its only occurrences are its own definition, an audit redaction list entry, and a comment explaining why the dispatch funding gate could not use it. Do NOT read it as net-terms invoicing state and do NOT gate anything on it — 20260801422000 considered exactly that and rejected it, because gating on a column nothing writes blocks every net_terms job forever; the gate uses profiles.client_credit_limit_cents, which is the real credit authority ("0 = no credit (prepay only)"). Left in place rather than dropped because this repository has a history of SQL applied outside supabase/migrations, so unmigrated rows may exist. If per-job invoicing is ever built, that feature owns this column and removes this comment.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_writers int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'jobs'
       AND column_name = 'client_invoiced_at'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: jobs.client_invoiced_at is missing — this migration documents it, it must not have been dropped';
  END IF;

  -- The claim this migration rests on: nothing writes it. If a later function
  -- starts assigning it, that is a real feature and this comment is a lie —
  -- fail loudly so whoever added the writer must also update the comment.
  SELECT count(*)::int INTO v_writers
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~* 'client_invoiced_at\s*=\s*[^=]';

  IF v_writers > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % function(s) assign jobs.client_invoiced_at — it is no longer unwritten, so the RETIRED comment added here is wrong and must be replaced with the real semantics',
      v_writers;
  END IF;

  -- The funding gate must still be reading the credit limit, not this column.
  IF to_regprocedure('public.nx_guard_dispatch_requires_funding()') IS NOT NULL
     AND strpos(pg_get_functiondef('public.nx_guard_dispatch_requires_funding()'::regprocedure),
                'client_invoiced_at') > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: the dispatch funding gate references client_invoiced_at — a column nothing writes would block every net_terms job';
  END IF;
END
$selftest$;

COMMIT;
