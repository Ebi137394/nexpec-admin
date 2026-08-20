-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/account_org_commercial_parity_test.sql
--
--  Commercial visibility for EVERY canonical actor, locked at the DB layer.
--  Companion to 20260801578000 (org buyer parity) and 20260801576000 (manual
--  payment posture).
--
--  Canonical actors covered: individual client, RFQ buyer (a client persona),
--  agency principal, enterprise principal, org owner / procurement_admin /
--  project_lead / viewer, a second organization (isolation), inspector,
--  talent-persona inspector, senior inspector, supplier, admin.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/account_org_commercial_parity_test.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(23);

create temporary table _a on commit drop as
select gen_random_uuid() as org, gen_random_uuid() as org2,
       gen_random_uuid() as agency, gen_random_uuid() as proc,
       gen_random_uuid() as lead, gen_random_uuid() as viewer,
       gen_random_uuid() as outsider, gen_random_uuid() as indiv,
       gen_random_uuid() as insp, gen_random_uuid() as insp2,
       gen_random_uuid() as senior, gen_random_uuid() as supplier,
       gen_random_uuid() as admin,
       gen_random_uuid() as org_job, gen_random_uuid() as indiv_job,
       gen_random_uuid() as org_app, gen_random_uuid() as indiv_app,
       gen_random_uuid() as org_jc,  gen_random_uuid() as indiv_jc;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'ap.'||u::text||'@synthetic.invalid', now(), now()
  from _a, unnest(array[agency,proc,lead,viewer,outsider,indiv,insp,insp2,senior,supplier,admin]) u;

insert into public.profiles (id, role, full_name, email, is_verified)
select agency,'agency','AP Agency','ap.ag@synthetic.invalid',true from _a
union all select proc,'client','AP Procurement','ap.pr@synthetic.invalid',true from _a
union all select lead,'client','AP Lead','ap.pl@synthetic.invalid',true from _a
union all select viewer,'client','AP Viewer','ap.vw@synthetic.invalid',true from _a
union all select outsider,'enterprise','AP Outsider','ap.out@synthetic.invalid',true from _a
union all select indiv,'client','AP Individual','ap.ind@synthetic.invalid',true from _a
union all select insp,'inspector','AP Inspector','ap.in@synthetic.invalid',true from _a
union all select insp2,'inspector','AP Talent','ap.in2@synthetic.invalid',true from _a
union all select senior,'senior','AP Senior','ap.sr@synthetic.invalid',true from _a
union all select supplier,'supplier','AP Supplier','ap.sp@synthetic.invalid',true from _a
union all select admin,'super_admin','AP Admin','ap.adm@synthetic.invalid',true from _a
on conflict (id) do update set role = excluded.role;

insert into public.organizations (id,name,slug)
select org,'AP Org','ap-org-'||substr(org::text,1,8) from _a
union all select org2,'AP Other','ap-other-'||substr(org2::text,1,8) from _a;
insert into public.org_members (org_id,user_id,role)
select org,agency,'owner'::org_member_role from _a
union all select org,proc,'procurement_admin'::org_member_role from _a
union all select org,lead,'project_lead'::org_member_role from _a
union all select org,viewer,'viewer'::org_member_role from _a
union all select org2,outsider,'owner'::org_member_role from _a;

-- ORG-OWNED job (client_id NULL) and an INDIVIDUAL-owned job.
insert into public.jobs (id,title,client_id,agency_id,status,moderation_status,payment_mode,
                         client_price_cents,inspector_payout_cents,identity_mode)
select org_job,'ap org job',NULL,agency,'open','approved','prepay',100000,80000,'protected' from _a
union all
select indiv_job,'ap indiv job',indiv,NULL,'open','approved','prepay',50000,40000,'protected' from _a;

insert into public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
select org_app,org_job,insp,'hired',80000,now() from _a
union all select indiv_app,indiv_job,insp2,'hired',40000,now() from _a;

insert into public.job_contracts (id,job_id,application_id,client_id,inspector_id,
                                  client_price_cents,inspector_payout_cents,status,contract_text_md)
select org_jc,org_job,org_app,public.nx_job_buyer_principal(org_job),insp,100000,80000,'fully_executed',
       E'## Org\nClient price $1,000.00 - Inspector payout $800.00 - platform margin $200.00.' from _a
