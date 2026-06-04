-- ════════════════════════════════════════════════════════════════════════════
--  docs/ops/ghost-ddl-introspection.sql   (UNIFIED — run once, capture all)
--
--  ZERO-TOOLING reconciliation for the four out-of-band "ghost" tables:
--    country_codes, organizations, inspection_scope_templates, report_templates
--
--  The Supabase SQL editor only returns the LAST statement's result, so this is a
--  SINGLE statement that emits ONE row / ONE column (`ghost_ddl_report`) of pretty
--  JSON with every check: columns, constraints (exact DDL), indexes (exact DDL),
--  RLS enabled-flags, RLS policies, triggers (exact DDL), and row counts.
--
--  Run it, click the single result cell to expand (or Export → JSON), and send
--  the whole blob back. From it we generate the exact reconciliation migration.
--  (Remove jsonb_pretty(...) if you'd rather copy compact one-line JSON.)
-- ════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'tables', to_jsonb(ARRAY['country_codes','organizations','inspection_scope_templates','report_templates']),

  'columns', (
    SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'pos', ordinal_position, 'column', column_name,
      'type', data_type, 'nullable', is_nullable, 'default', column_default)
      ORDER BY table_name, ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('country_codes','organizations','inspection_scope_templates','report_templates')
  ),

  'constraints', (
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.conrelid::regclass::text, 'name', c.conname,
      'type', c.contype, 'def', pg_get_constraintdef(c.oid))
      ORDER BY c.conrelid::regclass::text, c.conname)
    FROM pg_constraint c
    WHERE c.conrelid IN ('public.country_codes'::regclass, 'public.organizations'::regclass,
                         'public.inspection_scope_templates'::regclass, 'public.report_templates'::regclass)
  ),

  'indexes', (
    SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname, 'def', indexdef)
      ORDER BY tablename, indexname)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('country_codes','organizations','inspection_scope_templates','report_templates')
  ),

  'rls_enabled', (
    SELECT jsonb_agg(jsonb_build_object('table', relname,
      'rls_enabled', relrowsecurity, 'rls_forced', relforcerowsecurity) ORDER BY relname)
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('country_codes','organizations','inspection_scope_templates','report_templates')
  ),

  'rls_policies', (
    SELECT jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'cmd', cmd, 'permissive', permissive,
      'roles', roles::text, 'using', qual, 'with_check', with_check)
      ORDER BY tablename, policyname)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('country_codes','organizations','inspection_scope_templates','report_templates')
  ),

  'triggers', (
    SELECT jsonb_agg(jsonb_build_object('table', c.relname, 'name', t.tgname, 'def', pg_get_triggerdef(t.oid))
      ORDER BY c.relname, t.tgname)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('country_codes','organizations','inspection_scope_templates','report_templates')
  ),

  'row_counts', jsonb_build_object(
    'country_codes',              (SELECT count(*) FROM public.country_codes),
    'organizations',             (SELECT count(*) FROM public.organizations),
    'inspection_scope_templates',(SELECT count(*) FROM public.inspection_scope_templates),
    'report_templates',          (SELECT count(*) FROM public.report_templates)
  )
)) AS ghost_ddl_report;
