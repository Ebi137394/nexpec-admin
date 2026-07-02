-- ============================================================================
--  20260801228000_revoke_accept_offer_self_assign.sql
--
--  RED TEAM P0 — broker-bypass self-assign via accept_offer().
--
--  public.accept_offer(p_application_id uuid) is SECURITY DEFINER with NO
--  authorization check and `GRANT ALL TO anon, authenticated`. Its body forces
--  `jobs.status='in_progress', hired_inspector_id = auth.uid()` for ANY caller
--  on ANY application id — i.e. any authenticated user can assign any job to
--  themselves, bypassing the admin broker entirely (and writing the deprecated
--  hired_inspector_id). Repo-wide search confirms ZERO app/web callers — the
--  canonical, authorized path is admin_dispatch_job (super_admin-gated,
--  FOR UPDATE, status precondition).
--
--  Fix: revoke EXECUTE from anon + authenticated + PUBLIC. service_role (none
--  calls it today) retains access. Left in place rather than DROP to avoid any
--  latent dependency error; a follow-up may DROP it once confirmed dead.
--
--  SAFE TO RE-RUN: idempotent REVOKE; transactional.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.accept_offer(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
