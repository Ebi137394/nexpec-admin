-- ════════════════════════════════════════════════════════════════════════════
--  20260702120000_auth_recovery_codes.sql
--
--  Sprint 13.3 — Two-Factor Authentication (TOTP via Supabase Auth)
--
--  Supabase Auth ships TOTP enrollment + challenge + verify primitives
--  via supabase.auth.mfa.*. This migration adds the missing piece:
--  recovery codes.
--
--  WHY RECOVERY CODES
--  ──────────────────
--  When a user loses access to their authenticator app (phone wiped,
--  device lost), they need a way back into the account that does NOT
--  require an admin override. The industry-standard pattern is N
--  single-use recovery codes shown ONCE at enrollment time, then
--  stored only as hashes server-side.
--
--  SCHEMA
--  ──────
--  Single table: auth_recovery_codes (user_id, code_hash, used_at).
--  Code formats are kept opaque to the DB — the API accepts plaintext,
--  hashes it, and looks up by hash.
--
--  RPCS
--  ────
--    1. regenerate_recovery_codes()     → text[]   (10 plaintext codes,
--                                                   stored as hashes,
--                                                   invalidates prior set)
--    2. consume_recovery_code(p_code)   → boolean  (TRUE iff a matching
--                                                   unused row was marked
--                                                   used in this call)
--
--  Both RPCs are SECURITY DEFINER. Both check auth.uid() and operate
--  ONLY on the caller's own rows.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Ensure pgcrypto for digest() and gen_random_bytes(). Many NEXPEC
-- migrations already depend on it (gen_random_uuid), but be defensive.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_recovery_codes_hash_format
    CHECK (code_hash ~ '^[a-f0-9]{64}$')
);

-- Each (user_id, code_hash) is unique — a generated set should not
-- collide internally and a hash from a prior set is already invalidated
-- before we insert a new set.
CREATE UNIQUE INDEX IF NOT EXISTS auth_recovery_codes_user_hash_uq
  ON public.auth_recovery_codes (user_id, code_hash);

-- Partial index optimised for the consume path (which only looks at
-- unused rows for the caller).
CREATE INDEX IF NOT EXISTS auth_recovery_codes_user_unused_idx
  ON public.auth_recovery_codes (user_id)
  WHERE used_at IS NULL;

COMMENT ON TABLE public.auth_recovery_codes IS
  'One-time recovery codes for MFA-enabled users. Plaintext codes are '
  'never stored; only sha256 hex digests. Codes are shown ONCE at '
  'generation time then never again. Consume marks used_at; the row is '
  'kept for audit but never matches a subsequent consume call.';

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.auth_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Read own row (so a user can see "X codes remaining"). We never expose
-- code_hash to the client — the API layer projects only counts.
DROP POLICY IF EXISTS recovery_codes_self_read ON public.auth_recovery_codes;
CREATE POLICY recovery_codes_self_read
  ON public.auth_recovery_codes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT / UPDATE / DELETE happen exclusively through the SECURITY
-- DEFINER RPCs below. There is intentionally no direct-mutation policy.

-- ─── Helpers ─────────────────────────────────────────────────────────

-- Internal: hash a plaintext code consistently.
CREATE OR REPLACE FUNCTION public._recovery_code_hash(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex');
$$;

-- ─── RPC: regenerate ─────────────────────────────────────────────────
-- Invalidates any existing unused codes for the caller, generates 10
-- fresh codes, stores their hashes, and returns the plaintext codes
-- exactly once (this is the only path that ever exposes plaintext).
--
-- Code format: 8 base32 chars, displayed as XXXX-XXXX. Base32 alphabet
-- excludes 0/O/1/I/L so codes are unambiguous when transcribed.
CREATE OR REPLACE FUNCTION public.regenerate_recovery_codes()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  i int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Invalidate every prior unused code for this user. Old codes that
  -- were already consumed retain their used_at timestamps.
  UPDATE public.auth_recovery_codes
     SET used_at = now()
   WHERE user_id = v_user AND used_at IS NULL;

  FOR i IN 1..10 LOOP
    -- 8 base32 chars from 5 random bytes (5 bytes encodes to 8 chars).
    v_code := upper(encode(extensions.gen_random_bytes(5), 'base32'));
    v_code := substring(v_code from 1 for 4) || '-'
           || substring(v_code from 5 for 4);

    INSERT INTO public.auth_recovery_codes (user_id, code_hash)
      VALUES (v_user, public._recovery_code_hash(v_code))
      ON CONFLICT (user_id, code_hash) DO NOTHING;

    v_codes := array_append(v_codes, v_code);
  END LOOP;

  RETURN v_codes;
END;
$fn$;

COMMENT ON FUNCTION public.regenerate_recovery_codes IS
  'Invalidates the caller''s existing unused recovery codes, generates '
  '10 fresh codes, stores their sha256 hashes, and returns the plaintext '
  'codes exactly once. The plaintext is never persisted.';

GRANT EXECUTE ON FUNCTION public.regenerate_recovery_codes() TO authenticated;

-- ─── RPC: consume ────────────────────────────────────────────────────
-- Marks one matching unused row for the caller as used. Returns TRUE
-- iff a row was matched + updated. Constant-time in the database: even
-- if the caller has zero codes, the UPDATE evaluates the hash.
CREATE OR REPLACE FUNCTION public.consume_recovery_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.auth_recovery_codes
     SET used_at = now()
   WHERE user_id = v_user
     AND code_hash = public._recovery_code_hash(p_code)
     AND used_at IS NULL
   RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$fn$;

COMMENT ON FUNCTION public.consume_recovery_code(text) IS
  'Marks one matching unused recovery code for the caller as used. '
  'Returns TRUE iff a row was matched.';

GRANT EXECUTE ON FUNCTION public.consume_recovery_code(text) TO authenticated;

COMMIT;
