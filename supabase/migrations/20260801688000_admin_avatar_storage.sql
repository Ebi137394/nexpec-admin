-- ════════════════════════════════════════════════════════════════════════════
--  20260801688000_admin_avatar_storage.sql
--
--  An admin could not change a user's profile photo, and the failure was in
--  TWO places at once:
--
--   1. apps/web/src/lib/actions/uploadAvatar.ts resolves its target with
--      auth.getUser() and writes `.eq('id', user.id)`. It is a SELF-service
--      action. There was no admin equivalent, so an admin using it would have
--      replaced their OWN photo while believing they were fixing the user's.
--
--   2. Even with a correct action, Storage refused the write: the avatars
--      policies are all `(storage.foldername(name))[1] = auth.uid()::text`, so
--      an admin cannot create an object inside another user's folder.
--
--  This migration fixes (2). The action fixing (1) is a separate file.
--
--  ── SCOPE OF THE WIDENING ──────────────────────────────────────────────────
--  Admins gain INSERT / UPDATE / DELETE on the `avatars` bucket only, gated on
--  nx_is_admin(). This is narrow:
--    • the bucket is ALREADY world-readable (avatars_select_public has no
--      owner predicate), so no private data becomes reachable;
--    • admins already hold full read and write on public.profiles, which is
--      where avatar_url lives;
--    • every other bucket — resumes, certifications, inspector-docs,
--      compliance, client_documents — is untouched and stays private.
--  The owner-only policies are left exactly as they are, so a user's own
--  upload path is unchanged.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS avatars_admin_insert ON storage.objects;
CREATE POLICY avatars_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND public.nx_is_admin());

DROP POLICY IF EXISTS avatars_admin_update ON storage.objects;
CREATE POLICY avatars_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND public.nx_is_admin())
  WITH CHECK (bucket_id = 'avatars' AND public.nx_is_admin());

DROP POLICY IF EXISTS avatars_admin_delete ON storage.objects;
CREATE POLICY avatars_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.nx_is_admin());

COMMIT;
