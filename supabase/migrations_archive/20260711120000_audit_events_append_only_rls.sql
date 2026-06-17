-- ════════════════════════════════════════════════════════════════════════════
--  20260711120000_audit_events_append_only_rls.sql
--
--  SECURITY HARDENING (P0) — make the audit_events evidence log tamper-proof.
--
--  THE GAP (verified 2026-05-29):
--  audit_events is documented "append-only" (baseline comment) and the web code
--  ASSUMES RLS gates it (lib/data/audit.ts: "RLS does the gate";
--  dashboardMetrics.ts: "RLS for super_admin grants SELECT … audit_events").
--  But NO migration ever enabled RLS or created a policy on it — so either the
--  live DB has RLS the migrations don't reproduce (environment drift), or the
--  table is wide open and any authenticated user could UPDATE/DELETE/forge audit
--  rows. For a platform whose entire thesis is tamper-evident audit, that is the
--  most important gap to close. This migration makes the posture EXPLICIT and
--  version-controlled so every environment is consistent.
--
--  WHY NOT FOREIGN KEYS (the audit's suggestion):
--  audit_events is an immutable, polymorphic (subject_table/subject_id) evidence
--  log with DENORMALIZED snapshots (actor_label, summary, delta). A
--  `job_id → jobs ON DELETE CASCADE` FK would DELETE audit history when a job is
--  removed — destroying evidence. FKs are intentionally absent; the snapshots are
--  the durable record. Integrity here means APPEND-ONLY + ANTI-FORGERY, not FKs.
--
--  DESIGN (safe-by-construction against every verified read/write path):
--   • INSERT (authenticated): WITH CHECK (actor_id = auth.uid()). The only
--     authenticated direct writers are client signals (clientReport approve /
--     request-revision) and inspector report-submit — all set actor_id to the
--     caller (verified). This preserves them and blocks forging an event as
--     another actor. SECURITY DEFINER functions + service_role BYPASS RLS, so
--     every system/trigger/edge-function audit write is unaffected.
--   • UPDATE / DELETE: no policy → denied under RLS, plus an explicit REVOKE of
--     the base grants. Append-only by construction. Nothing in the app or
--     migrations updates or deletes audit_events (verified).
--   • SELECT (authenticated): preserved as-is (USING true) for ZERO breakage of
--     the admin pages + per-job + per-org + self reads. Tightening non-admin
--     reads to own-jobs/own-org is a tracked follow-up (must be traced against
--     the org-scoped /client/structure read, where org_id lives in metadata
--     jsonb, before it can ship safely).
--   • RLS is NOT forced — table owner / service_role intentionally bypass so
--     definer-function audit writes keep working.
--
--  Idempotent. No data change. No schema change.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Append-only INSERT, attributed to the caller only.
DROP POLICY IF EXISTS audit_events_insert_self ON public.audit_events;
CREATE POLICY audit_events_insert_self
  ON public.audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- Reads preserved exactly as today (zero breakage). Confidentiality tightening
-- is a deliberate follow-up (see header).
DROP POLICY IF EXISTS audit_events_select_auth ON public.audit_events;
CREATE POLICY audit_events_select_auth
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (true);

-- Immutability: deny client UPDATE/DELETE at the grant level too (belt +
-- suspenders alongside the absent UPDATE/DELETE policies).
REVOKE UPDATE, DELETE ON public.audit_events FROM anon, authenticated;

COMMENT ON TABLE public.audit_events IS
  'Append-only audit trail. RLS: authenticated may INSERT only own-actor rows and SELECT; UPDATE/DELETE denied (immutable). SECURITY DEFINER fns + service_role bypass RLS for system writes. Baseline captured 2026-05-17.';

COMMIT;
