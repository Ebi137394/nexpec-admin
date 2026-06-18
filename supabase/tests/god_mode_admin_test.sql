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

-- All 47 god-mode tables must carry a FULL admin overlay (32 operational from
-- 146000 + 15 audit/seal/secret/consent upgraded to full in 147000 per owner override)
\set all_csv 'disputes,support_tickets,support_messages,helpdesk_messages,admin_direct_messages,organizations,departments,department_members,org_departments,org_department_members,org_members,org_invitations,proposals,reports,findings,coordination_bridges,bridge_documents,bridge_slots,contractor_certifications,contractors,inspector_skills,preferred_inspectors,saved_jobs,safety_checks,work_sessions,vendor_contacts,referrals,user_course_progress,platform_settings,review_weights_config,client_documents,expenses,verification_audit_log,notification_logs,client_error_events,inspection_events,dispute_activities,pi_report_seals,inspection_seal_anchors,flash_reports,flash_report_attachments,payment_methods,profile_work_auth_documents,push_tokens,legal_consents,legal_document_acceptances,inspection_items'
-- The 15 tables upgraded from read-only to full
\set upgraded_csv 'verification_audit_log,notification_logs,client_error_events,inspection_events,dispute_activities,pi_report_seals,inspection_seal_anchors,flash_reports,flash_report_attachments,payment_methods,profile_work_auth_documents,push_tokens,legal_consents,legal_document_acceptances,inspection_items'

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and cmd='ALL'
       and policyname = any (select x || '_admin_all' from unnest(string_to_array(:'all_csv', ',')) x)),
  array_length(string_to_array(:'all_csv', ','), 1),
  'every god-mode table (all 47) has a FULL admin overlay');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public'
       and policyname = any (select x || '_admin_read' from unnest(string_to_array(:'upgraded_csv', ',')) x)),
  0,
  'no read-only overlays remain on the 15 upgraded tables');

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and cmd='ALL'
       and policyname = any (select x || '_admin_all' from unnest(string_to_array(:'upgraded_csv', ',')) x)),
  array_length(string_to_array(:'upgraded_csv', ','), 1),
  'the 15 former read-only tables now carry a FULL admin overlay (owner override)');

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
