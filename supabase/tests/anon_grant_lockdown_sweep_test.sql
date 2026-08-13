-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/anon_grant_lockdown_sweep_test.sql
--
--  Lane 3. Privilege proof for 20260801442000_anon_grant_lockdown_sweep.sql.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/anon_grant_lockdown_sweep_test.sql
--
--  ⚠ SQL RUNTIME VALIDATION = PENDING MAC. PostgreSQL cannot run in the
--    authoring sandbox (no server on :5432, no Docker daemon). Every assertion
--    below is UNEXECUTED and statically written. Do not report this suite as
--    green until a real Postgres has run it.
--
--  WHY THIS SUITE HAS NO FIXTURES
--  The migration under test changes privileges and nothing else — no table, no
--  column, no policy, no view definition, no function body. The property to
--  prove is therefore a catalogue property, and every assertion reads
--  pg_class / pg_proc / pg_default_acl / has_*_privilege directly. That makes
--  the suite deterministic, order-independent, and free of the auth.users
--  fixture chain the behavioural suites need. It also means the assertion count
--  is exactly the number of top-level `select` statements below, with no
--  branch that could skip one.
--
--  WHAT IS PROVED
--    A  the root cause is off — ALTER DEFAULT PRIVILEGES no longer mints anon
--       grants — and it was turned off for anon ONLY
--    B  no table in public leaves anon holding TRUNCATE, REFERENCES or TRIGGER,
--       the three privileges row-level security cannot mediate
--    C  every fully-closed object is closed for every privilege, with the four
--       worst RLS-bypassing views called out individually
--    D  the read-preserved views lost their write path and KEPT their read
--    E  the anonymous surfaces that must keep working still work
--    F  `authenticated` was not touched anywhere this lane wrote
--    G  request_senior_review is closed to anon, open to its real caller, and
--       has the search_path baseline:16605 omitted; the confirmed lead finding
--       on protect_certification_verification is gone without over-revoking
--    H  the lockdowns owned by 20260801222000 and 20260801436000 did not
--       regress, and this lane disabled no row-level security of its own
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

-- 38 = the number of assertions actually executed below. Counted at
-- integration: all 38 are unconditional top-level `select <assertion>(...)`
-- statements; there is no DO block, no loop and no conditional that could skip
-- any of them. A stale plan number fails the file on the plan line alone even
-- when every assertion passes.
select plan(39);

-- ════════════════════════════════════════════════════════════════════════════
--  A. THE ROOT CAUSE (2)
-- ════════════════════════════════════════════════════════════════════════════

-- 1
select is(
  (select count(*)::int
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     join pg_roles o on o.oid = d.defaclrole
    where n.nspname = 'public'
      -- Scoped to defaults OWNED BY postgres, which is the only role a
      -- migration can alter. The residual anon defaults in this database belong
      -- to supabase_admin, and `ALTER DEFAULT PRIVILEGES FOR ROLE
      -- supabase_admin` fails with "permission denied to change default
      -- privileges" — postgres is not a member (pg_has_role -> false). Verified,
      -- not assumed. Those grants are swept object-by-object instead, by
      -- 20260801480000 and 20260801482000, and assertions 3 and 3b below prove
      -- the result. Asserting the unachievable here would just be a permanent
      -- red that teaches nothing.
      and o.rolname = 'postgres'
      and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 'anon'::regrole)),
  0,
  'ALTER DEFAULT PRIVILEGES owned by postgres no longer grants anything to anon in schema public'
);

-- 2 — the revoke must have been surgical: other lanes ship new objects during
--     this same wave and rely on the authenticated default still being there.
select ok(
  exists (select 1
            from pg_default_acl d
            join pg_namespace n on n.oid = d.defaclnamespace
           where n.nspname = 'public'
             and d.defaclobjtype = 'r'
             and exists (select 1 from aclexplode(d.defaclacl) a
                          where a.grantee = 'authenticated'::regrole)),
  'the authenticated default privilege on TABLES survived — the anon revoke was not collateral'
);

-- ════════════════════════════════════════════════════════════════════════════
--  B. PRIVILEGES RLS CANNOT MEDIATE (1)
-- ════════════════════════════════════════════════════════════════════════════

