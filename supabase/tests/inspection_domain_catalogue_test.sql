-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspection_domain_catalogue_test.sql
--
--  Regression guard for the empty-catalogue defect.
--
--  public.inspection_domains shipped EMPTY to Staging: the baseline creates
--  the table but every seeding INSERT lived in supabase/migrations_archive/,
--  which the active chain never runs. /admin/domains rendered its empty
--  state and every consumer surface (job creation, inspector onboarding,
--  browse filters, matching, Talent preferences, reporting) had nothing to
--  offer. Restored by 20260801498000_restore_inspection_domain_catalogue.sql.
--
--  Nothing here hard-codes a row count. The catalogue is asserted against the
--  public.inspection_domain ENUM, so adding a sixth domain does not require
--  editing this file — but shipping a sixth ENUM member WITHOUT its config
--  row fails immediately, which is precisely the half-added state that caused
--  this outage.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

select plan(8);

-- ── 1. the catalogue is not empty ───────────────────────────────────────────
select isnt(
  (select count(*)::int from public.inspection_domains),
  0,
  'inspection_domains is not empty — the archived-seed defect has not returned'
);

-- ── 2. ENUM and table agree, in BOTH directions ─────────────────────────────
--  This is the assertion that would have caught the original defect.
select is(
  (select count(*)::int
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid and t.typname = 'inspection_domain'
    where not exists (select 1 from public.inspection_domains d
                       where d.slug::text = e.enumlabel::text)),
  0,
  'every inspection_domain ENUM member has a config row — no half-added domain'
);

select is(
  (select count(*)::int from public.inspection_domains d
    where not exists (select 1 from pg_enum e
                      join pg_type t on t.oid = e.enumtypid
                       where t.typname = 'inspection_domain'
                         and e.enumlabel::text = d.slug::text)),
  0,
  'no config row references a slug the ENUM does not define'
);

-- ── 3. the five known domains are present by name ───────────────────────────
--  Named explicitly because "five rows exist" is weaker than "THESE five".
--  A truncated restore that seeded four placeholders would pass a count
--  check and fail here.
select is(
  (select array_agg(slug::text order by display_order)
     from public.inspection_domains),
  ARRAY['industrial_ndt','civil_construction','electrical',
        'mechanical_field','chemical_process'],
  'the canonical catalogue is present in launch order — including chemical_process, which the stale four-row UI text omitted'
);

-- ── 4. every domain can actually match an inspector ─────────────────────────
--  chemical_process originally shipped with an empty array, which yields a
--  domain that is visible but matches nobody.
select is(
  (select count(*)::int from public.inspection_domains
    where cardinality(default_specialty_groups) = 0),
  0,
  'no domain has an empty default_specialty_groups — each can map to inspectors'
);

-- ── 5. presentation fields are populated, not blank placeholders ────────────
select is(
  (select count(*)::int from public.inspection_domains
    where coalesce(trim(display_name), '') = ''
       or coalesce(trim(persona_label), '') = ''
       or coalesce(trim(short_pitch), '') = ''),
  0,
  'no domain carries a blank display_name, persona_label or short_pitch'
);

-- ── 6. at least one domain is consumable ────────────────────────────────────
--  A fully-populated table whose every row is gated is indistinguishable
--  from an empty one on consumer surfaces.
select ok(
  exists (select 1 from public.inspection_domains
           where is_launched and is_active),
  'at least one domain is launched AND active — consumer surfaces are non-empty'
);

-- ── 7. ordering is stable and unambiguous ───────────────────────────────────
select is(
  (select count(*)::int from (
     select display_order from public.inspection_domains
      group by display_order having count(*) > 1) dupes),
  0,
  'display_order is unique — the admin list has a deterministic order'
);

select * from finish();

rollback;
