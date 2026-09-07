-- ════════════════════════════════════════════════════════════════════════════
--  20260801654000_admin_assisted_profile_and_documents.sql
--
--  Enables Admin-assisted profile completion for users who supply their
--  details by email, phone or Help & Support instead of through the app.
--
--  ── WHY ────────────────────────────────────────────────────────────────────
--  A real inspector (93858a9e…) uploaded a CV to Production and nothing else.
--  Admin had no way to enter the phone/location/title he sent by email, and no
--  way to attach a certificate he mailed in. Everything had to come from the
--  user's own device or it did not exist.
--
--  ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--   1. Provenance columns on public.inspector_documents so an Admin-uploaded
--      document is permanently distinguishable from one the user uploaded.
--      DEFAULT 'self' keeps every existing row truthful without a backfill.
--   2. A storage policy letting an Admin write into the inspector-docs bucket
--      on a user's behalf. Today `inspector_docs_insert_self` keys the path on
--      auth.uid(), so an Admin can only ever write into their OWN folder.
--   3. nx_admin_notify_profile_edit() — tells the user, in the canonical Help
--      & Support thread, that an Admin changed their profile.
--
--  ── SCOPE OF THE WIDENING (read this before approving) ─────────────────────
--  The ONLY new capability is: an admin may INSERT and UPDATE objects in the
--  `inspector-docs` bucket outside their own folder. That is strictly narrower
--  than what admins already hold — they already have SELECT on every object in
--  that bucket (inspector_docs_select_owner_admin), DELETE on every object
--  (inspector_docs_delete_self, which ORs in nx_is_admin()), and ALL on the
--  public.inspector_documents table itself (inspector_documents_owner_all).
--  An admin could already read and delete these files and rewrite their
--  metadata; they simply could not add one. No non-admin gains anything, no
--  existing policy is dropped or loosened, and no bucket becomes public.
--
--  ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--   • Does not touch RLS on profiles, certifications, or any other table.
--   • Does not let anyone mark a credential verified. Verification stays with
--     the existing credential-review path; the Admin profile editor is
--     explicitly barred from those columns in application code.
--   • Creates no second document system — provenance is columns on the
--     canonical table, not a parallel one.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Document provenance ─────────────────────────────────────────────────
-- Who physically performed the upload, and on whose behalf. inspector_id
-- remains the OWNER of the document and never changes.
ALTER TABLE public.inspector_documents
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS upload_source text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS upload_reason text;

-- Existing rows were all self-uploads; the DEFAULT already made them honest.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inspector_documents'::regclass
       AND conname  = 'inspector_documents_upload_source_check'
  ) THEN
    ALTER TABLE public.inspector_documents
      ADD CONSTRAINT inspector_documents_upload_source_check
      CHECK (upload_source IN ('self', 'admin_assisted'));
  END IF;
END $$;

COMMENT ON COLUMN public.inspector_documents.uploaded_by IS
  'Profile that performed the upload. Differs from inspector_id only for admin-assisted uploads.';
COMMENT ON COLUMN public.inspector_documents.upload_source IS
  'self = the owner uploaded it; admin_assisted = an admin uploaded it on their behalf.';

-- ── 2. Admin-assisted storage write ────────────────────────────────────────
-- Narrow: this bucket only, admins only. Owners keep writing through the
-- existing inspector_docs_insert_self policy, which is left untouched.
DROP POLICY IF EXISTS inspector_docs_insert_admin ON storage.objects;
CREATE POLICY inspector_docs_insert_admin
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspector-docs' AND public.nx_is_admin());

-- Needed so an admin can replace a mis-uploaded file (upsert) rather than
-- having to delete-then-insert, which would briefly orphan the metadata row.
DROP POLICY IF EXISTS inspector_docs_update_admin ON storage.objects;
CREATE POLICY inspector_docs_update_admin
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'inspector-docs' AND public.nx_is_admin())
  WITH CHECK (bucket_id = 'inspector-docs' AND public.nx_is_admin());

-- ── 3. Tell the user an admin edited their profile ─────────────────────────
-- Posts into the SAME canonical Help & Support thread onboarding uses, so the
-- user sees one continuous conversation rather than a second inbox.
CREATE OR REPLACE FUNCTION public.nx_admin_notify_profile_edit(
  p_user_id uuid,
  p_summary text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_conv uuid;
  v_body text;
BEGIN
  -- Only an admin may announce an admin edit. Without this the SECURITY
  -- DEFINER context would let any caller post a message that appears to come
  -- from NEXPEC support.
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'nx_admin_notify_profile_edit: admin only'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR coalesce(btrim(p_summary), '') = '' THEN
    RETURN false;
  END IF;

  v_conv := public.nx_help_support_thread(p_user_id);
  IF v_conv IS NULL THEN
    RETURN false;
  END IF;

  v_body := 'A member of the NEXPEC team updated your profile on your behalf: '
         || btrim(p_summary)
         || E'\n\nIf anything looks wrong, reply here and we will correct it.';

  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conv, NULL, v_body);

  -- 'system' is the established kind for admin→user messages; it is what
  -- admin_send_user_message and nx_send_profile_completion_nudge both use.
  PERFORM public.notify_safe(
    p_user_id,
    'system',
    'Your profile was updated',
    btrim(p_summary),
    '/profile',
    NULL
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nx_admin_notify_profile_edit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_admin_notify_profile_edit(uuid, text) TO authenticated;

COMMIT;
