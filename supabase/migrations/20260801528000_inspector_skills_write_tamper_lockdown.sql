-- ════════════════════════════════════════════════════════════════════════════
--  20260801528000_inspector_skills_write_tamper_lockdown.sql
--
--  P1 — any authenticated user could forge, rewrite or destroy ANY inspector's
--  declared skills.
--
--  ── THE DEFECT (reproduced against Staging, not inferred) ──────────────────
--  public.inspector_skills carried two duplicate legacy policies from the
--  remote baseline (00000000000000_remote_baseline.sql:29577 and :29589):
--
--      CREATE POLICY "Public access skills" ON public.inspector_skills USING (true);
--      CREATE POLICY "Public skills"        ON public.inspector_skills USING (true);
--
--  Neither names a command, so both default to FOR ALL. Neither names a role,
--  so both default to PUBLIC. Neither has a WITH CHECK, so for INSERT the
--  check degrades to the USING expression — `true`. And `authenticated` still
--  held INSERT/UPDATE/DELETE grants on the table (the 20260801442000 lockdown
--  wave deliberately revoked anon, not authenticated).
--
--  Permissive policies are OR-combined, so the correctly-scoped
--  `inspector_skills_admin_all` overlay added by 20260801146000 could not
--  narrow anything: `true OR nx_is_admin()` is `true`.
--
--  PROVEN AT RUNTIME on NEXPEC-Staging with three distinct real user JWTs:
--    • qa.client@   (role client)   INSERT a row with user_id = the INSPECTOR's
--                                   uid  -> 201 Created
--    • qa.supplier@ (role supplier) PATCH that row                -> 200 OK
--    • qa.supplier@ (role supplier) DELETE that row               -> 200 OK
--  A client forged an inspector's capability record and an unrelated supplier
--  then edited and deleted it. anon was correctly refused (42501) because it
--  holds no write grant — the hole was authenticated-only, which is why the
--  anon sweep suites never saw it.
--
--  ── WHY IT MATTERS ─────────────────────────────────────────────────────────
--  inspector_skills is an inspector's declared equipment/capability record. A
--  competitor could delete it, or inflate a rival's years_experience to make a
--  fraudulent claim traceable to them. It is a data-integrity and attribution
--  defect on a professional-credential surface.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Drop both unconditional policies and replace them with the ordinary shape
--  the rest of the schema uses:
--    • SELECT  — any signed-in user. This matches inspector_work_experience
--                (`insp_work_exp_public_read`, SELECT TO authenticated), the
--                closest analogue in the schema.
--    • INSERT/UPDATE/DELETE — the owning user only (`user_id = auth.uid()`).
--    • Admin/super_admin keep full access through the existing
--      `inspector_skills_admin_all` overlay; this migration does not touch it.
--
--  anon's SELECT grant is revoked to match the new read scope. Verified safe:
--  the table is referenced by ZERO lines of application code (apps/, packages/)
--  and holds 0 rows on Staging, so nothing reads it anonymously today.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • No other table, policy, grant, function or view.
--   • `authenticated`'s grants are left exactly as they are — the fix is at the
--     policy layer, where the defect was.
--   • No weakening anywhere: every path this migration changes ends up strictly
--     more restrictive than before.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- The two unconditional legacy policies. IF EXISTS so the migration is
-- idempotent and safe on a database where an earlier hand-repair removed them.
DROP POLICY IF EXISTS "Public access skills" ON public.inspector_skills;
DROP POLICY IF EXISTS "Public skills"        ON public.inspector_skills;

-- Read: any signed-in user. Skills carry no PII (category, brand, model,
-- years) but they are an attributable professional record, so anonymous read
-- is not reinstated.
DROP POLICY IF EXISTS inspector_skills_read ON public.inspector_skills;
CREATE POLICY inspector_skills_read
  ON public.inspector_skills
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: the owner only. user_id is nullable, and `NULL = auth.uid()` is NULL
-- rather than true, so an unowned row cannot be minted through this policy
-- either — which is the correct outcome.
DROP POLICY IF EXISTS inspector_skills_self_insert ON public.inspector_skills;
CREATE POLICY inspector_skills_self_insert
  ON public.inspector_skills
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS inspector_skills_self_update ON public.inspector_skills;
CREATE POLICY inspector_skills_self_update
  ON public.inspector_skills
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS inspector_skills_self_delete ON public.inspector_skills;
CREATE POLICY inspector_skills_self_delete
  ON public.inspector_skills
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Match the grant to the new read scope.
REVOKE SELECT ON public.inspector_skills FROM anon;

COMMIT;
