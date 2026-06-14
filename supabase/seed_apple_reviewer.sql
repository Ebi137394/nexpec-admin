-- ════════════════════════════════════════════════════════════════════════════
--  seed_apple_reviewer.sql — App Store reviewer demo account (Item 2)
--
--  SECURE BY DESIGN: this is a REAL Supabase auth user with a password, not a
--  hardcoded in-app bypass. Nothing ships in the binary; the reviewer signs in
--  through the normal email + password screen and gets a real, RLS-valid session
--  (so the client dashboard actually loads data). This is Apple's sanctioned
--  mechanism — credentials go in App Store Connect → App Review Information →
--  Sign-In Required.
--
--  ── RUN ORDER ───────────────────────────────────────────────────────────────
--  1) Create the auth user FIRST (handles GoTrue internals + email identity):
--       Supabase Dashboard → Authentication → Users → Add user
--         • Email:    apple_tester@nexpec.com
--         • Password: <a strong password — put the SAME one in App Store Connect>
--         • ✅ Auto Confirm User   (so no magic-link/OTP blocks the reviewer)
--  2) Run this script in the Supabase SQL editor (or `supabase db execute`).
--  3) In App Store Connect, enter apple_tester@nexpec.com + that password under
--     App Review Information → Sign-In Required.
--
--  Idempotent: safe to re-run. It never creates the auth user (do that in step 1)
--  and never stores a password. To rotate the password, change it in the
--  Dashboard + App Store Connect — no code or SQL change needed.
--
--  Teardown after approval (optional): delete the user in the Dashboard; the
--  profile + demo job cascade/clean up via the block at the bottom (commented).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Promote the reviewer to a confirmed CLIENT (authoritative) ────────────
do $$
declare
  v_uid uuid;
begin
  select id into v_uid
    from auth.users
   where lower(email) = 'apple_tester@nexpec.com'
   limit 1;

  if v_uid is null then
    raise exception
      'apple_tester@nexpec.com does not exist yet. Create it in Supabase Dashboard → Authentication → Users → Add user (tick Auto Confirm), then re-run this script.';
  end if;

  insert into public.profiles (id, email, role, full_name, is_verified, verification_status, status)
  values (v_uid, 'apple_tester@nexpec.com', 'client', 'Apple Reviewer', true, 'verified', 'active')
  on conflict (id) do update
    set role                = 'client',
        full_name           = 'Apple Reviewer',
        is_verified         = true,
        verification_status = 'verified',
        status              = 'active';

  raise notice 'Apple reviewer profile ready (client, confirmed): %', v_uid;
end $$;

-- ── 2. Seed ONE demo job so the client dashboard isn't empty (best-effort) ───
--   Wrapped so that if a future NOT-NULL column is added to public.jobs, the
--   reviewer profile (step 1) still succeeds — only the sample data is skipped.
--   Fixed id keeps re-runs idempotent. Generated columns are never written.
do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = 'apple_tester@nexpec.com' limit 1;
  if v_uid is null then
    return;
  end if;

  insert into public.jobs (
    id, title, description, location, client_id,
    status, moderation_status,
    budget_cents, client_price_cents,
    urgency, job_type
  ) values (
    '00000000-0000-4000-8000-000000000a11',
    'Demo: Pipeline UT Inspection (App Review)',
    'Sample job seeded for App Store review so the client dashboard shows representative data. Safe to delete after review.',
    'Houston, TX',
    v_uid,
    'open',
    'approved',
    250000,
    250000,
    'normal',
    'on_site'
  )
  on conflict (id) do update
    set client_id        = excluded.client_id,
        status           = excluded.status,
        moderation_status = excluded.moderation_status;

  raise notice 'Demo job seeded for reviewer dashboard.';
exception when others then
  raise notice 'Demo job skipped (non-fatal): %. Reviewer profile is still set.', sqlerrm;
end $$;

-- ── 3. Teardown (run AFTER approval if you want to remove the demo) ───────────
-- delete from public.jobs where id = '00000000-0000-4000-8000-000000000a11';
-- -- then delete the user in Dashboard → Authentication → Users.
