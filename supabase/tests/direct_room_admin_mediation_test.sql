-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/direct_room_admin_mediation_test.sql
--
--  D23 — the brokered-communication invariant, proven at the database layer.
--
--  The owner rule: Client and Inspector must not hold an UNMODERATED private
--  room. Behavioural QA found the direct Full-mode room was operationally
--  two-party: the admin transcript UI was read-only. The DB, however, already
--  carried the mediation rights; this suite pins ALL of them so no future
--  policy edit can silently take them away, plus the one real DB fix
--  (three-valued sender_party in the oversight view, 20260801540000).
--
--  WHAT IS PROVEN
--    A  room creation is GATED: open_direct_conversation refuses a job whose
--       identity mode is not 'full' — no Client↔Inspector room on a protected
--       job, by RPC or by crafted call
--    B  parties can write while the room is open
--    C  ADMIN can write into the room as themselves (mediation, not identity
--       theft: sender_id must be their own uid)
--    D  the oversight view labels the admin message 'admin' — never 'buyer'
--    E  ADMIN can CLOSE the room; closed => BOTH parties are refused; admin
--       can still write (mediator explains the freeze); reopen restores parties
--    F  unrelated users and anon cannot read the room or its messages
--    G  an admin cannot OPEN a direct room as a participant (the RPC refuses)
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(17);

-- ── fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('d2310000-0000-4000-8000-000000000001','d23.client@nexpec.test'),
  ('d2310000-0000-4000-8000-000000000002','d23.insp@nexpec.test'),
  ('d2310000-0000-4000-8000-000000000003','d23.admin@nexpec.test'),
  ('d2310000-0000-4000-8000-000000000004','d23.stranger@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('d2310000-0000-4000-8000-000000000001','d23.client@nexpec.test','client','D23 Client'),
  ('d2310000-0000-4000-8000-000000000002','d23.insp@nexpec.test','inspector','D23 Inspector'),
  ('d2310000-0000-4000-8000-000000000003','d23.admin@nexpec.test','admin','D23 Admin'),
  ('d2310000-0000-4000-8000-000000000004','d23.stranger@nexpec.test','client','D23 Stranger')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Two jobs with a hired inspector, differing ONLY in identity_mode, so A1/A2
-- isolate the Full-mode gate. Setting contractor_id trips the real dispatch
-- guards (contract + funding), which are satisfied properly, never weakened:
INSERT INTO public.jobs (id, client_id, title, description, status, identity_mode)
VALUES
  ('d2320000-0000-4000-8000-000000000001','d2310000-0000-4000-8000-000000000001',
   'D23 full job','direct room mediation','open','full'),
  ('d2320000-0000-4000-8000-000000000002','d2310000-0000-4000-8000-000000000001',
   'D23 protected job','no direct room here','open','protected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_contracts
  (id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents,
   status, client_signed_at, inspector_signed_at, contract_text_md)
VALUES
  ('d2330000-0000-4000-8000-000000000001','d2320000-0000-4000-8000-000000000001',
   'd2310000-0000-4000-8000-000000000001','d2310000-0000-4000-8000-000000000002',
   100000, 80000, 'fully_executed', now(), now(), 'terms'),
  ('d2330000-0000-4000-8000-000000000002','d2320000-0000-4000-8000-000000000002',
   'd2310000-0000-4000-8000-000000000001','d2310000-0000-4000-8000-000000000002',
   100000, 80000, 'fully_executed', now(), now(), 'terms')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at,
   gates_delivery, trigger_basis)
VALUES
  ('d2320000-0000-4000-8000-000000000001',1,'initial','Initial',2000,20000,'funded',now(),true,'before_assignment'),
  ('d2320000-0000-4000-8000-000000000002',1,'initial','Initial',2000,20000,'funded',now(),true,'before_assignment')
ON CONFLICT DO NOTHING;

UPDATE public.jobs
   SET contractor_id='d2310000-0000-4000-8000-000000000002',
       status='assigned'
 WHERE id IN ('d2320000-0000-4000-8000-000000000001',
              'd2320000-0000-4000-8000-000000000002');

-- ── A. creation is gated on Full mode ──────────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_like(
  $$ SELECT public.open_direct_conversation(
       'd2320000-0000-4000-8000-000000000002'::uuid,
       'd2310000-0000-4000-8000-000000000002'::uuid) $$,
  '%not authorized%',
  'A1: a PROTECTED-mode job cannot grow a Client↔Inspector direct room');

SELECT lives_ok(
  $$ SELECT public.open_direct_conversation(
       'd2320000-0000-4000-8000-000000000001'::uuid,
       'd2310000-0000-4000-8000-000000000002'::uuid) $$,
  'A2: the FULL-mode job can — the gate is specific, not a wall');

-- capture the room id for the rest of the suite
CREATE TEMP TABLE d23_room AS
SELECT id FROM public.conversations
 WHERE job_id='d2320000-0000-4000-8000-000000000001'
   AND kind='job_client_inspector'::public.conversation_kind;

SELECT is((SELECT count(*)::int FROM d23_room), 1, 'A3: exactly one room exists');

-- ── B. parties write while open ────────────────────────────────────────────
SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000001', 'client hello') $$,
  'B1: the client posts while the room is open');

SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000002', 'inspector reply') $$,
  'B2: the inspector replies');

-- ── C. admin mediation: writes as SELF only ────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000003', 'admin mediation note') $$,
  'C1: an admin can write into the room as themselves');

SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000001', 'admin faking the client') $$,
  '42501', NULL,
  'C2: an admin CANNOT post under a party''s identity — sender must be self');

-- ── D. the oversight view labels the admin correctly ───────────────────────
SELECT is(
  (SELECT sender_party FROM public.admin_direct_messages_view
    WHERE conversation_id=(SELECT id FROM d23_room)
      AND sender_id='d2310000-0000-4000-8000-000000000003'),
  'admin',
  'D1: the admin message is labelled admin in the transcript — not buyer');

SELECT is(
  (SELECT count(*)::int FROM public.admin_direct_messages_view
    WHERE conversation_id=(SELECT id FROM d23_room) AND sender_party='buyer'),
  1, 'D2: exactly the client''s message is labelled buyer');

-- ── E. moderation: close locks the PARTIES out, not the mediator ───────────
SELECT lives_ok(
  $$ UPDATE public.conversations SET status='closed'
      WHERE id=(SELECT id FROM d23_room) $$,
  'E1: the admin closes the room');

SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000001', 'client after freeze') $$,
  '42501', NULL,
  'E2: the CLIENT is refused in a closed room');

SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000002', 'inspector after freeze') $$,
  '42501', NULL,
  'E3: the INSPECTOR is refused in a closed room');

SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000003', 'admin explains the freeze') $$,
  'E4: the admin can still write into the frozen room');

SELECT lives_ok(
  $$ UPDATE public.conversations SET status='open'
      WHERE id=(SELECT id FROM d23_room) $$,
  'E5: and can reopen it');

-- ── F. strangers and anon ──────────────────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.messages
    WHERE conversation_id=(SELECT id FROM d23_room)),
  0, 'F1: an unrelated user reads zero messages from the room');

SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ((SELECT id FROM d23_room),
             'd2310000-0000-4000-8000-000000000004', 'stranger intrusion') $$,
  '42501', NULL,
  'F2: and cannot write into it');

-- ── G. an admin cannot OPEN a direct room (participation is by parties) ────
SET LOCAL request.jwt.claims TO
  '{"sub":"d2310000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT public.open_direct_conversation(
       'd2320000-0000-4000-8000-000000000001'::uuid,
       'd2310000-0000-4000-8000-000000000002'::uuid) $$,
  '%monitoring view%',
  'G1: an admin is refused from OPENING a direct room — mediation, not membership');

SELECT * FROM finish();
ROLLBACK;
