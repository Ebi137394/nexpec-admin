-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/contract_commercial_privacy_test.sql
--
--  OWNER-REVIEW STRICT — role-parity proof for 20260801558000.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/contract_commercial_privacy_test.sql
--
--  WHAT IS PROVED (the exact leak reproduced on Staging, replicated here)
--    Stored agreement body:
--      ## NEXPEC Owner-Review Agreement
--      Client price $1,000.00 - Inspector payout $800.00 - 20/80 staged funding.
--
--    A  CLIENT reads $1,000 total + 20/80 funding terms, and NEVER the
--       inspector payout, $800, platform margin/spread wording — through
--       client_job_contracts_view AND the client leg of unified_contracts_view.
--    B  CLIENT never receives inspector email/phone in ANY identity mode
--       (protected / professional / full) — contracts view AND applicant view.
--    C  INSPECTOR reads their own $800 payout and NEVER the client price,
--       $1,000, or margin/spread — inspector view AND unified inspector leg.
--    D  ADMIN retains the full commercial breakdown: $1,000 / $800 / $200
--       spread and the raw master body.
--    E  The client view exposes no payout column at all, and the inspector
--       view no client-price column (catalogue-level price blindness).
--    F  Signed-record immutability: the stored master body is byte-identical
--       after all reads — projections never rewrite the record.
--
--  FIXTURE RULES OBSERVED
--    • Every identifier from gen_random_uuid(); no hard-coded UUIDs.
--    • profiles insert uses ON CONFLICT (id) DO UPDATE (auto-provisioning).
--    • Ends in rollback; nothing persists.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(27);

-- ─── Fixture ────────────────────────────────────────────────────────────────
create temporary table _ids on commit drop as
select gen_random_uuid() as client_id,
       gen_random_uuid() as inspector_id,
       gen_random_uuid() as admin_id,
       gen_random_uuid() as job_id,
       gen_random_uuid() as app_id;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ccp.' || u::text || '@synthetic.invalid', now(), now()
  from _ids, unnest(array[client_id, inspector_id, admin_id]) u;

insert into public.profiles (id, role, full_name, email, phone, is_verified)
select client_id, 'client', 'CCP Client', 'ccp.client@synthetic.invalid', '+15550101', true from _ids
union all
select inspector_id, 'inspector', 'CCP Real Inspector', 'ccp.inspector@synthetic.invalid', '+15550102', true from _ids
union all
select admin_id, 'super_admin', 'CCP Admin', 'ccp.admin@synthetic.invalid', '+15550103', true from _ids
on conflict (id) do update set email = excluded.email, role = excluded.role,
  full_name = excluded.full_name, phone = excluded.phone;

insert into public.jobs (id, title, client_id, status, moderation_status, payment_mode,
                         client_price_cents, inspector_payout_cents, identity_mode)
select job_id, 'ccp strict replica', client_id, 'open', 'approved', 'prepay',
       100000, 80000, 'full'
  from _ids;

insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents,
                                 forwarded_to_client_at)
select app_id, job_id, inspector_id, 'accepted', 80000, now() from _ids;

insert into public.job_contracts (job_id, application_id, client_id, inspector_id,
                                  client_price_cents, inspector_payout_cents,
                                  status, contract_text_md)
select job_id, app_id, client_id, inspector_id, 100000, 80000,
       'pending_client_signature',
       E'## NEXPEC Owner-Review Agreement\nClient price $1,000.00 - Inspector payout $800.00 - 20/80 staged funding.'
  from _ids;

create temporary table _jc on commit drop as
select id as contract_id from public.job_contracts
 where job_id = (select job_id from _ids);

-- The assertions below run under SET ROLE authenticated; the fixture-id temp
-- tables are owned by the suite runner, so the role needs explicit SELECT.
grant select on _ids, _jc to authenticated;

-- ─── E. Catalogue price blindness ───────────────────────────────────────────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'client_job_contracts_view'
      and column_name in ('inspector_payout_cents','platform_spread_cents')),
  0, 'E1 client view exposes no payout/spread column at all');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'inspector_job_contracts_view'
      and column_name = 'client_price_cents'),
  0, 'E2 inspector view exposes no client-price column at all');

-- ─── A. CLIENT — contracts view ─────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _ids) || '","role":"authenticated"}', true);

select is(
  (select client_price_cents::int from public.client_job_contracts_view
    where id = (select contract_id from _jc)),
  100000, 'A1 CLIENT sees the $1,000 total contract price');
