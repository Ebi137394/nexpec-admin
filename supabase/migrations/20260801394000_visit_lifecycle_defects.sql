-- ════════════════════════════════════════════════════════════════════════════
--  20260801394000_visit_lifecycle_defects.sql
--
--  Three real defects in the Phase 2A/2B visit lifecycle, found by an
--  independent review of 20260801384000 and verified by the lead against the
--  source before any fix was written. None is a redesign: the canonical visit
--  schema, the RPC signatures and the supersession model are all preserved.
--
--  ── DEFECT 1 (HIGH): nx_job_reschedule_visit COULD NEVER SUCCEED ───────────
--  job_visits_job_number_idx (384000:85) is an unconditional
--      UNIQUE (job_id, visit_number)
--  and nx_job_reschedule_visit (384000:391-402) INSERTs the replacement row
--  carrying v_old.visit_number *while the old row is still live*, only flipping
--  it to 'rescheduled' afterwards. Every call therefore raised 23505.
--
--  Making the index partial is NOT sufficient on its own. At INSERT time the
--  old row's status is still 'scheduled', so it is inside any
--  "WHERE status <> 'rescheduled'" predicate and the two rows still collide.
--  The write order has to change too. So both halves are applied here:
--     a) the index becomes partial, excluding superseded rows, so a job's
--        history can hold many rows per visit_number while at most one is live;
--     b) the function marks the old row superseded BEFORE inserting its
--        replacement. Same transaction, same outcome, no window.
--
--  CONSEQUENCE FOR THE TEST RECORD: multi_visit_test.sql V9/V10/V11 and
--  visit_schedule_conflict_test.sql W6 all call this RPC, so neither suite can
--  ever have run green. Both were committed as "self-tested" without the SQL
--  runtime having actually executed. Those suites are not modified here — they
--  should now pass unchanged, and that is the point of leaving them alone.
--
--  ── DEFECT 2 is NOT here ───────────────────────────────────────────────────
--  Cross-job visit_id injection into inspection_captures / inspection_items is
--  fixed by 20260801388000_visit_scoped_evidence.sql, which adds the
--  job-coherence triggers. Deliberately not duplicated.
--
--  ── DEFECT 3 (MEDIUM): CANCEL REWRITES SUPERSESSION HISTORY ────────────────
--  nx_job_cancel_visit (384000:430) guards
--      status NOT IN ('completed','cancelled')
--  omitting 'rescheduled'. Cancelling an already-superseded row flips it to
--  'cancelled'; nx_job_visits filters on status <> 'rescheduled', so the
--  superseded row RESURFACES beside the replacement that supersedes it — two
--  live rows sharing one visit_number, and a broken chain. 'rescheduled' is a
--  terminal state for the old row and must be treated as one.
--
--  ── DEFECT 4 (LOW): REMOVED CREW COUNTED AND CARRIED FORWARD ───────────────
--  nx_job_remove_inspector soft-deletes (sets job_inspectors.status), so the
--  ON DELETE CASCADE on job_visit_assignments never fires. Two consequences:
--  assigned_count (384000:244) counts removed crew, and the reschedule
--  carry-over (384000:405) copies removed crew onto the new visit. Both now
--  filter on active membership. Historical assignment rows are NOT deleted —
--  attribution of past work stays intact; they simply stop being counted as
--  current crew and stop propagating forward.
--
--  Active membership is 'assigned' or 'active'. 'completed', 'replaced' and
--  'removed' are not current crew. Taken from job_inspectors_status_check.
--
--  ── NOT CHANGED ────────────────────────────────────────────────────────────
--  No RPC signature, no table, no policy, no grant. Payment untouched: nothing
--  here reads or writes any money column, and jobs.contractor_id remains the
--  settlement anchor. Rescheduling and cancelling still move no money.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── DEFECT 1a: the uniqueness rule becomes "one LIVE row per visit_number" ──
DROP INDEX IF EXISTS public.job_visits_job_number_idx;
CREATE UNIQUE INDEX IF NOT EXISTS job_visits_job_number_live_idx
  ON public.job_visits (job_id, visit_number)
  WHERE status <> 'rescheduled';
COMMENT ON INDEX public.job_visits_job_number_live_idx IS
  'One LIVE visit per (job, visit_number). Superseded rows are excluded so a rescheduled visit can keep its number while its replacement takes it over. The predecessor of this index was unconditional, which made nx_job_reschedule_visit raise 23505 on every call.';

