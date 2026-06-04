-- ════════════════════════════════════════════════════════════════════════════
--  docs/ops/export-seed.sql   (SEED GENERATOR — run in the Dashboard, once)
--
--  Exports the reference/catalogue data of the two seeded ghost tables straight
--  from the live DB into a clean, IDEMPOTENT seed script:
--    • country_codes               (249 rows — ISO list + your region groupings)
--    • inspection_scope_templates  (60 rows — your compliance catalogue)
--
--  Why a generator (not a hand-written seed): these are YOUR live values; the
--  only accurate source is the database itself. Run this; it returns ONE cell
--  (`seed_sql`) containing the entire seed. Copy that cell (or Export → CSV) and
--  save it as  supabase/seed.sql  — Supabase auto-applies that file on
--  `supabase db reset`, so a fresh environment comes up fully populated.
--
--  Properties of the generated seed:
--    • UPSERT (ON CONFLICT … DO UPDATE) → safe to re-run on any environment.
--    • Preserves PKs (country_codes.code, scope_templates.id) so existing FK
--      references (jobs.job_country / jobs.scope_template_id / profiles.*) stay valid.
--    • created_by_admin_id / created_by are exported as NULL (the columns are
--      nullable, FK ON DELETE SET NULL) so the seed never fails on a fresh DB
--      whose profiles table doesn't yet contain the original prod authors.
--    • Enum columns are emitted with explicit ::public.<enum> casts.
-- ════════════════════════════════════════════════════════════════════════════

SELECT
  E'-- ════════════════════════════════════════════════════════════════════\n'
  || E'--  supabase/seed.sql — reference data for country_codes + scope templates\n'
  || E'--  Generated from live via docs/ops/export-seed.sql. Idempotent (UPSERT).\n'
  || E'-- ════════════════════════════════════════════════════════════════════\n'
  || E'BEGIN;\n\n'
  || E'-- ── country_codes (' || (SELECT count(*) FROM public.country_codes)::text || E' rows) ──\n'
  || COALESCE((
       SELECT string_agg(
         format(
           'INSERT INTO public.country_codes '
           || '(code,name,region_group,calling_code,region,is_active,created_at) '
           || 'VALUES (%L,%L,%L,%L,%L,%L,%L) '
           || 'ON CONFLICT (code) DO UPDATE SET '
           || 'name=EXCLUDED.name,region_group=EXCLUDED.region_group,'
           || 'calling_code=EXCLUDED.calling_code,region=EXCLUDED.region,'
           || 'is_active=EXCLUDED.is_active;',
           code, name, region_group, calling_code, region, is_active, created_at
         ), E'\n' ORDER BY code)
       FROM public.country_codes), '-- (no rows)')
  || E'\n\n-- ── inspection_scope_templates (' || (SELECT count(*) FROM public.inspection_scope_templates)::text || E' rows) ──\n'
  || COALESCE((
       SELECT string_agg(
         format(
           'INSERT INTO public.inspection_scope_templates '
           || '(id,slug,name,version,category,region,validity_months,base_price_cents,'
           || 'requires_credential_tier,description_md,is_active,domain,created_at,updated_at) '
           || 'VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L::public.cci_credential_tier,%L,%L,'
           || '%L::public.inspection_domain,%L,%L) '
           || 'ON CONFLICT (id) DO UPDATE SET '
           || 'slug=EXCLUDED.slug,name=EXCLUDED.name,version=EXCLUDED.version,'
           || 'category=EXCLUDED.category,region=EXCLUDED.region,'
           || 'validity_months=EXCLUDED.validity_months,base_price_cents=EXCLUDED.base_price_cents,'
           || 'requires_credential_tier=EXCLUDED.requires_credential_tier,'
           || 'description_md=EXCLUDED.description_md,is_active=EXCLUDED.is_active,'
           || 'domain=EXCLUDED.domain,updated_at=EXCLUDED.updated_at;',
           id, slug, name, version, category, region, validity_months, base_price_cents,
           requires_credential_tier::text, description_md, is_active, domain::text,
           created_at, updated_at
         ), E'\n' ORDER BY slug)
       FROM public.inspection_scope_templates), '-- (no rows)')
  || E'\n\nCOMMIT;\n'
  AS seed_sql;
