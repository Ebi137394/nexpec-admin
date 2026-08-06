-- ════════════════════════════════════════════════════════════════════════════
--  provable_ai_binding_test.sql — pgTAP proof of the server-enforced
--  model → detection binding (20260715_provable_ai_detection_binding).
--
--  Proves pi_record_ai_detection records a detection ONLY when it references a
--  PUBLISHED, SIGNED, STUDENT artifact in the registry whose sha256 matches —
--  and rejects every other case. This is the authoritative DB counterpart to
--  the cryptographic chain proven offline by scripts/ml/prove-loop.mjs.
--
--  Run:  supabase test db   (pg_prove / pgTAP)
--
--  Isolation: session_replication_role='replica' lets us seed a job + registry
--  rows without dragging in auth.users/profiles FKs. Authorization is satisfied
--  via the job-contractor branch (jobs.contractor_id = the JWT subject), so no
--  admin/profile seed is needed. Everything rolls back.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
-- pgTAP must be installed by the suite itself. Every suite here ends in
-- ROLLBACK, which also rolls back `create extension`, so pgTAP never persists
-- between files — each one has to create it. This file was the only pgTAP suite
-- in the repo missing the line, so it passed only when something else happened
-- to have installed pgTAP first, and failed with
-- `function plan(integer) does not exist` on a clean database.
-- Canonical form, identical to the other 12 suites:
create extension if not exists pgtap;

SELECT plan(7);

SET LOCAL session_replication_role = 'replica';  -- FK-free seeding

-- Act as a contractor (uid = the job's contractor_id) so authz passes.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true
);

-- ── Seed: one job owned by the test contractor ──────────────────────────────
INSERT INTO public.jobs (id, title, contractor_id, client_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'Provable-AI test job',
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333');

-- ── Seed: registry artifacts (the REAL signed sha is reused from the harness) ──
-- M1: the valid one — published, student, signed, matching sha.
INSERT INTO public.model_artifacts
  (kind, slug, version, tier, runtime, status, storage_path, size_bytes, sha256, signature, signature_alg, signing_key_id)
VALUES
  ('vision_defect','corrosion-detector',1,'student','tflite','published',
   'vision_defect/corrosion-detector/v1/mobilenet_v2.tflite', 3610798,
   '7aad0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776',
   'MNLk8U3y0llUyLc63VEsrUTeI8W44luctlpWJnSIRONla9gmRJ5SeXOmbUG01tTnCMsiJBtk+1yObpwMDY1ODQ==',
   'ed25519','nexpec-model-2026-v1');

-- M2: a DRAFT (unpublished) model — must be refused.
INSERT INTO public.model_artifacts
  (kind, slug, version, tier, runtime, status, storage_path, size_bytes, sha256, signature, signature_alg, signing_key_id)
VALUES
  ('vision_defect','draft-detector',1,'student','tflite','draft',
   'vision_defect/draft-detector/v1/m.tflite', 100,
   'aaaa0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776',
   'sig','ed25519','nexpec-model-2026-v1');

-- M3: a PUBLISHED but UNSIGNED model — must be refused.
INSERT INTO public.model_artifacts
  (kind, slug, version, tier, runtime, status, storage_path, size_bytes, sha256, signature, signature_alg, signing_key_id)
VALUES
  ('vision_defect','unsigned-detector',1,'student','tflite','published',
   'vision_defect/unsigned-detector/v1/m.tflite', 100,
   'bbbb0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776',
   NULL, NULL, NULL);

-- ── 1) ACCEPT: valid published + signed + student + matching sha ────────────
SELECT lives_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'surface corrosion', p_confidence => 0.91,
       p_model_slug => 'corrosion-detector', p_model_version => 1,
       p_model_sha256 => '7aad0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776',
       p_accepted => true) $$,
  'records a detection for a published, signed, student model with matching sha256');

-- ── 2) the accepted detection actually landed, sha normalized ───────────────
SELECT is(
  (SELECT count(*)::int FROM public.ai_detections
     WHERE model_slug = 'corrosion-detector'
       AND model_sha256 = '7aad0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776'
       AND accepted_by_human),
  1, 'the accepted detection is persisted and bound to the signed model bytes');

-- ── 3) REJECT: null model_sha256 (binding is mandatory) ─────────────────────
SELECT throws_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'x', p_confidence => 0.5,
       p_model_slug => 'corrosion-detector', p_model_version => 1,
       p_model_sha256 => NULL) $$,
  '23514', NULL, 'rejects a detection with no model_sha256');

-- ── 4) REJECT: model not in the registry ────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'x', p_confidence => 0.5,
       p_model_slug => 'ghost-model', p_model_version => 9,
       p_model_sha256 => '7aad0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776') $$,
  '42501', NULL, 'rejects a detection attributed to an unregistered model');

-- ── 5) REJECT: sha256 does not match the registered signed bytes ────────────
SELECT throws_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'x', p_confidence => 0.5,
       p_model_slug => 'corrosion-detector', p_model_version => 1,
       p_model_sha256 => 'deadbeef00000000000000000000000000000000000000000000000000000000') $$,
  '23514', NULL, 'rejects a model-bytes (sha256) mismatch');

-- ── 6) REJECT: model exists but is not published (draft) ────────────────────
SELECT throws_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'x', p_confidence => 0.5,
       p_model_slug => 'draft-detector', p_model_version => 1,
       p_model_sha256 => 'aaaa0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776') $$,
  '42501', NULL, 'rejects a detection from an unpublished (draft) model');

-- ── 7) REJECT: published but unsigned model cannot attest ───────────────────
SELECT throws_ok(
  $$ SELECT public.pi_record_ai_detection(
       p_job_id => '22222222-2222-2222-2222-222222222222'::uuid,
       p_defect_id => 'CORROSION', p_label => 'x', p_confidence => 0.5,
       p_model_slug => 'unsigned-detector', p_model_version => 1,
       p_model_sha256 => 'bbbb0c74c5e3c06e5eb3c827e13304fdd68a83da6087d92ee169c24ff9fd4776') $$,
  '42501', NULL, 'rejects a detection from a published but UNSIGNED model');

SELECT finish();
ROLLBACK;
