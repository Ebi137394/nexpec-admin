-- ════════════════════════════════════════════════════════════════════════════
--  20260801262000_backfill_platform_consent_ledger.sql
--
--  The onboarding "Choose your stance" screen records ToS + Privacy consent in
--  profiles.terms_accepted_at (the legal gateway). The in-app Terms & Privacy
--  cards + doc viewer read the per-document ledger legal_document_acceptances.
--  choose-role now mirrors new acceptances into that ledger; this backfills
--  EXISTING users who accepted at onboarding BEFORE that wiring, so their cards
--  show "Accepted" and the viewer skips the Accept CTA (no re-acceptance ask).
--
--  Records TOS-001 + PRIV-001 at v1.0 (the platform-tier docs the onboarding
--  consent line names) with accepted_at = the user's real terms_accepted_at.
--  Idempotent via the (user_id, document_id, document_version, language) unique
--  constraint → ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.legal_document_acceptances
  (user_id, document_id, document_version, language, accepted_at, role_at_acceptance)
SELECT p.id, d.document_id, '1.0', 'en', p.terms_accepted_at, p.role
FROM public.profiles p
CROSS JOIN (VALUES ('TOS-001'), ('PRIV-001')) AS d(document_id)
WHERE p.terms_accepted_at IS NOT NULL
ON CONFLICT (user_id, document_id, document_version, language) DO NOTHING;

DO $test$
DECLARE
  v_pending int;
BEGIN
  -- Every consented user should now have both platform-doc rows.
  SELECT count(*) INTO v_pending
  FROM public.profiles p
  CROSS JOIN (VALUES ('TOS-001'), ('PRIV-001')) AS d(document_id)
  WHERE p.terms_accepted_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.legal_document_acceptances a
       WHERE a.user_id = p.id
         AND a.document_id = d.document_id
         AND a.document_version = '1.0'
         AND a.language = 'en'
    );
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % consented user/doc pairs still missing a ledger row', v_pending;
  END IF;
  RAISE NOTICE 'platform consent ledger backfilled: all onboarding-consented users now have TOS-001 + PRIV-001 acceptance rows.';
END
$test$;

COMMIT;
