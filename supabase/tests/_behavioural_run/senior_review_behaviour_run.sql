\set ON_ERROR_STOP off
\set QUIET on
-- ── a tiny TAP-alike so each assertion reports pass/fail on its own ─────────
CREATE OR REPLACE FUNCTION pg_temp.throws(p_sql text, p_state text, p_desc text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN 'ok   '||p_desc; END IF;
    RETURN 'FAIL '||p_desc||'  (got '||SQLSTATE||': '||left(SQLERRM,60)||')';
  END;
  RETURN 'FAIL '||p_desc||'  (no exception raised)';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.lives(p_sql text, p_desc text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok   '||p_desc;
EXCEPTION WHEN OTHERS THEN RETURN 'FAIL '||p_desc||'  ('||SQLSTATE||': '||left(SQLERRM,70)||')'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.eq(p_got text, p_want text, p_desc text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p_got IS NOT DISTINCT FROM p_want THEN RETURN 'ok   '||p_desc;
END IF; RETURN 'FAIL '||p_desc||'  (got '||coalesce(p_got,'NULL')||' want '||p_want||')'; END $$;
\set QUIET off

-- ── fixtures ───────────────────────────────────────────────────────────────
DELETE FROM public.report_senior_reviews; DELETE FROM public.job_funding_stages;
DELETE FROM public.notifications; DELETE FROM public.wallets; DELETE FROM public.transactions;
INSERT INTO public.profiles(id,role,status) VALUES
 ('10000000-0000-0000-0000-000000000001','admin','active'),
 ('10000000-0000-0000-0000-000000000002','inspector','active'),
 ('10000000-0000-0000-0000-000000000003','senior','active'),
 ('10000000-0000-0000-0000-000000000004','senior','active'),
 ('10000000-0000-0000-0000-000000000005','senior','suspended'),
 ('10000000-0000-0000-0000-000000000006','senior','active'),
 ('10000000-0000-0000-0000-000000000007','client','active')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
INSERT INTO public.jobs(id,client_id,contractor_id,status,payment_mode,client_price_cents,inspector_payout_cents)
 VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007',
         '10000000-0000-0000-0000-000000000002','in_progress','net_terms',100000,70000)
ON CONFLICT (id) DO UPDATE SET client_settled_at=NULL, status='in_progress';
INSERT INTO public.inspection_reports(id,job_id,inspector_id,status)
 VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
         '10000000-0000-0000-0000-000000000002','submitted')
ON CONFLICT (id) DO UPDATE SET status='submitted';

SET request.jwt.claims TO '{"role":"service_role"}';
SELECT pg_temp.lives($$SELECT public.nx_funding_ensure_schedule('20000000-0000-0000-0000-000000000001')$$,'01 platform materialises funding schedule');

-- A. eligibility
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.throws($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$$,'42501','02 ordinary Inspector rejected');
SELECT pg_temp.throws($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007')$$,'42501','03 Client rejected');
SELECT pg_temp.throws($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005')$$,'42501','04 DEACTIVATED senior rejected');
UPDATE public.profiles SET role='senior' WHERE id='10000000-0000-0000-0000-000000000002';
SELECT pg_temp.throws($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$$,'42501','05 primary AUTHOR rejected even as senior');
UPDATE public.profiles SET role='inspector' WHERE id='10000000-0000-0000-0000-000000000002';
SET test.contributors TO '10000000-0000-0000-0000-000000000006';
SELECT pg_temp.throws($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006')$$,'42501','06 DERIVED CO-AUTHOR rejected');
SET test.contributors TO '';
SELECT pg_temp.lives($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003')$$,'07 valid unrelated Senior Inspector accepted');
SELECT pg_temp.eq((SELECT round::text FROM public.report_senior_reviews WHERE inspection_report_id='30000000-0000-0000-0000-000000000001' AND superseded_at IS NULL),'1','08 round 1 opened');

-- B. forged / wrong round
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT pg_temp.throws($$SELECT public.nx_senior_review_decide('30000000-0000-0000-0000-000000000001','approved',NULL,1)$$,'42501','09 non-assignee cannot decide (forged)');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT pg_temp.throws($$SELECT public.nx_senior_review_decide('30000000-0000-0000-0000-000000000001','approved',NULL,99)$$,'22000','10 stale round pin refused');
SELECT pg_temp.throws($$SELECT public.nx_senior_review_decide('30000000-0000-0000-0000-000000000001','returned','   ',1)$$,'22000','11 empty return comment refused');

-- C. replacement isolation
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.lives($$SELECT public.nx_admin_assign_senior_reviewer('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004')$$,'12 reassignment supersedes live round');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT pg_temp.throws($$SELECT public.nx_senior_review_decide('30000000-0000-0000-0000-000000000001','approved',NULL,1)$$,'22000','13 SUPERSEDED reviewer cannot decide');

-- D. delivery authority via DIRECT TABLE UPDATE (the P0 shape)
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
SELECT pg_temp.throws($$UPDATE public.inspection_reports SET status='delivered' WHERE id='30000000-0000-0000-0000-000000000001'$$,'42501','14 CLIENT cannot self-deliver (direct PATCH)');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT pg_temp.throws($$UPDATE public.inspection_reports SET status='delivered' WHERE id='30000000-0000-0000-0000-000000000001'$$,'42501','15 INSPECTOR cannot self-deliver (direct PATCH)');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT pg_temp.throws($$UPDATE public.inspection_reports SET status='delivered' WHERE id='30000000-0000-0000-0000-000000000001'$$,'42501','16 SENIOR INSPECTOR cannot deliver');

-- E. funding gates
SELECT pg_temp.lives($$SELECT public.nx_senior_review_decide('30000000-0000-0000-0000-000000000001','approved',NULL,2)$$,'17 assigned reviewer approves live round');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.throws($$SELECT public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001')$$,'22000','18 Admin blocked before remaining tranche');
SET request.jwt.claims TO '{"role":"service_role"}';
SELECT pg_temp.lives($$SELECT public.nx_funding_mark_stage_funded('20000000-0000-0000-0000-000000000001','initial','pi_b_init')$$,'19 initial tranche recorded');
SELECT pg_temp.eq((SELECT (public.settle_client_payment('20000000-0000-0000-0000-000000000001'))->>'settled'),'false','20 20% is NOT full settlement');
SELECT pg_temp.eq(coalesce((SELECT available_balance::text FROM public.wallets WHERE user_id='10000000-0000-0000-0000-000000000002'),'0'),'0','21 ZERO automatic inspector payout');

-- F. golden path
SELECT pg_temp.lives($$SELECT public.nx_funding_mark_stage_funded('20000000-0000-0000-0000-000000000001','final','pi_b_final'); SELECT public.settle_client_payment('20000000-0000-0000-0000-000000000001')$$,'22 remaining tranche + settlement');
SET request.jwt.claims TO '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.lives($$SELECT public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001')$$,'23 GOLDEN PATH: Admin delivers');
SELECT pg_temp.eq((SELECT status FROM public.inspection_reports WHERE id='30000000-0000-0000-0000-000000000001'),'delivered','24 report is delivered');