union all
select indiv_jc,indiv_job,indiv_app,indiv,insp2,50000,40000,'fully_executed',
       E'## Indiv\nClient price $500.00 - Inspector payout $400.00.' from _a;

grant select on _a to authenticated;

-- ─── A. Buyers see own total, never payout/margin ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select agency::text from _a)||'","role":"authenticated"}',true);
select is((select client_price_cents::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  100000, 'A1 agency principal sees its own org total');
select ok((select contract_text_md !~* 'payout|\$800|margin|\$200'
             from public.client_job_contracts_view where id=(select org_jc from _a)),
  'A2 agency never sees inspector payout or platform margin');
select is((select count(*)::int from public.client_job_contracts_view where id=(select indiv_jc from _a)),
  0, 'A3 agency cannot see another buyer''s contract');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select indiv::text from _a)||'","role":"authenticated"}',true);
select is((select client_price_cents::int from public.client_job_contracts_view where id=(select indiv_jc from _a)),
  50000, 'A4 individual client sees its own total');
select ok((select contract_text_md !~* 'payout|\$400'
             from public.client_job_contracts_view where id=(select indiv_jc from _a)),
  'A5 individual client never sees the payout');
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'A6 individual client cannot see the organization''s contract');
select is((select count(*)::int from public.manual_payment_records), 0,
  'A7 no buyer can read raw settlement data');
reset role;

-- ─── B. Organization membership scoping ─────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select proc::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  1, 'B1 procurement_admin sees the organization contract (finance permission)');
select ok((select contract_text_md !~* 'payout|margin'
             from public.client_job_contracts_view where id=(select org_jc from _a)),
  'B2 procurement_admin still never sees payout or margin');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select lead::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'B3 project_lead does NOT inherit finance access');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select viewer::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'B4 viewer does NOT inherit finance access');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select outsider::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'B5 cross-organization isolation holds');
reset role;

select ok((select public.nx_job_buyer_principal((select org_job from _a)) = (select agency from _a)),
  'B6 buyer-principal resolver returns the org account for a client_id-NULL job');
select ok((select client_id = (select agency from _a) from public.job_contracts where id=(select org_jc from _a)),
  'B7 org-owned contract carries the resolved principal (the old NOT NULL failure class)');

-- ─── C. Inspector / talent / senior ─────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select insp::text from _a)||'","role":"authenticated"}',true);
select is((select inspector_payout_cents::int from public.inspector_job_contracts_view where id=(select org_jc from _a)),
  80000, 'C1 inspector sees only its own agreed payout');
select ok((select contract_text_md !~* 'client price|\$1,000|margin'
             from public.inspector_job_contracts_view where id=(select org_jc from _a)),
  'C2 inspector never sees the client total or platform margin');
select is((select count(*)::int from public.inspector_job_contracts_view where id=(select indiv_jc from _a)),
  0, 'C3 inspector cannot see another inspector''s payout');
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'C4 inspector cannot read the client-side contract surface');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select senior::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.inspector_job_contracts_view where id=(select org_jc from _a)),
  0, 'C5 senior inspector sees no other inspector''s payout');
reset role;

-- ─── D. Supplier ────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select supplier::text from _a)||'","role":"authenticated"}',true);
select is((select count(*)::int from public.client_job_contracts_view where id=(select org_jc from _a)),
  0, 'D1 supplier sees no inspection client ledger it is not party to');
select is((select count(*)::int from public.inspector_job_contracts_view where id=(select org_jc from _a)),
  0, 'D2 supplier sees no inspector payout');
reset role;

-- ─── E. Admin ───────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select admin::text from _a)||'","role":"authenticated"}',true);
select ok((select client_price_cents=100000 and inspector_payout_cents=80000
              and (client_price_cents-inspector_payout_cents)=20000
             from public.job_contracts where id=(select org_jc from _a)),
  'E1 admin sees client total, inspector payout and platform margin');
select lives_ok(
  $$ select public.admin_record_manual_payment((select org_job from _a),'client_payment',100000,'bank_transfer') $$,
  'E2 authorized admin can record a manual payment');
reset role;

select * from finish();
rollback;
