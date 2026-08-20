-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/delivery_policy_credit_release_test.sql
--
--  Proof for 20260801500000_delivery_policy_credit_release.sql.
--  Covers the eight owner-required paths:
--    1 strict 20/80 blocks delivery
--    2 Admin releases on Net-15
--    3 Admin releases on Net-30
--    4 Admin releases on Net-60
--    5 report stays deliverable when the invoice is overdue
--    6 Client / Inspector attempts to change terms are rejected
--    7 no automatic Inspector payout
--    8 every Admin action lands in the audit trail
--
--  The 20/80 split itself is NOT under test here — staged_funding_test.sql
--  owns that and still asserts 2000/8000. This suite only proves that WHICH
--  tranche gates delivery is configurable, and that authority and money
--  guarantees survive it.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql

select plan(16);

-- ── actors ──────────────────────────────────────────────────────────────────
-- profiles.id FKs to auth.users, so the auth rows come first.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'dp.'||u::text||'@test.nx', now(), now()
  from unnest(ARRAY['c0000000-0000-0000-0000-000000000001'::uuid,
                    'c0000000-0000-0000-0000-000000000002'::uuid,
                    'c0000000-0000-0000-0000-000000000003'::uuid]) u
on conflict (id) do nothing;

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, email, role, full_name, is_verified) values
  ('c0000000-0000-0000-0000-000000000001','dp-client@x.test','client','DP Client',true),
  ('c0000000-0000-0000-0000-000000000002','dp-insp@x.test','inspector','DP Inspector',true),
  ('c0000000-0000-0000-0000-000000000003','dp-admin@x.test','super_admin','DP Admin',true)
on conflict (id) do nothing;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

\set CL '''c0000000-0000-0000-0000-000000000001'''
\set IN '''c0000000-0000-0000-0000-000000000002'''
\set AD '''c0000000-0000-0000-0000-000000000003'''

-- A dispatched job with a materialised 20/80 schedule.
select nx_fx_dispatched_job(:CL::uuid, :IN::uuid, :AD::uuid, 'strict job') as job \gset
select public.nx_funding_ensure_schedule(:'job'::uuid);
--  Fund the 20% initial tranche through the platform path. Without this the
--  INITIAL tranche is also unfunded and gating, so delivery would be blocked
--  for a reason that has nothing to do with the final-balance policy under
--  test — the suite would pass assertion 1 for the wrong reason and fail
--  assertion 8 while the product was behaving correctly.
select public.nx_funding_mark_stage_funded(:'job'::uuid, 'initial', 'test');

-- ── 1. STRICT: the final 80% gates delivery ─────────────────────────────────
--  The fixture funds the initial tranche through the platform path; the final
--  tranche is outstanding and gating, so delivery must be refused.
select ok(
  not public.nx_funding_delivery_satisfied(:'job'::uuid),
  'STRICT PREPAY: an outstanding, gating final tranche blocks final report delivery'
);

select is(
  (select bool_and(gates_delivery) from public.job_funding_stages where job_id = :'job'::uuid),
  true,
  'every tranche defaults to gating — Strict Prepay is the backfilled default, not an opt-in'
);

-- ── 6. Client and Inspector cannot change the policy ────────────────────────
--  Asserted BEFORE the admin path, so a later success cannot mask a
--  permissive failure here.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 30, %L)', :'job', 'client tries'),
  '42501',
  null,
  'a CLIENT cannot release a job on credit'
);
select throws_ok(
  format('select public.nx_admin_set_client_delivery_policy(%L::uuid, %L, 30, %L)', :CL, 'CREDIT_RELEASE', 'client tries'),
  '42501',
  null,
  'a CLIENT cannot set a delivery policy'
);

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 30, %L)', :'job', 'inspector tries'),
  '42501',
  null,
  'an INSPECTOR cannot release a job on credit'
);

