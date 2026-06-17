-- ════════════════════════════════════════════════════════════════════════════
--  20260706120000_global_search_contractor_id_fix.sql
--
--  HOTFIX: global_search referenced jobs.assigned_inspector_id, which does NOT
--  exist. The canonical "inspector assigned to a job" column is jobs.contractor_id
--  (set by the authorized dispatch path: UPDATE jobs SET contractor_id = ...).
--  This left the JOBS section of Cmd+K / mobile global search throwing at call
--  time. CREATE OR REPLACE with the correct column — body otherwise identical.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.global_search(
  p_query   text,
  p_limit   integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_query       tsquery;
  v_role        text;
  v_user        uuid := auth.uid();
  v_inspectors  jsonb := '[]'::jsonb;
  v_jobs        jsonb := '[]'::jsonb;
  v_scopes      jsonb := '[]'::jsonb;
  v_limit       integer := least(greatest(coalesce(p_limit, 8), 1), 24);
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN jsonb_build_object('query', coalesce(p_query, ''), 'results', '[]'::jsonb);
  END IF;

  v_query := websearch_to_tsquery('english', p_query);

  IF v_user IS NOT NULL THEN
    SELECT lower(role) INTO v_role FROM public.profiles WHERE id = v_user LIMIT 1;
  END IF;

  /* ─── 1) Inspectors ─────────────────────────────────────────────── */
  SELECT coalesce(jsonb_agg(row_to_jsonb(r) ORDER BY r.score DESC), '[]'::jsonb)
    INTO v_inspectors
  FROM (
    SELECT
      'inspector'::text                                    AS kind,
      i.id::text                                            AS id,
      coalesce(i.full_name, 'Inspector')                    AS title,
      coalesce(
        nullif(i.headline, ''),
        nullif(concat_ws(', ', i.location_city, i.location_province), ''),
        'Inspector profile'
      )                                                     AS subtitle,
      '/p/' || i.id::text                                  AS href,
      ts_rank(
        setweight(to_tsvector('english', coalesce(i.full_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(i.headline, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(i.bio, '')), 'C') ||
        setweight(to_tsvector('english', array_to_string(coalesce(i.specialty_slugs, '{}'), ' ')), 'B') ||
        setweight(to_tsvector('english', coalesce(i.location_city, '')), 'C'),
        v_query
      )                                                     AS score
    FROM public.inspectors_directory i
    WHERE
      to_tsvector('english',
        coalesce(i.full_name, '') || ' ' ||
        coalesce(i.headline, '') || ' ' ||
        coalesce(i.bio, '') || ' ' ||
        array_to_string(coalesce(i.specialty_slugs, '{}'), ' ') || ' ' ||
        coalesce(i.location_city, '')
      ) @@ v_query
    ORDER BY score DESC
    LIMIT v_limit
  ) r;

  /* ─── 2) Jobs ───────────────────────────────────────────────────── */
  IF v_user IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(row_to_jsonb(r) ORDER BY r.score DESC), '[]'::jsonb)
      INTO v_jobs
    FROM (
      SELECT
        'job'::text                                         AS kind,
        j.id::text                                          AS id,
        coalesce(j.title, 'Untitled job')                   AS title,
        coalesce(
          nullif(concat_ws(' · ',
            nullif(j.location_city, ''),
            nullif(j.status, ''),
            nullif(j.domain, '')
          ), ''),
          'Job'
        )                                                   AS subtitle,
        CASE
          WHEN v_role IN ('admin','super_admin','support') THEN '/admin/jobs?focus=' || j.id::text
          WHEN j.contractor_id = v_user                     THEN '/inspector/jobs/' || j.id::text
          WHEN j.client_id = v_user                          THEN '/client/jobs/' || j.id::text
          ELSE '/p/' || j.id::text
        END                                                 AS href,
        ts_rank(
          setweight(to_tsvector('english', coalesce(j.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(j.description, '')), 'B') ||
          setweight(to_tsvector('english', array_to_string(coalesce(j.specialty_slugs, '{}'), ' ')), 'B') ||
          setweight(to_tsvector('english', coalesce(j.location_city, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(j.domain, '')), 'C'),
          v_query
        )                                                   AS score
      FROM public.jobs j
      WHERE
        (
          v_role IN ('admin','super_admin','support')
          OR j.contractor_id = v_user
          OR j.client_id = v_user
        )
        AND j.deleted_at IS NULL
        AND to_tsvector('english',
          coalesce(j.title, '') || ' ' ||
          coalesce(j.description, '') || ' ' ||
          array_to_string(coalesce(j.specialty_slugs, '{}'), ' ') || ' ' ||
          coalesce(j.location_city, '') || ' ' ||
          coalesce(j.domain, '')
        ) @@ v_query
      ORDER BY score DESC
      LIMIT v_limit
    ) r;
  END IF;

  /* ─── 3) Scope templates ────────────────────────────────────────── */
  IF v_user IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(row_to_jsonb(r) ORDER BY r.score DESC), '[]'::jsonb)
      INTO v_scopes
    FROM (
      SELECT
        'scope_template'::text                              AS kind,
        t.id::text                                          AS id,
        coalesce(t.name, t.slug, 'Scope template')          AS title,
        coalesce(
          nullif(concat_ws(' · ',
            nullif(t.category, ''),
            nullif(t.domain, ''),
            t.requires_credential_tier::text
          ), ''),
          'Scope template'
        )                                                   AS subtitle,
        '/admin/scope-templates#' || t.slug                 AS href,
        ts_rank(
          setweight(to_tsvector('english', coalesce(t.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(t.description_md, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(t.category, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(t.slug, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(t.domain, '')), 'C'),
          v_query
        )                                                   AS score
      FROM public.inspection_scope_templates t
      WHERE t.is_active = true
        AND to_tsvector('english',
          coalesce(t.name, '') || ' ' ||
          coalesce(t.description_md, '') || ' ' ||
          coalesce(t.category, '') || ' ' ||
          coalesce(t.slug, '') || ' ' ||
          coalesce(t.domain, '')
        ) @@ v_query
      ORDER BY score DESC
      LIMIT v_limit
    ) r;
  END IF;

  RETURN jsonb_build_object(
    'query', trim(p_query),
    'results', jsonb_build_object(
      'inspectors', v_inspectors,
      'jobs',       v_jobs,
      'scopes',     v_scopes
    )
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.global_search(text, integer) TO anon, authenticated;

COMMIT;
