-- ════════════════════════════════════════════════════════════════════════════
--  20260801572000_fix_bridge_invitation_search_path.sql
--
--  P1 — the Coordination Bridge vendor INVITATION could never be sent.
--
--  ── ROOT CAUSE (reproduced on Staging, exact) ──────────────────────────────
--  bridge_send_invitation() hashes the presented raw token with pgcrypto's
--  digest() to locate the bridge. pgcrypto is installed in the `extensions`
--  schema. Every sibling in this family carries
--      search_path = public, extensions, pg_temp
--  but bridge_send_invitation was created with
--      search_path = public, pg_temp
--  so digest() is unresolvable inside it and EVERY call fails with:
--      ERROR 42883: function digest(text, unknown) does not exist
--
--  The invitation is the entry point of the entire no-NEXPEC-account vendor
--  flow (email → magic-link portal), so that whole lane was dead on arrival —
--  consistent with Staging holding zero bridges and zero vendor contacts.
--  Nothing downstream was broken: token issue, resolve, schedule, documents,
--  rotation and isolation all verified working once a bridge exists.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Set the same search_path the rest of the family already uses. The function
--  BODY is not touched, so there is no behavioural change beyond the call
--  becoming resolvable. SECURITY DEFINER search_path stays fully qualified and
--  pinned (no user-controlled schema), preserving the hardening intent of
--  20260801244000.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER FUNCTION public.bridge_send_invitation(uuid, text, text)
  SET search_path = public, extensions, pg_temp;

DO $selftest$
DECLARE v_cfg text;
BEGIN
  SELECT array_to_string(p.proconfig, ',') INTO v_cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'bridge_send_invitation';

  IF v_cfg IS NULL OR v_cfg NOT LIKE '%extensions%' THEN
    RAISE EXCEPTION 'SELFTEST: bridge_send_invitation still cannot resolve pgcrypto (search_path=%)', coalesce(v_cfg,'<none>');
  END IF;
  IF v_cfg NOT LIKE '%pg_temp%' THEN
    RAISE EXCEPTION 'SELFTEST: pg_temp pinning was lost from the search_path';
  END IF;

  -- The whole family must now agree, so this cannot silently drift again.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('bridge_create','bridge_rotate_token',
                         'bridge_vendor_resolve_token','bridge_send_invitation')
       AND (p.proconfig IS NULL
            OR array_to_string(p.proconfig, ',') NOT LIKE '%extensions%')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a token-hashing bridge function still lacks the extensions schema';
  END IF;

  RAISE NOTICE 'SELFTEST ok — bridge_send_invitation can resolve pgcrypto digest(); family search_paths agree';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
