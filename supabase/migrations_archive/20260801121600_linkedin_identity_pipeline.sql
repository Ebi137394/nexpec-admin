-- ════════════════════════════════════════════════════════════════════════════
--  20260801121600_linkedin_identity_pipeline.sql
--
--  LINKEDIN SSO — the identity HYDRATION sink, decoupled from any one provider.
--
--  Supabase already materialises the session + identity for `linkedin_oidc`
--  (OAuth). This layer is the part that funnels professional claims into our
--  schema: hydrate_identity() fills profile BLANKS (never clobbers user edits,
--  never sets role from claims) and records the link. The same function is the
--  sink for CV-import / manual enrichment later — so LinkedIn's restrictive
--  OIDC scopes can never bottleneck us.
--
--  Security: the caller is already authenticated as auth.uid(); we only enrich
--  THAT profile. We never merge accounts by email (Supabase owns identity), and
--  an existing link can never be re-pointed to a different user.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.identity_links (
  provider   text NOT NULL,                 -- 'linkedin_oidc' | 'google' | 'apple' | 'cv_import' | 'manual'
  subject    text NOT NULL,                 -- provider 'sub'
  actor_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  claims     jsonb NOT NULL DEFAULT '{}',   -- raw claims kept for re-hydration
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identity_links_actor_idx ON public.identity_links (actor_id);

ALTER TABLE public.identity_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_self ON public.identity_links;
CREATE POLICY identity_self ON public.identity_links FOR SELECT USING (actor_id = auth.uid() OR public.nx_is_admin());
-- writes happen only through the SECURITY DEFINER RPC below.

CREATE OR REPLACE FUNCTION public.hydrate_identity(p_provider text, p_claims jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_sub    text := coalesce(p_claims->>'sub', p_claims->>'provider_id', p_claims->>'id');
  v_name   text := coalesce(nullif(p_claims->>'name',''),
                            nullif(trim(coalesce(p_claims->>'given_name','') || ' ' || coalesce(p_claims->>'family_name','')),''));
  v_avatar text := coalesce(p_claims->>'picture', p_claims->>'avatar_url');
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF coalesce(p_provider,'') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'provider_required'); END IF;

  -- Fill ONLY blanks on the caller's own profile. Never overwrite user edits;
  -- never derive role/privileges from untrusted claims.
  UPDATE public.profiles p SET
    full_name  = CASE WHEN coalesce(p.full_name,'')  = '' THEN v_name   ELSE p.full_name  END,
    avatar_url = CASE WHEN coalesce(p.avatar_url,'') = '' THEN v_avatar ELSE p.avatar_url END
  WHERE p.id = v_uid;

  -- Record the identity link idempotently. The WHERE on the conflict path means
  -- a link already owned by ANOTHER user can never be hijacked/re-pointed.
  IF v_sub IS NOT NULL THEN
    INSERT INTO public.identity_links (provider, subject, actor_id, claims)
    VALUES (p_provider, v_sub, v_uid, coalesce(p_claims,'{}'))
    ON CONFLICT (provider, subject) DO UPDATE
      SET claims = EXCLUDED.claims, updated_at = now()
      WHERE public.identity_links.actor_id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'linked', v_sub IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.hydrate_identity(text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.hydrate_identity(text,jsonb) TO authenticated;
GRANT SELECT ON public.identity_links TO authenticated;

-- self-test: the RPC must refuse to act without a session.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.hydrate_identity('linkedin_oidc', '{"sub":"selftest","name":"Test User"}'::jsonb);
  IF (r->>'ok') <> 'false' THEN
    RAISE EXCEPTION 'SELFTEST hydrate_identity should return not_authenticated in migration context: %', r;
  END IF;
  RAISE NOTICE 'LinkedIn identity pipeline self-test passed (auth-guarded).';
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- CONFIG (one-time, Supabase Dashboard → Auth → Providers):
--   Enable "LinkedIn (OIDC)"; set Client ID + Secret; add redirect URLs.
-- CLIENT: the LinkedIn button calls signInWithLinkedIn() (src/lib/social-auth.ts),
--   which after a session calls supabase.rpc('hydrate_identity', { p_provider:'linkedin_oidc',
--   p_claims: user.user_metadata }). Default role stays user-chosen via choose-role.
-- ─────────────────────────────────────────────────────────────────────────