-- ── DEFECT 1b + 4: reschedule writes in the correct order, carries only crew ─
CREATE OR REPLACE FUNCTION public.nx_job_reschedule_visit(
  p_visit_id  uuid,
  p_new_start timestamptz,
  p_new_end   timestamptz DEFAULT NULL,
  p_reason    text        DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_old   RECORD;
  v_new   uuid;
BEGIN
  IF NOT public.is_admin(v_admin) THEN
    RAISE EXCEPTION 'only an administrator may reschedule a visit'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_old FROM public.job_visits WHERE id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit % not found', p_visit_id USING errcode = '23503';
  END IF;

  IF v_old.status IN ('completed','cancelled','rescheduled') THEN
    RAISE EXCEPTION 'visit % cannot be rescheduled from status %', p_visit_id, v_old.status
      USING errcode = '22023';
  END IF;

  -- ★ 394000 — ORDER IS LOAD-BEARING. The old row must leave the live set
  --   BEFORE its replacement claims the same visit_number, or the partial
  --   unique index rejects the insert exactly as the unconditional one did.
  --   Supersede, never delete: the schedule history stays legible.
  UPDATE public.job_visits SET status = 'rescheduled' WHERE id = p_visit_id;

  INSERT INTO public.job_visits
    (job_id, visit_number, title, visit_kind, status, scheduled_start,
     scheduled_end, timezone, recurrence_group_id, rescheduled_from_id,
     notes, created_by)
  VALUES (v_old.job_id, v_old.visit_number, v_old.title, v_old.visit_kind,
          'scheduled', p_new_start, p_new_end, v_old.timezone,
          v_old.recurrence_group_id, v_old.id,
          COALESCE(NULLIF(btrim(coalesce(p_reason,'')), ''), v_old.notes), v_admin)
  RETURNING id INTO v_new;

  -- Carry the crew across, so rescheduling does not silently unassign anyone —
  -- but ★ 394000 only ACTIVE crew. Removal is a soft delete, so the old
  -- assignment rows for removed inspectors still exist and were previously
  -- propagated forward, re-granting a removed inspector a live assignment.
  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  SELECT v_new, a.job_inspector_id, a.is_lead, v_admin
    FROM public.job_visit_assignments a
    JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
   WHERE a.visit_id = p_visit_id
     AND ji.status IN ('assigned','active');

  RETURN jsonb_build_object('ok', true, 'old_visit_id', p_visit_id, 'new_visit_id', v_new);
END;
$$;
ALTER FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

-- ── DEFECT 3: 'rescheduled' is terminal — cancelling it must not resurrect it ─
CREATE OR REPLACE FUNCTION public.nx_job_cancel_visit(
  p_visit_id uuid,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_n     int;
BEGIN
  IF NOT public.is_admin(v_admin) THEN
    RAISE EXCEPTION 'only an administrator may cancel a visit'
      USING errcode = '42501';
  END IF;

  -- ★ 394000 added 'rescheduled'. Without it, cancelling a superseded row set
  --   status='cancelled', which put it back inside nx_job_visits' filter
  --   (status <> 'rescheduled') alongside the replacement that superseded it:
  --   two live rows on one visit_number and a severed supersession chain.
  UPDATE public.job_visits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin,
         cancel_reason = NULLIF(btrim(coalesce(p_reason,'')), '')
   WHERE id = p_visit_id
     AND status NOT IN ('completed','cancelled','rescheduled');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'cancelled_visit_id', p_visit_id);
END;
$$;
ALTER FUNCTION public.nx_job_cancel_visit(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_cancel_visit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_cancel_visit(uuid, text) TO authenticated, service_role;

-- ── DEFECT 4: assigned_count reflects CURRENT crew ──────────────────────────
--  Only the count subquery changes. Column list, ordering, RLS-bearing filters,
--  the legacy synthetic fallback branch and the no-backfill guarantee are all
--  preserved verbatim from 384000.
DO $patch$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'nx_job_visits';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 384000 must apply before 394000 (nx_job_visits missing)';
  END IF;

  v_new := replace(
    v_src,
    '(SELECT count(*)::int FROM public.job_visit_assignments a
             WHERE a.visit_id = v.id)',
    '(SELECT count(*)::int FROM public.job_visit_assignments a
               JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
              WHERE a.visit_id = v.id AND ji.status IN (''assigned'',''active''))'
  );

  IF v_new = v_src THEN
    RAISE EXCEPTION 'SELFTEST: the assigned_count subquery in nx_job_visits did not match the expected 384000 text — refusing to patch a function whose shape changed underneath this migration';
  END IF;

  EXECUTE v_new;
END
$patch$;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='job_visits_job_number_live_idx') THEN
    RAISE EXCEPTION 'SELFTEST: the partial live-visit-number index is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname='public' AND indexname='job_visits_job_number_idx') THEN
    RAISE EXCEPTION 'SELFTEST: the unconditional visit_number index still exists — reschedule would still raise 23505';
  END IF;

  -- The reorder is the actual fix; assert it rather than trusting the rewrite.
  IF strpos(
       regexp_replace(pg_get_functiondef(
         'public.nx_job_reschedule_visit(uuid,timestamptz,timestamptz,text)'::regprocedure),
         '--[^\n]*', '', 'g'),
       'UPDATE public.job_visits SET status = ''rescheduled'''
     ) > strpos(
       regexp_replace(pg_get_functiondef(
         'public.nx_job_reschedule_visit(uuid,timestamptz,timestamptz,text)'::regprocedure),
         '--[^\n]*', '', 'g'),
       'INSERT INTO public.job_visits'
     ) THEN
    RAISE EXCEPTION 'SELFTEST: reschedule still inserts the replacement before superseding the original — 23505 would persist';
  END IF;

  IF strpos(
       regexp_replace(pg_get_functiondef(
         'public.nx_job_cancel_visit(uuid,text)'::regprocedure), '--[^\n]*', '', 'g'),
       '''completed'',''cancelled'',''rescheduled'''
     ) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the cancel guard does not treat rescheduled as terminal';
  END IF;

  IF strpos(
       regexp_replace(pg_get_functiondef('public.nx_job_visits(uuid)'::regprocedure),
         '--[^\n]*', '', 'g'),
       'ji.status IN (''assigned'',''active'')'
     ) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: assigned_count still counts removed crew';
  END IF;

  -- Nothing this migration must have disturbed.
  IF to_regprocedure('public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: the shared conflict predicate was disturbed';
  END IF;
END
$verify$;

COMMIT;
