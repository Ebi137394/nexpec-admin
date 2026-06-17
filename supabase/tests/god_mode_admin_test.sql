-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/god_mode_admin_test.sql — pgTAP god-mode RLS coverage
--
--  Locks the result of the god-mode sweep (migration 20260801146000):
--    • every operational table carries an admin FOR ALL overlay,
--    • every audit/seal/secret table carries an admin FOR SELECT overlay (and
--      NO write overlay — even ebi can't tamper with an audit trail/seal),
--    • the deliberately-excluded surfaces (money, auth secrets) stay clean.
--  Existence-based (over pg_policies) so it's deterministic and FK-free.
--  Run with:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(5);

-- Tier 1 — operational tables that must have an admin FOR ALL overlay
\set full_csv 'disputes,support_tickets,support_messages,helpdesk_messages,admin_direct_messages,organizations,departments,department_members,org_departments,org_department_members,org_members,org_invitations,proposals,reports,findings,coordination_bridges,bridge_documents,bridge_slots,contractor_certifications,contractors,inspector_skills,preferred_inspectors,saved_jobs,safety_checks,work_sessions,vendor_contacts,referrals,user_course_progress,platform_settings,review_weights_config,client_documents,expenses'
-- Tier 2 — audit/seal/secret/consent tables that must have an admin FOR SELECT overlay
\set read_csv 'verification_audit_log,notification_logs,client_error_events,inspection_events,dispute_activities,pi_report_seals,inspection_seal_anchors,flash_reports,flash_report_attachments,payment_methods,profile_work_auth_documents,push_tokens,legal_consents,legal_document_acceptances,inspection_items'

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and cmd='ALL'
       and policyname like '%\_admin\_all' escape '\'
       and tablename = any (string_to_array(:'full_csv', ','))),
  array_length(string_to_array(:'full_csv', ','), 1),
  'every operational table has an admin FOR ALL overlay');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and cmd='SELECT'
       and policyname like '%\_admin\_read' escape '\'
       and tablename = any (string_to_array(:'read_csv', ','))),
  array_length(string_to_array(:'read_csv', ','), 1),
  'every audit/seal/secret table has an admin FOR SELECT overlay');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public'
       and policyname like '%\_admin\_all' escape '\'
       and tablename = any (string_to_array(:'read_csv', ','))),
  0,
  'read-only tables carry NO admin write overlay (audit/seal/secret immutability)');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public'
       and tablename in ('transactions','invoices','job_expenses','withdrawals','payout_requests','payments')
       and (policyname like '%\_admin\_all' escape '\' or policyname like '%\_admin\_read' escape '\')),
  0,
  'money tables remain free of god-mode overlays (Phase 4 lockdown preserved)');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='auth_recovery_codes'
       and policyname like '%\_admin\_%' escape '\'),
  0,
  'auth_recovery_codes stays owner-only (no admin overlay)');

select * from finish();
rollback;
