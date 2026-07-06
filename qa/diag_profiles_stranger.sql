-- ════════════════════════════════════════════════════════════════════════════
--  qa/diag_profiles_stranger.sql
--
--  Disambiguates the TEST-4 "FAIL" from smoke_profiles_party_policy.sql:
--  did an unrelated user really read the inspector, or was the picked
--  "stranger" actually an admin / same-org / application-linked (all of which
--  ARE allowed to read under nx_can_read_profile)?
--
--  Part A: lists every SELECT policy on public.profiles + its USING expression.
--          A leftover permissive `true` / allow-all policy = the real leak.
--  Part B: for the SAME inspector, finds a stranger that is provably
--          NON-admin AND shares no job, org, or application, then tests the
--          read. 0 rows = policy is sound (TEST-4 was a false alarm from a
--          naive picker). 1 row = genuine over-permissive leak → fix needed.
--
--  Read-only; rolls back. Run in Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── PART A — every policy currently on public.profiles ──────────────────────
SELECT 'A. policy on profiles' AS section,
       policyname, cmd, permissive, roles::text,
       COALESCE(qual, '(none)') AS using_expr
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'profiles'
 ORDER BY cmd, policyname;

-- ── PART B — test a PROVABLY-unrelated non-admin against the same inspector ──
CREATE TEMP TABLE _diag (seq int, check_name text, result text) ON COMMIT DROP;

DO $diag$
DECLARE
  v_inspector uuid := '86b8447f-ad47-4d41-a38a-a4c4d4804a50';  -- from the smoke context row
  v_stranger  uuid;
  v_role      text;
  v_seen      int;
BEGIN
  -- Pick a stranger that is NOT admin and shares NO job, org, or application
  -- with the inspector — i.e. someone the policy MUST block.
  SELECT p.id, p.role INTO v_stranger, v_role
    FROM public.profiles p
   WHERE p.id <> v_inspector
     AND COALESCE(p.role,'') NOT IN ('admin','super_admin')
     AND NOT EXISTS (SELECT 1 FROM public.jobs j
                      WHERE p.id IN (j.client_id,j.agency_id,j.contractor_id)
                        AND v_inspector IN (j.client_id,j.agency_id,j.contractor_id))
     AND NOT EXISTS (SELECT 1 FROM public.org_members m1
                       JOIN public.org_members m2 ON m1.org_id = m2.org_id
                      WHERE m1.user_id = p.id AND m2.user_id = v_inspector)
     AND NOT EXISTS (SELECT 1 FROM public.applications a
                       JOIN public.jobs j ON j.id = a.job_id
                      WHERE (a.applicant_id = v_inspector AND p.id IN (j.client_id,j.agency_id))
                         OR (a.applicant_id = p.id AND v_inspector IN (j.client_id,j.agency_id)))
   LIMIT 1;

  IF v_stranger IS NULL THEN
    INSERT INTO _diag VALUES (1, 'clean stranger available?',
      'SKIP — no provably-unrelated non-admin user exists in this dataset. '
      'The TEST-4 read was almost certainly an admin or a related user. Seed a '
      'second unrelated non-admin account and re-run to confirm.');
    RETURN;
  END IF;

  INSERT INTO _diag VALUES (1, 'clean stranger picked',
    'id=' || v_stranger || ' role=' || COALESCE(v_role,'<null>'));

  -- Confirm the policy oracle itself says NO for this pair (runs as definer).
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_inspector;
  RESET ROLE;

  INSERT INTO _diag VALUES (2, 'clean stranger reads inspector',
    CASE WHEN v_seen = 0
         THEN 'PASS — 0 rows. Policy is SOUND; TEST-4 FAIL was a naive picker '
              '(it grabbed an admin/same-org/application-linked user, all allowed).'
         ELSE 'FAIL — ' || v_seen || ' row. GENUINE LEAK: a fully-unrelated '
              'non-admin read the profile. See Part A for the offending policy.' END);
END
$diag$;

SELECT check_name, result FROM _diag ORDER BY seq;

ROLLBACK;
