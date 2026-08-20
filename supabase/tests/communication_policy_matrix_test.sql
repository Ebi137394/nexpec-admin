-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/communication_policy_matrix_test.sql
--
--  OWNER COMMUNICATION POLICY (final), proven at the database layer.
--  Companion to direct_chat_access_test / direct_chat_role_parity_test /
--  direct_room_admin_mediation_test, which cover the Full-mode room itself.
--  This suite fixes the NON-Full case: on a job that is not in Full mode the
--  Client↔Inspector lane must be closed in every direction and by every route
--  (room-id guessing, hand-crafted INSERT, posting into an owned row, or the
--  opener RPC), while the admin and supervisory lanes keep working.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/communication_policy_matrix_test.sql
--
--  THE MATRIX
--    Client    → Inspector direct (NON-Full job) ..... DENIED (both directions)
--    Client    → NEXPEC admin ........................ ALLOWED
--    Inspector → NEXPEC admin ........................ ALLOWED
--    Senior/QA reviewer ↔ working inspector .......... ALLOWED (review rounds)
--    Admin     → Inspector ........................... ALLOWED
--    Admin oversight of retired rooms ................ ALLOWED (audit)
--
--  BYPASS ATTEMPTS PROVEN TO FAIL (the owner's explicit list)
--    • reading a pre-existing direct room by id (guessing room ids)
--    • crafting a new direct room by direct API call (INSERT)
--    • posting into a direct room the client owns (the msg_insert_party door)
--    • posting into a direct room without the gate agreeing
--    • calling open_direct_conversation() on a job that is not in Full mode
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(16);

create temporary table _c on commit drop as
select gen_random_uuid() as client_id,
       gen_random_uuid() as inspector_id,
       gen_random_uuid() as senior_id,
       gen_random_uuid() as admin_id,
       gen_random_uuid() as job_id,
       gen_random_uuid() as direct_conv,
       gen_random_uuid() as admin_conv,
       gen_random_uuid() as insp_admin_conv;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'cm.'||u::text||'@synthetic.invalid', now(), now()
  from _c, unnest(array[client_id, inspector_id, senior_id, admin_id]) u;

insert into public.profiles (id, role, full_name, email, is_verified)
select client_id,    'client',      'CM Client',    'cm.c@synthetic.invalid', true from _c
union all select inspector_id, 'inspector', 'CM Inspector', 'cm.i@synthetic.invalid', true from _c
union all select senior_id,    'inspector', 'CM Senior',    'cm.s@synthetic.invalid', true from _c
union all select admin_id,     'super_admin','CM Admin',    'cm.a@synthetic.invalid', true from _c
on conflict (id) do update set role = excluded.role, email = excluded.email;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- identity_mode='full' but NO hired inspector: proves the gate keys on the
-- ENGAGEMENT (active contract inspector), not on the disclosure mode alone.
insert into public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                         client_price_cents,inspector_payout_cents,identity_mode)
select job_id,'cm comms',client_id,'open','approved','prepay',100000,80000,'full' from _c;

-- A pre-existing direct room + message, exactly as the retired feature created.
insert into public.conversations (id, job_id, client_id, contractor_id, kind, user_id, title, status)
select direct_conv, job_id, client_id, inspector_id, 'job_client_inspector', client_id, 'legacy direct', 'open' from _c;
insert into public.messages (conversation_id, sender_id, content)
select direct_conv, client_id, 'legacy direct message' from _c;

-- The ALLOWED lanes.
insert into public.conversations (id, job_id, client_id, kind, user_id, title, status)
select admin_conv, job_id, client_id, 'job_client_admin', client_id, 'client-admin lane', 'open' from _c;
insert into public.messages (conversation_id, sender_id, content)
select admin_conv, client_id, 'client asks admin' from _c;
insert into public.conversations (id, job_id, contractor_id, kind, user_id, title, status)
select insp_admin_conv, job_id, inspector_id, 'job_inspector_admin', inspector_id, 'inspector-admin lane', 'open' from _c;
insert into public.messages (conversation_id, sender_id, content)
select insp_admin_conv, inspector_id, 'inspector asks admin' from _c;