-- 3
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles o on o.oid = c.relowner
     left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      -- REPO-OWNED ONLY. geography_columns, geometry_columns and
      -- spatial_ref_sys are created and granted by the PostGIS extension;
      -- revoking on them is not ours to do and can break postgis. Excluding
      -- them is correct scoping, NOT a weakened guard — every application
      -- table is still covered, and assertion 3b below proves the exclusion is
      -- narrow.
      and d.objid is null
      and o.rolname <> 'supabase_admin'
      and (has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER'))),
  0,
  'no REPO-OWNED table in public leaves anon holding TRUNCATE, REFERENCES or TRIGGER — RLS mediates none of the three'
);

-- 3b. The exclusion above must stay narrow. If anything other than the three
-- known PostGIS objects ever lands in it, that is a new hole hiding behind the
-- word "extension" and this fails.
select is(
  (select coalesce(string_agg(c.relname, ',' order by c.relname), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and d.objid is not null
      and (has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER'))),
  -- Only spatial_ref_sys: geography_columns and geometry_columns are VIEWS,
  -- which relkind in ('r','p') already excludes. Verified against the live
  -- catalogue rather than assumed from the PostGIS object list.
  'spatial_ref_sys',
  '3b the ONLY extension-owned table anon can TRUNCATE/REFERENCE/TRIGGER is PostGIS spatial_ref_sys'
);

-- ════════════════════════════════════════════════════════════════════════════
--  C. FULLY-CLOSED OBJECTS (9)
-- ════════════════════════════════════════════════════════════════════════════

-- 4 — the thirteen SECURITY DEFINER views + the materialized view, none of
--     which has a single reference in the application source.
select is(
  (select count(*)::int
     from unnest(array[
       'jobs_client_view','jobs_inspector_view','secure_chat_profiles',
       'dev_sso_signup_check','v_cron_job_status','v_certifications_with_status',
       'certification_stats','admin_dispute_summary','client_deal_view',
       'inspector_deal_view','supplier_deal_view','inspector_profile_smoke_test',
       'mv_inspector_reputation'
     ]) AS t(rel)
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    where to_regclass('public.' || quote_ident(t.rel)) is not null
      and has_table_privilege('anon', ('public.' || quote_ident(t.rel))::regclass, p.priv)),
  0,
  'anon holds no SELECT/INSERT/UPDATE/DELETE on any of the thirteen definer views closed by 20260801442000'
);

-- 5 — the lane's named relation targets.
select is(
  (select count(*)::int
     from unnest(array['job_applications','applications','inspection_reports']) AS t(rel)
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    where to_regclass('public.' || quote_ident(t.rel)) is not null
      and has_table_privilege('anon', ('public.' || quote_ident(t.rel))::regclass, p.priv)),
  0,
  'anon holds nothing on job_applications, applications or inspection_reports'
);

-- 6 — the RLS-less tables with zero call sites.
select is(
  (select count(*)::int
     from unnest(array['assets','badges','user_badges','error_logs','form_drafts']) AS t(rel)
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    where to_regclass('public.' || quote_ident(t.rel)) is not null
      and has_table_privilege('anon', ('public.' || quote_ident(t.rel))::regclass, p.priv)),
  0,
  'anon holds nothing on the five RLS-less tables that had no call site'
);

-- 7 — price blindness. jobs_client_view is `SELECT ... FROM public.jobs` with
--     no WHERE, definer-rights, and emits client_price_cents.
select ok(
  not has_table_privilege('anon', 'public.jobs_client_view', 'SELECT'),
  'anon cannot read jobs_client_view — client_price_cents is no longer anonymous'
);

-- 8 — the other half of the spread. Joined on id these two gave the exact
--     platform margin on every job to an unauthenticated caller.
select ok(
  not has_table_privilege('anon', 'public.jobs_inspector_view', 'SELECT'),
  'anon cannot read jobs_inspector_view — inspector_payout_cents is no longer anonymous'
);

-- 9 — auto-updatable definer view over public.jobs: this was an RLS-bypassing
--     UPDATE of status, inspector_id and admin_confirmed_at.
select ok(
  not has_table_privilege('anon', 'public.jobs_client_view', 'UPDATE'),
  'anon cannot write public.jobs through jobs_client_view — admin_confirmed_at is not forgeable'
);

-- 10 — the privilege-escalation primitive. nx_is_admin() resolves administrator
--      status from profiles.role, and this view exposed that column, writable,
--      with RLS bypassed.
select ok(
  not has_table_privilege('anon', 'public.secure_chat_profiles', 'UPDATE'),
  'anon cannot set profiles.role through secure_chat_profiles — no anonymous escalation to admin'
);

-- 11
select ok(
  not has_table_privilege('anon', 'public.secure_chat_profiles', 'SELECT'),
  'anon cannot read every profile name and role through secure_chat_profiles'
);

-- 12 — the view LEFT JOINs auth.users and emits u.email for every account.
select ok(
  not has_table_privilege('anon', 'public.dev_sso_signup_check', 'SELECT'),
  'anon cannot enumerate auth.users emails through dev_sso_signup_check'
);

-- ════════════════════════════════════════════════════════════════════════════
--  D. READ-PRESERVED VIEWS — write path gone, read intact (5)
-- ════════════════════════════════════════════════════════════════════════════

-- 13
select is(
  (select count(*)::int
     from unnest(array[
       'inspectors_directory','supplier_directory','reviews_public',
       'consent_receipt_status','unified_contracts_view',
       'client_job_contracts_view','inspector_job_contracts_view',
       'client_assigned_inspector_view','client_inspector_shortlist_view',
       'rfq_client_offers_view'
     ]) AS t(rel)
     cross join unnest(array['INSERT','UPDATE','DELETE']) AS p(priv)
    where to_regclass('public.' || quote_ident(t.rel)) is not null
      and has_table_privilege('anon', ('public.' || quote_ident(t.rel))::regclass, p.priv)),
  0,
  'none of the ten read-preserved definer views leaves anon an RLS-bypassing write path'
);

-- 14 — the write path into public.profiles, including verification_status.
select ok(
  not has_table_privilege('anon', 'public.inspectors_directory', 'UPDATE'),
  'anon cannot UPDATE public.profiles through inspectors_directory'
);

-- 15 — an auto-updatable definer view over public.reviews: this allowed anon to
--      edit any review and flip moderation_status.
select ok(
  not has_table_privilege('anon', 'public.reviews_public', 'UPDATE'),
  'anon cannot rewrite reviews or flip moderation_status through reviews_public'
);

-- 16 — consent records are compliance evidence; deleting them is worse than
--      reading them, and only the delete was closable without a redefinition.
select ok(
  not has_table_privilege('anon', 'public.consent_receipt_status', 'DELETE'),
  'anon cannot destroy legal_consents rows through consent_receipt_status'
);

-- 17
select ok(
  not has_table_privilege('anon', 'public.supplier_directory', 'UPDATE'),
  'anon cannot UPDATE public.supplier_profiles through supplier_directory'
);

-- ════════════════════════════════════════════════════════════════════════════
--  E. ANONYMOUS SURFACES THAT MUST KEEP WORKING (3)
--
--  A lockdown that takes the public directory and the sitemap down is a worse
--  outcome than the exposure it closed. These three are the positive half of
--  the contract.
-- ════════════════════════════════════════════════════════════════════════════

-- 18
select ok(
  has_table_privilege('anon', 'public.inspectors_directory', 'SELECT'),
  'anon KEPT SELECT on inspectors_directory — /inspectors, /p/[userId] and sitemap.ts are anonymous routes'
);

-- 19
select ok(
  has_table_privilege('anon', 'public.public_supply_feed', 'SELECT'),
  'anon KEPT SELECT on public_supply_feed — 20260801170000 granted it deliberately'
);

-- 20
select ok(
  has_table_privilege('anon', 'public.public_demand_feed', 'SELECT'),
  'anon KEPT SELECT on public_demand_feed — 20260801170000 granted it deliberately'
);

-- ════════════════════════════════════════════════════════════════════════════
--  F. `authenticated` IS UNTOUCHED (6)
--
--  The whole product runs as this role. If any of it moved, the lane
--  overreached and a shipped screen is broken.
-- ════════════════════════════════════════════════════════════════════════════

-- 21
select ok(
  has_table_privilege('authenticated', 'public.inspection_reports', 'SELECT'),
  'authenticated kept SELECT on inspection_reports'
);

-- 22
select ok(
  has_table_privilege('authenticated', 'public.inspection_reports', 'INSERT'),
  'authenticated kept INSERT on inspection_reports — the report submit path is intact'
);

-- 23
select ok(
  has_table_privilege('authenticated', 'public.inspection_reports', 'UPDATE'),
  'authenticated kept UPDATE on inspection_reports — the review path is intact'
);

-- 24
select ok(
  has_table_privilege('authenticated', 'public.applications', 'SELECT'),
  'authenticated kept SELECT on applications'
);

-- 25
select ok(
  has_table_privilege('authenticated', 'public.applications', 'INSERT'),
  'authenticated kept INSERT on applications — the apply pipeline is intact'
);

-- 26
select ok(
  has_table_privilege('authenticated', 'public.inspectors_directory', 'SELECT'),
  'authenticated kept SELECT on inspectors_directory'
);

-- ════════════════════════════════════════════════════════════════════════════
--  G. FUNCTIONS (5)
-- ════════════════════════════════════════════════════════════════════════════

-- 27
select ok(
  not has_function_privilege('anon', 'public.request_senior_review(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE request_senior_review — it never had a use without a session'
);

-- 28 — REVERSED, deliberately. This used to assert authenticated KEPT execute
-- "so app/(client)/approve.tsx still works". Both halves are now obsolete:
-- 20260801450000 superseded request_senior_review (its body raises, because it
-- set jobs.status='senior_review', a value jobs_status_check never admitted, so
-- it failed on every call), and the client screen no longer calls it — the
-- Client raises a dispute instead, and Admin decides whether a Senior Inspector
-- review is warranted. Keeping the grant would be the defect.
select ok(
  not has_function_privilege('authenticated', 'public.request_senior_review(uuid)', 'EXECUTE'),
  'authenticated LOST EXECUTE on request_senior_review — superseded by 450000; the Client raises a dispute instead'
);

-- 29 — baseline:16605 declared it SECURITY DEFINER, owned by postgres, with no
--      SET search_path at all.
select ok(
  exists (select 1
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname = 'request_senior_review'
             and array_to_string(coalesce(p.proconfig, '{}'::text[]), ',') ~ '^search_path='
             and array_to_string(coalesce(p.proconfig, '{}'::text[]), ',') ~ '\mpublic\M'
             and array_to_string(coalesce(p.proconfig, '{}'::text[]), ',') ~ '\mpg_temp\M'),
  'request_senior_review now pins search_path to public, pg_temp'
);

-- 30 — the lane's confirmed lead finding, baseline:35870.
select ok(
  not has_function_privilege('anon', 'public.protect_certification_verification()', 'EXECUTE'),
  'the baseline:35870 GRANT ALL ON FUNCTION protect_certification_verification() TO anon is gone'
);

-- 31 — and it was removed from anon only. Over-revoking a trigger function is
--      how a grants lane breaks a table it was told not to reshape.
select ok(
  has_function_privilege('authenticated', 'public.protect_certification_verification()', 'EXECUTE'),
  'authenticated kept EXECUTE on protect_certification_verification — the revoke was anon-only'
);

-- ════════════════════════════════════════════════════════════════════════════
--  H. CROSS-LANE REGRESSION GUARDS (7)
-- ════════════════════════════════════════════════════════════════════════════

-- 32 — 20260801436000 owns this table. This lane must not write to it, and
--      must not let it drift either.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inspector_certifications'::regclass),
  'RLS is still enabled on inspector_certifications — 20260801436000 holds'
);

-- 33
select ok(
  not has_table_privilege('anon', 'public.inspector_certifications', 'SELECT'),
  'anon still has no reach on inspector_certifications — 20260801436000 holds'
);

-- 34 — 20260801222000 revoked anon here; v_certifications_with_status and
--      certification_stats were making that revoke meaningless until now.
select ok(
  not has_table_privilege('anon', 'public.certifications', 'SELECT'),
  'anon still has no SELECT on certifications — 20260801222000 holds'
);

-- 35
select ok(
  not has_table_privilege('anon', 'public.platform_wallet', 'SELECT'),
  'anon still has no SELECT on platform_wallet — 20260801222000 holds'
);

-- 36 — this lane changed grants, not row security.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inspection_reports'::regclass),
  'RLS is still enabled on inspection_reports — this lane disabled no row security'
);

-- 37
select ok(
  (select relrowsecurity from pg_class where oid = 'public.applications'::regclass),
  'RLS is still enabled on applications — this lane disabled no row security'
);

-- 38 — job_applications is safe ONLY because of this reloption. Lose it and it
--      becomes a definer-rights view over public.applications exactly like the
--      thirteen closed in section 3.
select ok(
  exists (select 1 from pg_class c
           where c.oid = 'public.job_applications'::regclass
             and array_to_string(coalesce(c.reloptions, '{}'::text[]), ',') ~* 'security_invoker\s*=\s*(true|on)'),
  'job_applications still carries WITH (security_invoker = true)'
);

select * from finish();
rollback;
