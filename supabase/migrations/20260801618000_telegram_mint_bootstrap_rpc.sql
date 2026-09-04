-- ════════════════════════════════════════════════════════════════════════════
--  tg_mint_bootstrap() — the pairing-token mint, as a real RPC
--
--  WHY THIS EXISTS. telegram-setup.sh minted pairing tokens by piping raw
--  INSERT SQL through `supabase db query` in a throwaway workdir that it first
--  had to `init` and `link`. Both of those commands prompt, and the script ran
--  them with stdout AND stderr sent to /dev/null while stdin was still the
--  owner's terminal. The INSERT itself succeeded every time — three live
--  tokens were created — but the read-back that was supposed to confirm it
--  produced no output the script could match, so it reported a generic
--  failure and discarded three perfectly good tokens.
--
--  The token is now minted server-side in one atomic call. The script no
--  longer embeds SQL, no longer needs init/link, and cannot half-succeed.
--
--  Security properties, all enforced here rather than in shell:
--    · token is 24 CSPRNG bytes from pgcrypto (schema-qualified, so the
--      pinned search_path stays narrow), hex-encoded (48 chars, inside
--      Telegram's 64-char deep-link limit) — never generated in a shell var
--    · TTL is clamped server-side, so a caller cannot mint a long-lived token
--    · minting SUPERSEDES every older unconsumed token, so at most ONE live
--      pairing link can exist at a time
--    · it can only ever bind to the owner account (super_admin, else the
--      oldest admin) — a caller cannot choose whom to pair
--    · service_role only; anon and authenticated are revoked
--    · every mint writes an audit event, so a token cannot appear unlogged
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_mint_bootstrap(p_ttl_minutes integer DEFAULT 60)
RETURNS TABLE (token text, profile_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile uuid;
  v_token   text;
  v_exp     timestamptz;
  v_ttl     integer := COALESCE(p_ttl_minutes, 60);
  v_killed  integer;
BEGIN
  -- The caller does not get to choose who is paired.
  SELECT p.id INTO v_profile
    FROM public.profiles p
   WHERE p.role IN ('super_admin', 'admin')
   ORDER BY CASE WHEN p.role = 'super_admin' THEN 0 ELSE 1 END, p.created_at
   LIMIT 1;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'no super_admin or admin profile exists to pair with';
  END IF;

  -- Short-lived by contract, not by convention.
  IF v_ttl < 5    THEN v_ttl := 5;    END IF;
  IF v_ttl > 1440 THEN v_ttl := 1440; END IF;

  -- pgcrypto lives in the `extensions` schema. Qualify it explicitly rather
  -- than widening this function's pinned search_path, which would be a
  -- security regression in a SECURITY DEFINER function.
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_exp   := NOW() + make_interval(mins => v_ttl);

  -- At most one live pairing link at a time: minting a new one retires any
  -- older unconsumed token, so an abandoned link cannot stay tappable.
  -- Aliased because this function RETURNS TABLE (token, profile_id,
  -- expires_at): those OUT parameters are plpgsql variables that would
  -- otherwise shadow the identically-named columns in this predicate.
  UPDATE public.telegram_bootstrap b
     SET expires_at = NOW()
   WHERE b.consumed_at IS NULL AND b.expires_at > NOW();
  GET DIAGNOSTICS v_killed = ROW_COUNT;

  INSERT INTO public.telegram_bootstrap (token, profile_id, expires_at)
  VALUES (v_token, v_profile, v_exp);

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, summary, metadata)
  VALUES ('telegram.bootstrap_minted', 'warning', v_profile,
          'Telegram Admin Control Center', 'telegram_bootstrap', v_profile,
          'Single-use Telegram pairing token minted',
          jsonb_build_object('source', 'telegram_admin_control_center',
                             'ttl_minutes', v_ttl,
                             'superseded_unconsumed_tokens', v_killed,
                             'token_recorded', false));

  RETURN QUERY SELECT v_token, v_profile, v_exp;
END $$;

REVOKE ALL ON FUNCTION public.tg_mint_bootstrap(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_mint_bootstrap(integer) TO service_role;

COMMENT ON FUNCTION public.tg_mint_bootstrap(integer) IS
  'Mints ONE single-use, short-lived Telegram pairing token bound to the owner account, retiring any older unconsumed token. service_role only. The token value is returned to the caller but deliberately never written to audit metadata.';
