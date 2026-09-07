-- ════════════════════════════════════════════════════════════════════════════
--  20260801658000_unify_completeness_rule.sql
--
--  P1 — profile completeness was computed by TWO different rules in Production,
--  so the platform contradicted itself to the same user about the same account.
--
--  ── THE DEFECT (measured on Production, not inferred) ──────────────────────
--  For the real inspector 93858a9e-a16d-42ff-b0ef-ba36ebdc8cf0:
--
--    nx_role_missing_fields()     -> {phone, location, specialties}   (role-aware)
--    nx_profile_missing_fields()  -> {company_name, phone, location}  (role-BLIND)
--    nx_missing_fields_label()    -> "Company, Phone, Location"
--
--  nx_profile_missing_fields is the older rule: it asks EVERY account for
--  full_name / company_name / phone / location regardless of role. It therefore
--  demands a Company from an independent inspector, who by definition has none,
--  and never asks an inspector for a professional signal at all.
--
--  Because four separate consumers still read the old rule, the split was
--  user-visible in four places at once:
--
--    admin_list_incomplete_profiles   -> Admin "incomplete profiles" queue AND
--                                        the Telegram /pending queue
--    nx_missing_fields_label          -> Admin User Detail "Profile readiness"
--    nx_send_profile_completion_nudge -> the reminder emails we send users
--    tg_admin_status                  -> Telegram /status counts
--
--  So onboarding told this inspector "Missing: Phone, Location, Specialties"
--  while the Admin page told an operator "Missing: Company, Phone, Location".
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Redefine nx_profile_missing_fields as a thin delegation to the canonical
--  role-aware rule. Every consumer above becomes role-aware through this one
--  change, with no call-site edits, and there is exactly ONE definition of
--  "complete" left in the system.
--
--  Why replace rather than repoint each caller: a name that still exists and
--  still returns a plausible-looking answer is the thing that caused this bug.
--  Delegation removes the second rule outright instead of leaving it in place
--  for the next caller to find.
--
--  ── COMPLETENESS PERCENTAGE IS UNAFFECTED ──────────────────────────────────
--  admin_list_incomplete_profiles computes 100 - (n * 25), which assumes four
--  tracked fields. The canonical rule also yields exactly four for every
--  non-admin role:
--      common:                              full_name, phone, location   (3)
--      client/agency/enterprise/supplier:  + company_name                (4)
--      inspector/senior:                   + specialties                 (4)
--  admin/super_admin get 3, and that function already excludes those roles.
--  So the arithmetic stays correct and is left untouched.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • No table, policy, grant or trigger.
--   • Signature, return type, volatility (STABLE), SECURITY DEFINER and the
--     pinned search_path are all reproduced exactly, so CREATE OR REPLACE
--     preserves the existing EXECUTE grants (anon: no, authenticated: yes).
--   • nx_role_missing_fields itself is not modified.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_profile_missing_fields(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Single source of truth. See 20260801630000_role_aware_onboarding.sql.
  SELECT public.nx_role_missing_fields(p_user_id);
$$;

COMMENT ON FUNCTION public.nx_profile_missing_fields(uuid) IS
  'Deprecated name kept for existing callers. Delegates to '
  'nx_role_missing_fields, the one canonical role-aware completeness rule. '
  'Do not reintroduce independent completeness logic here.';

COMMIT;
