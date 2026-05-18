-- ════════════════════════════════════════════════════════════════════════════
--  20260512170000_push_tokens_table.sql
--  NEXPEC — PUSH-TOKENS-001
--
--  Creates the missing public.push_tokens table that the existing
--  hooks/usePushNotifications.ts saveTokenToDatabase() has been writing
--  to since before this conversation, but which was never migrated.
--
--  Why this strike is happening now:
--    Pre-NOTIF-DEEPLINK-001 (STRIKE 4 of the recent combined strike),
--    the usePushNotifications hook was defined but never invoked, so
--    the missing table never surfaced. STRIKE 4 mounted the hook from
--    app/_layout.tsx as the foundation for push deep-linking. On the
--    next sign-in, saveTokenToDatabase fired and Supabase's PostgREST
--    layer raised:
--      "Could not find the table 'public.push_tokens' in the schema cache"
--    LogBox surfaced this console.error to the user as a red modal on
--    every authenticated session — a P0 regression we caused.
--
--  Design (v1 — single device per user)
--  ────────────────────────────────────
--    The existing hook upserts with `onConflict: 'user_id'`, implying
--    one row per user. We mirror that constraint as a PRIMARY KEY on
--    user_id so the upsert's conflict target works without any client
--    code changes. Multi-device support is a future architectural
--    bump (composite unique on (user_id, token)) — out of scope here.
--
--    Columns: user_id (PK, FK→profiles), token, device_type, timestamps.
--
--  RLS
--  ───
--    Owner-only — each user reads/writes ONLY their own row. service_role
--    (Edge Functions) bypasses RLS as usual, so notify-job-event can
--    fan out to any user's token.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  user_id     uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  device_type text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_token_nonempty CHECK (length(trim(token)) > 0)
);

COMMENT ON TABLE public.push_tokens IS
  'PUSH-TOKENS-001: Canonical store for Expo push tokens. One row per user (PK is user_id) so the client-side upsert with onConflict=user_id resolves cleanly. RLS gates self-only reads/writes; service_role (Edge Functions) bypasses for cross-user fan-out.';

COMMENT ON COLUMN public.push_tokens.token IS
  'Expo push token (ExponentPushToken[…]). Rotates when the OS reinstalls or revokes the device — the next sign-in upserts the fresh value.';

COMMENT ON COLUMN public.push_tokens.device_type IS
  'Free-form device tag set by the client (ios / android / iOS (Simulator) / etc.). Used by ops for diagnosing platform-specific delivery issues — not authoritative.';

-- ─── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_select_self ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_insert_self ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_update_self ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_delete_self ON public.push_tokens;

CREATE POLICY push_tokens_select_self
  ON public.push_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY push_tokens_insert_self
  ON public.push_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_tokens_update_self
  ON public.push_tokens
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_tokens_delete_self
  ON public.push_tokens
  FOR DELETE
  USING (user_id = auth.uid());

-- ─── updated_at touch trigger ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._touch_updated_at_push_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_tokens_touch_updated_at ON public.push_tokens;
CREATE TRIGGER push_tokens_touch_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public._touch_updated_at_push_tokens();

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Table + PK + FK landed
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='push_tokens'
-- ORDER BY ordinal_position;
-- Expected: 5 rows — user_id (uuid, NO, NULL), token (text, NO, NULL),
--           device_type (text, YES, NULL), created_at (timestamptz, NO, now()),
--           updated_at (timestamptz, NO, now())

-- B. RLS enabled, 4 policies
-- SELECT relrowsecurity FROM pg_class WHERE relname='push_tokens';   -- t
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='push_tokens';
-- Expected: 4 policies — SELECT/INSERT/UPDATE/DELETE, all self-gated.

-- C. Round-trip end-to-end as the signed-in user
-- BEGIN;
--   INSERT INTO push_tokens (user_id, token, device_type)
--   VALUES (auth.uid(), 'ExponentPushToken[smoke]', 'ios (smoke)');
--   SELECT token FROM push_tokens WHERE user_id = auth.uid();   -- returns the row
-- ROLLBACK;


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback)
-- ────────────────────────────────────────────────────────────────────────────
--  BEGIN;
--    DROP TRIGGER IF EXISTS push_tokens_touch_updated_at ON public.push_tokens;
--    DROP FUNCTION IF EXISTS public._touch_updated_at_push_tokens();
--    DROP POLICY IF EXISTS push_tokens_delete_self ON public.push_tokens;
--    DROP POLICY IF EXISTS push_tokens_update_self ON public.push_tokens;
--    DROP POLICY IF EXISTS push_tokens_insert_self ON public.push_tokens;
--    DROP POLICY IF EXISTS push_tokens_select_self ON public.push_tokens;
--    DROP TABLE  IF EXISTS public.push_tokens;
--  COMMIT;