select ok(
  (select contract_text_md ~ '\$1,000\.00' and contract_text_md ~ '20/80'
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'A2 CLIENT body keeps their own $1,000.00 figure and the 20/80 funding terms');
select ok(
  (select contract_text_md !~* 'inspector payout' and contract_text_md !~* '\$800'
      and contract_text_md !~* 'margin' and contract_text_md !~* 'spread'
      and contract_text_md !~* 'internal compensation'
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'A3 CLIENT body carries no payout figure, payout wording, margin or spread');
select ok(
  (select body_md ~ '\$1,000\.00' and body_md !~* 'inspector payout' and body_md !~* '\$800'
     from public.unified_contracts_view
    where contract_id = 'jc:' || (select contract_id from _jc) || ':client'),
  'A4 unified view client leg is equally blind');
select is(
  (select amount_cents::int from public.unified_contracts_view
    where contract_id = 'jc:' || (select contract_id from _jc) || ':client'),
  100000, 'A5 unified client leg amount is the client price, not the payout');

-- ─── B. CLIENT — private contact, all three identity modes ──────────────────
select ok(
  (select inspector_email is null and inspector_phone is null
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'B1 FULL mode: no inspector email/phone on the contract');
select ok(
  (select inspector_email is null and inspector_phone is null
     from public.job_applicant_identity_view
    where application_id = (select app_id from _ids)),
  'B2 FULL mode: no inspector email/phone on the forwarded application');
select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id = (select app_id from _ids)),
  'CCP Real Inspector',
  'B3 …while FULL still discloses the NAME — the identity feature survives, so B2 is not vacuous');

reset role;
update public.jobs set identity_mode = 'professional' where id = (select job_id from _ids);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _ids) || '","role":"authenticated"}', true);
select ok(
  (select inspector_email is null and inspector_phone is null
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'B4 PROFESSIONAL mode: no email/phone');

reset role;
update public.jobs set identity_mode = 'protected' where id = (select job_id from _ids);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _ids) || '","role":"authenticated"}', true);
select ok(
  (select inspector_email is null and inspector_phone is null
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'B5 PROTECTED mode: no email/phone');

reset role;
update public.jobs set identity_mode = 'full' where id = (select job_id from _ids);

-- ─── C. INSPECTOR ───────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select inspector_id::text from _ids) || '","role":"authenticated"}', true);

select is(
  (select inspector_payout_cents::int from public.inspector_job_contracts_view
    where id = (select contract_id from _jc)),
  80000, 'C1 INSPECTOR sees their own $800 payout');
select ok(
  (select contract_text_md ~ '\$800\.00' and contract_text_md ~ '20/80'
     from public.inspector_job_contracts_view where id = (select contract_id from _jc)),
  'C2 INSPECTOR body keeps their own $800.00 figure and the funding terms');
select ok(
  (select contract_text_md !~* 'client price' and contract_text_md !~* '\$1,000'
      and contract_text_md !~* 'margin' and contract_text_md !~* 'spread'
     from public.inspector_job_contracts_view where id = (select contract_id from _jc)),
  'C3 INSPECTOR body carries no client price, margin or spread');
select ok(
  (select body_md ~ '\$800\.00' and body_md !~* 'client price' and body_md !~* '\$1,000'
     from public.unified_contracts_view
    where contract_id = 'jc:' || (select contract_id from _jc) || ':inspector'),
  'C4 unified view inspector leg is equally blind');
select is(
  (select count(*)::int from public.client_job_contracts_view
    where id = (select contract_id from _jc)),
  0, 'C5 INSPECTOR cannot read the client view at all (row-gated)');

-- …and the client cannot read the inspector view.
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _ids) || '","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.inspector_job_contracts_view
    where id = (select contract_id from _jc)),
  0, 'C6 CLIENT cannot read the inspector view at all (row-gated)');

reset role;

-- ─── D. ADMIN — full commercial breakdown ───────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select admin_id::text from _ids) || '","role":"authenticated"}', true);

select is(
  (select client_price_cents::int from public.job_contracts
    where id = (select contract_id from _jc)),
  100000, 'D1 ADMIN sees the $1,000 client price');
select is(
  (select inspector_payout_cents::int from public.job_contracts
    where id = (select contract_id from _jc)),
  80000, 'D2 ADMIN sees the $800 inspector payout');
select is(
  (select (client_price_cents - inspector_payout_cents)::int from public.job_contracts
    where id = (select contract_id from _jc)),
  20000, 'D3 ADMIN sees the $200 spread');
select ok(
  (select contract_text_md ~* 'Inspector payout \$800\.00'
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'D4 ADMIN reads the RAW master body even through the client view');
select ok(
  (select inspector_email = 'ccp.inspector@synthetic.invalid'
     from public.client_job_contracts_view where id = (select contract_id from _jc)),
  'D5 ADMIN retains contact visibility for vetting');

reset role;

-- ─── F. Immutability of the signed/audited record ───────────────────────────
select is(
  (select contract_text_md from public.job_contracts where id = (select contract_id from _jc)),
  E'## NEXPEC Owner-Review Agreement\nClient price $1,000.00 - Inspector payout $800.00 - 20/80 staged funding.',
  'F1 the stored master body is byte-identical — projections never rewrote the record');

-- ─── Sanitizer edge: forbidden-only body redacts fully ──────────────────────
select ok(
  public.nx_contract_text_for_client('NEXPEC platform margin: $200.00 (internal compensation)')
    !~* 'margin|compensation|\$',
  'G1 a forbidden-only body redacts completely for the client');
select ok(
  public.nx_contract_text_for_inspector('Total contract price $1,000.00 owed by the Client')
    !~* '\$1,000|client',
  'G2 a client-price-only body redacts completely for the inspector');
select is(
  public.nx_contract_text_for_client(null), null,
  'G3 a NULL body stays NULL');

select * from finish();
rollback;
