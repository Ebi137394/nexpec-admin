-- ════════════════════════════════════════════════════════════════════════════
--  20260801550000_restore_contact_form_anon_insert.sql
--
--  DEFECT D28 (P2): the PUBLIC CONTACT FORM was dead on Staging.
--
--  The RLS policy contact_submissions_anon_insert (20260801250000) still
--  exists, but the anon-grant lockdown sweep later revoked the table GRANT, so
--  every anonymous submit died at the grant layer:
--      42501 "Grant the required privileges … GRANT INSERT ON
--             public.contact_submissions TO …"
--  Reproduced live: the deployed /contact form surfaces its truthful
--  "Could not send" error and 0 rows exist. A policy without a grant is a wall.
--
--  The contact form is the platform's ONE legitimate anonymous write. Restore
--  the narrowest grant that makes the existing policy functional:
--    * INSERT on exactly the public-facing columns (not status/notes/ip),
--    * to anon AND authenticated (signed-in users use the same form),
--    * SELECT/UPDATE/DELETE stay revoked — submissions are admin-read-only.
--
--  Rollback: supabase/rollback/20260801550000_rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

GRANT INSERT (name, email, channel, message, user_agent)
  ON public.contact_submissions TO anon, authenticated;

-- No sequence grant needed: the PK is gen_random_uuid().