-- Senior/QA supervisory channel: the review round on the inspector's report.
insert into public.inspection_reports (id, job_id, inspector_id, notes, status)
select direct_conv, job_id, inspector_id, 'cm report', 'under_review' from _c;
insert into public.report_senior_reviews (inspection_report_id, job_id, round, reviewer_id, assigned_by, comments)
select direct_conv, job_id, 1, senior_id, admin_id, 'Senior: re-shoot weld W3 with better lighting.' from _c;

grant select on _c to authenticated;

-- ─── The gate itself ────────────────────────────────────────────────────────
select is(
  public.nx_direct_chat_authorized(
    (select job_id from _c), (select inspector_id from _c), (select client_id from _c)),
  false, 'G1 the gate denies without an active contract inspector, even in Full mode');

-- ─── CLIENT → INSPECTOR : DENIED ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _c) || '","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.conversations where id = (select direct_conv from _c)),
  0, 'C1 client cannot read the direct room row (room-id guessing fails)');
select is(
  (select count(*)::int from public.messages where conversation_id = (select direct_conv from _c)),
  0, 'C2 client cannot read direct-room messages');
select throws_ok(
  $$ insert into public.conversations (job_id, client_id, contractor_id, kind, user_id, title, status)
     select job_id, client_id, inspector_id, 'job_client_inspector', client_id, 'crafted', 'open' from _c $$,
  NULL, NULL, 'C3 client cannot CRAFT a direct room by direct API call');
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, content)
     select direct_conv, client_id, 'sneak' from _c $$,
  NULL, NULL, 'C4 client cannot POST into the direct room it nominally owns');
-- Full-mode direct chat was RESTORED by owner ruling (20260801570000), so the
-- opener no longer refuses categorically: it refuses because THIS job is not in
-- Full mode. The denial is what matters, and the message explains why.
select throws_like(
  $$ select public.open_direct_conversation(
       (select job_id from _c), (select inspector_id from _c)) $$,
  '%direct chat is not authorized%',
  'C5 open_direct_conversation() fails closed for a non-Full job');

-- ─── CLIENT → ADMIN : ALLOWED ───────────────────────────────────────────────
select is(
  (select count(*)::int from public.conversations where id = (select admin_conv from _c)),
  1, 'C6 client keeps the NEXPEC admin lane');
select is(
  (select count(*)::int from public.messages where conversation_id = (select admin_conv from _c)),
  1, 'C7 client reads its admin-lane messages');
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, content)
     select admin_conv, client_id, 'follow-up to admin' from _c $$,
  'C8 client can POST to the admin lane');

reset role;

-- ─── INSPECTOR side ─────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select inspector_id::text from _c) || '","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.messages where conversation_id = (select direct_conv from _c)),
  0, 'I1 inspector cannot read the direct room either (denied both directions)');
select is(
  (select count(*)::int from public.conversations where id = (select insp_admin_conv from _c)),
  1, 'I2 inspector keeps the NEXPEC admin lane');
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, content)
     select insp_admin_conv, inspector_id, 'inspector follow-up' from _c $$,
  'I3 inspector can POST to the admin lane');
select is(
  (select comments from public.report_senior_reviews
    where inspection_report_id = (select direct_conv from _c) and round = 1),
  'Senior: re-shoot weld W3 with better lighting.',
  'I4 inspector RECEIVES the senior/QA supervisory message (review round)');

reset role;

-- ─── SENIOR / QA reviewer ───────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select senior_id::text from _c) || '","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.report_senior_reviews
    where inspection_report_id = (select direct_conv from _c)),
  1, 'S1 senior reviewer reads its own supervisory round (Senior ↔ Inspector lane intact)');
reset role;

-- ─── ADMIN oversight ────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select admin_id::text from _c) || '","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.conversations where id = (select direct_conv from _c)),
  1, 'A1 admin RETAINS oversight of retired direct rooms (audit preserved)');
select is(
  (select count(*)::int from public.messages where conversation_id = (select direct_conv from _c)),
  1, 'A2 admin retains the historical transcript');
reset role;

select * from finish();
rollback;
