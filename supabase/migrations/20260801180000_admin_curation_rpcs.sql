-- ════════════════════════════════════════════════════════════════════════════
--  20260801180000_admin_curation_rpcs.sql   (Teaser Marketplace — Phase 3A)
--
--  Admin curation console backend. Two SECURITY DEFINER RPCs, both gated by
--  nx_is_admin():
--    • admin_list_listing_candidates() — every opted-in inspector + agency with
--      their eligibility + current featured state (admin sees real names; they
--      are the curator). The public feed only shows opt_in AND featured, so this
--      is the admin's "who's waiting / who's live" worklist.
--    • admin_set_listing_featured() — flip public_listing_featured on a profile
--      (inspector) or organization (agency).
--
--  anon gets NEITHER (admin-only). Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_listing_candidates()
RETURNS TABLE (
  target_id uuid,
  kind      text,
  name      text,
  handle    text,
  opted_in  boolean,
  featured  boolean,
  eligible  boolean,
  detail    text
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- individual inspectors who opted in
  SELECT
    p.id,
    'inspector'::text,
    COALESCE(NULLIF(p.full_name,''),
             NULLIF(TRIM(COALESCE(p.first_name,'')||' '||COALESCE(p.last_name,'')),''),
             'Inspector'),
    public.nx_handle(p.id),
    true,
    COALESCE(p.public_listing_featured,false),
    (p.verification_status='verified' AND p.status='active' AND p.deleted_at IS NULL),
    COALESCE(NULLIF(p.location_city,''),'—')
      || CASE WHEN array_length(p.specialty_slugs,1) > 0
              THEN ' · '||array_to_string(p.specialty_slugs[1:3],', ') ELSE '' END
  FROM public.profiles p
  WHERE p.role='inspector' AND COALESCE(p.public_listing_opt_in,false)=true

  UNION ALL
  -- agencies who opted in
  SELECT
    o.id,
    'agency'::text,
    COALESCE(NULLIF(o.name,''),'Agency'),
    public.nx_handle(o.id),
    true,
    COALESCE(o.public_listing_featured,false),
    (COALESCE(o.is_active,true) AND (
       SELECT count(*) FROM public.org_members m
         JOIN public.profiles pm ON pm.id=m.user_id
        WHERE m.org_id=o.id AND pm.role='inspector'
          AND pm.status='active' AND pm.deleted_at IS NULL) >= 2),
    (SELECT count(*)::text FROM public.org_members m
        JOIN public.profiles pm ON pm.id=m.user_id
       WHERE m.org_id=o.id AND pm.role='inspector'
         AND pm.status='active' AND pm.deleted_at IS NULL) || ' vetted member(s)'
  FROM public.organizations o
  WHERE o.kind='agency' AND COALESCE(o.public_listing_opt_in,false)=true

  ORDER BY featured DESC, eligible DESC, name;
END $fn$;

REVOKE ALL    ON FUNCTION public.admin_list_listing_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_listing_candidates() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_listing_featured(
  p_target_id uuid, p_kind text, p_featured boolean
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'inspector' THEN
    UPDATE public.profiles SET public_listing_featured = COALESCE(p_featured,false)
     WHERE id = p_target_id AND role='inspector';
  ELSIF p_kind = 'agency' THEN
    UPDATE public.organizations SET public_listing_featured = COALESCE(p_featured,false)
     WHERE id = p_target_id AND kind='agency';
  ELSE
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE='22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0, 'featured', COALESCE(p_featured,false));
END $fn$;

REVOKE ALL    ON FUNCTION public.admin_set_listing_featured(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_listing_featured(uuid,text,boolean) TO authenticated, service_role;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.admin_list_listing_candidates()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin_list_listing_candidates missing';
  END IF;
  IF to_regprocedure('public.admin_set_listing_featured(uuid,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin_set_listing_featured missing';
  END IF;
  IF has_function_privilege('anon','public.admin_list_listing_candidates()','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon must NOT have admin curation';
  END IF;
  RAISE NOTICE 'admin curation RPCs OK (admin-gated).';
END $$;

COMMIT;