--  And they cannot reach the column directly either — the RPC is not the only
--  door that has to be locked.
--  Deliberately NOT throws_ok: an RLS-hidden row makes the UPDATE match zero
--  rows and raise nothing, so a throws_ok here would pass while proving
--  nothing. Assert the VALUE is unchanged instead — that holds whether the
--  write is refused by a raise or silently filtered.
update public.job_funding_stages set gates_delivery = false
 where job_id = :'job'::uuid and code = 'final';
--  Read back with privilege. Reading as the inspector would return NULL —
--  they have no SELECT policy on this table — and comparing NULL to true
--  fails for a reason that has nothing to do with the write being refused.
reset role;
select is(
  (select gates_delivery from public.job_funding_stages
    where job_id = :'job'::uuid and code = 'final'),
  true,
  'an INSPECTOR cannot flip gates_delivery by direct UPDATE — the value is unchanged'
);

-- ── 2/3/4. Admin releases on Net-15 / Net-30 / Net-60 ───────────────────────
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select lives_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 15, %L)', :'job', 'approved enterprise buyer'),
  'ADMIN may release the final balance on Net-15'
);

select ok(
  public.nx_funding_delivery_satisfied(:'job'::uuid),
  'CREDIT RELEASE: delivery is no longer blocked once the final tranche is released'
);

--  Net-30 and Net-60 on their own jobs, so each term is proved independently.
select nx_fx_dispatched_job(:CL::uuid, :IN::uuid, :AD::uuid, 'net30 job') as j30 \gset
select public.nx_funding_ensure_schedule(:'j30'::uuid);
select public.nx_funding_mark_stage_funded(:'j30'::uuid, 'initial', 'test');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 30, %L)', :'j30', 'net30'),
  'ADMIN may release on Net-30'
);

select nx_fx_dispatched_job(:CL::uuid, :IN::uuid, :AD::uuid, 'net60 job') as j60 \gset
select public.nx_funding_ensure_schedule(:'j60'::uuid);
select public.nx_funding_mark_stage_funded(:'j60'::uuid, 'initial', 'test');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 60, %L)', :'j60', 'net60'),
  'ADMIN may release on Net-60'
);

--  An unsupported term must be refused rather than silently coerced.
select throws_ok(
  format('select public.nx_admin_release_job_on_credit(%L::uuid, 45, %L)', :'j60', 'unsupported'),
  '22023',
  null,
  'Net-45 is refused — only 15, 30 and 60 are supported terms'
);

-- ── 5. Overdue must never revoke or hide the delivered report ───────────────
select public.nx_funding_issue_delivery_invoice(:'job'::uuid);
--  Force the invoice into the past to simulate an overdue balance.
update public.job_funding_stages
   set invoice_due_at = now() - interval '3 days'
 where job_id = :'job'::uuid and code = 'final';

select is(
  public.nx_funding_invoice_status(:'job'::uuid),
  'overdue',
  'an unpaid released invoice past its due date reports as overdue'
);

select ok(
  public.nx_funding_delivery_satisfied(:'job'::uuid),
  'OVERDUE: the delivered report stays accessible — an overdue invoice never revokes or hides it'
);

-- ── 7. No automatic Inspector payout ────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nx_admin_set_client_delivery_policy',
                        'nx_admin_release_job_on_credit',
                        'nx_funding_issue_delivery_invoice',
                        'nx_funding_delivery_satisfied')
      and regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
          '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts)\M'),
  0,
  'no delivery-policy function moves money — Inspector settlement stays a separate manual Admin action'
);

-- ── 8. Audit trail ──────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.funding_policy_audit
    where job_id in (:'job'::uuid, :'j30'::uuid, :'j60'::uuid)),
  3,
  'every Admin credit release is audited — one row per release'
);

select ok(
  (select bool_and(actor_id is not null
                   and actor_role in ('admin','super_admin')
                   and previous_policy is not null
                   and new_policy is not null
                   and net_term_days is not null
                   and length(trim(reason)) > 0)
     from public.funding_policy_audit
    where job_id in (:'job'::uuid, :'j30'::uuid, :'j60'::uuid)),
  'each audit row records actor, role, previous terms, new terms, Net term and reason'
);

select * from finish();

rollback;
