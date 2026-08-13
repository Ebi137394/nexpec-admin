-- ════════════════════════════════════════════════════════════════════════════
--  20260801424000_consent_audit_logs.sql
--
--  P0-3 fallout. Extending check-db-refs to scan supabase/functions (which it
--  never did) surfaced a table no migration creates:
--
--      supabase/functions/send-consent-receipt/index.ts:233
--          await supabase.from('consent_audit_logs').insert({ ... })
--                        .catch(err => console.error('Failed to log audit entry:', err));
--
--  Two things make this worse than an ordinary missing table:
--
--    1. It is a COMPLIANCE audit trail. CONSENT_MANAGEMENT_DEPLOYMENT.md §Audit
--       Logs documents it as the record of "all consent activities" and gives
--       operators queries to run against it — including one to find consent
--       receipts whose email delivery failed.
--
--    2. The write is .catch()-swallowed. A missing table does not raise, does
--       not 500, and does not appear in any dashboard. The function returns
--       success while recording nothing. The failure mode of a compliance log
--       that silently does not log is indistinguishable from one that works.
--
--  Classification per the P0-3 instruction: (A) genuinely missing canonical SQL.
--  Not whitelisted — created, with the shape the caller and the deployment doc
--  already agree on.
--
--  ── SHAPE ──────────────────────────────────────────────────────────────────
--  Taken from the single writer and the documented queries, nothing invented:
--      consent_id  -> legal_consents(id)      (the caller passes consentId)
--      action      -> text                    ('RECEIPT_GENERATED' today)
--      details     -> jsonb                   (queried as details->>'email_sent')
--      created_at  -> timestamptz             (documented ORDER BY / DELETE key)
--
--  ── SECURITY ───────────────────────────────────────────────────────────────
--  Consent records are personal legal evidence. RLS on, anon revoked, no
--  INSERT/UPDATE/DELETE grant to authenticated — the only writer is the
--  service-role Edge Function, and an audit row must never be editable by the
--  subject it describes. Admins read; nobody rewrites history.
--
--  Additive. Creates one new table. Touches no existing row and no existing
--  policy. IF NOT EXISTS throughout, because the loose-SQL history in this
--  repository means it may already have been created by hand in Production.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.consent_audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id  uuid NOT NULL REFERENCES public.legal_consents(id) ON DELETE CASCADE,
  action      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consent_audit_logs IS
  'Append-only audit trail of consent activity, written by the send-consent-receipt Edge Function (service_role). Documented in CONSENT_MANAGEMENT_DEPLOYMENT.md. Created by 20260801424000 after check-db-refs was extended to Edge Functions and found the writer had no table — the insert is .catch()-swallowed, so it had been failing silently. Never editable by the consent subject: an audit row that its subject can rewrite is not evidence.';

CREATE INDEX IF NOT EXISTS consent_audit_logs_consent_id_created_idx
  ON public.consent_audit_logs (consent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS consent_audit_logs_action_created_idx
  ON public.consent_audit_logs (action, created_at DESC);

ALTER TABLE public.consent_audit_logs ENABLE ROW LEVEL SECURITY;

-- `authenticated` must be in this REVOKE, not only PUBLIC and anon. The baseline
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO authenticated
-- (baseline:40921-40934) means this table is BORN with INSERT, UPDATE, DELETE and
-- TRUNCATE for authenticated, so revoking PUBLIC/anon and then granting SELECT
-- added nothing and left consent history rewritable and erasable by any signed-in
-- session. This migration's own self-test caught it on the first clean-database
-- run. Revoke everything first, then re-grant exactly the read.
--
-- Consent history is append-only evidence: only service_role writes it, and it
-- does so through the INSERT granted below.
REVOKE ALL ON TABLE public.consent_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.consent_audit_logs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.consent_audit_logs TO service_role;

-- Admin-only read. No INSERT/UPDATE/DELETE policy exists at all, so no
-- authenticated principal can write or erase an audit row through PostgREST —
-- the absence is the control, matching the 402000 lesson.
DROP POLICY IF EXISTS consent_audit_logs_admin_read ON public.consent_audit_logs;
CREATE POLICY consent_audit_logs_admin_read
  ON public.consent_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.nx_is_admin());

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.consent_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: consent_audit_logs was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'consent_audit_logs' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is not enabled on consent_audit_logs';
  END IF;

  IF has_table_privilege('anon', 'public.consent_audit_logs', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can read consent audit logs';
  END IF;

  -- History must not be rewritable by any authenticated principal.
  IF has_table_privilege('authenticated', 'public.consent_audit_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.consent_audit_logs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.consent_audit_logs', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can write or erase consent audit history';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.consent_audit_logs', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: service_role cannot insert — the Edge Function stays silently broken';
  END IF;

  IF to_regclass('public.legal_consents') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: legal_consents must exist before 424000';
  END IF;
END
$selftest$;

COMMIT;
