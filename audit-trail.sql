-- ════════════════════════════════════════════════════════════════════════════
--  audit-trail.sql
--  NEXPEC — Industrial Black Box (Patch 1 / v1)
--
--  Captures every consequential mutation on jobs, applications, contracts,
--  and payout_requests into a single immutable `audit_events` table.
--
--  Architecture (per blueprint, approved):
--    • SQL triggers as the bypass-proof ground truth (this file).
--    • App-layer SET LOCAL `app.actor_intent` for the WHY (RPC below).
--    • pg_notify channel for future Edge-Function fan-out.
--    • RLS gates reads to parties of the affected job; admins see all.
--    • View `audit_events_public` masks sensitive metadata for non-admins.
--    • Hash chain (prev_hash/content_hash) deferred to v2 per spec.
--
--  Idempotent. Wrapped in a transaction. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 1 — TABLE + INDEXES
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL    DEFAULT now(),

  -- WHAT happened
  event_type      text        NOT NULL,                  -- "job.price_updated", "contract.signed", …
  severity        text        NOT NULL    DEFAULT 'info',

  -- WHO did it (snapshotted — survives later role/name changes)
  actor_id        uuid,                                  -- nullable for system-initiated events
  actor_role      text,                                  -- "super_admin" | "client" | "agency" | "inspector" | "system"
  actor_label     text,                                  -- display name at event time

  -- WHICH ROW was affected
  subject_table   text        NOT NULL,                  -- "jobs" | "applications" | "contracts" | "payout_requests"
  subject_id      uuid        NOT NULL,
  job_id          uuid,                                  -- denormalized for fast per-job timelines

  -- THE CONTENT
  summary         text        NOT NULL,                  -- pre-rendered human-readable line
  delta           jsonb       NOT NULL    DEFAULT '{}'::jsonb,    -- { before: {changed cols}, after: {changed cols} }
  metadata        jsonb       NOT NULL    DEFAULT '{}'::jsonb,    -- { intent, op, ip, ua, ai_label, … }

  -- Optional grouping of events from one logical user action
  correlation_id  uuid,

  CONSTRAINT audit_events_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

COMMENT ON TABLE public.audit_events IS
  'NEXPEC Industrial Black Box. Append-only, RLS-gated, trigger-populated. Single source of truth for all consequential mutations across jobs, applications, contracts, and payout_requests.';

-- Indexes designed for the three primary access patterns.
CREATE INDEX IF NOT EXISTS audit_events_job_timeline_idx
  ON public.audit_events (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON public.audit_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_critical_idx
  ON public.audit_events (created_at DESC)
  WHERE severity = 'critical';

CREATE INDEX IF NOT EXISTS audit_events_event_type_idx
  ON public.audit_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_subject_idx
  ON public.audit_events (subject_table, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON public.audit_events (correlation_id, created_at)
  WHERE correlation_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 2 — RLS POLICIES
-- ════════════════════════════════════════════════════════════════════════════
-- Reads: super_admin sees all; parties to a job see that job's events.
-- Writes: NOBODY. Only the SECURITY DEFINER trigger function (owned by
-- postgres, which bypasses RLS) can insert. UPDATE and DELETE are
-- forbidden — this table is append-only by design.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies so this file is idempotent.
DROP POLICY IF EXISTS audit_events_select_admin   ON public.audit_events;
DROP POLICY IF EXISTS audit_events_select_parties ON public.audit_events;
DROP POLICY IF EXISTS audit_events_no_insert      ON public.audit_events;
DROP POLICY IF EXISTS audit_events_no_update      ON public.audit_events;
DROP POLICY IF EXISTS audit_events_no_delete      ON public.audit_events;

-- Admins read everything.
CREATE POLICY audit_events_select_admin
  ON public.audit_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Parties to a job (inspector / client / agency) read that job's events.
CREATE POLICY audit_events_select_parties
  ON public.audit_events
  FOR SELECT
  USING (
    job_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = audit_events.job_id
        AND (
          j.contractor_id = auth.uid()    -- inspector
          OR j.client_id  = auth.uid()    -- client / enterprise
          OR j.agency_id  = auth.uid()    -- agency
        )
    )
  );

-- No INSERT / UPDATE / DELETE policies → those operations are denied for
-- every non-bypass role. The trigger function is SECURITY DEFINER and
-- owned by postgres, which bypasses RLS — that's how rows get in.


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 3 — MASKED VIEW FOR NON-ADMIN READS
-- ════════════════════════════════════════════════════════════════════════════
-- security_invoker=true makes the underlying table's RLS apply when the
-- view is queried, so the view inherits row-level gating automatically.
-- Column-level masking strips sensitive metadata keys (ip, ua, admin notes,
-- AI labels) so they never leave the DB to non-admin clients.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_events_public
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  event_type,
  severity,
  actor_id,
  actor_role,
  actor_label,
  subject_table,
  subject_id,
  job_id,
  summary,
  delta,
  -- Drop sensitive top-level keys; keep public ones (intent, op, …)
  (metadata - ARRAY['ip', 'ua', 'ai_label', 'admin_notes']) AS metadata,
  correlation_id
FROM public.audit_events;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. RLS inherited from base table; column masking strips ip/ua/ai_label/admin_notes from metadata.';


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 4 — INTENT INJECTION RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Call this from INSIDE another RPC (same transaction) right before a
-- mutation to annotate the upcoming audit event with the WHY.
--
-- Example pattern (in a wrapper RPC like admin_adjust_job_price):
--   PERFORM audit_set_intent('Admin uplift — fast-track request');
--   UPDATE jobs SET client_price_cents = $2 WHERE id = $1;
--
-- The trigger reads `app.actor_intent` via current_setting() and writes
-- it into metadata.intent. is_local=true makes it transaction-scoped, so
-- it never leaks across pooled connections.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.audit_set_intent(p_intent text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.actor_intent', COALESCE(p_intent, ''), true);
END;
$$;

COMMENT ON FUNCTION public.audit_set_intent(text) IS
  'Sets the actor_intent GUC for the current transaction. The audit_capture trigger reads this when writing the next audit event. Must be called in the same transaction as the mutation it annotates.';

-- Same idea for grouping multiple events under one logical user action.
CREATE OR REPLACE FUNCTION public.audit_set_correlation(p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config(
    'app.correlation_id',
    COALESCE(p_correlation_id::text, ''),
    true
  );
END;
$$;

COMMENT ON FUNCTION public.audit_set_correlation(uuid) IS
  'Sets a correlation_id GUC for the current transaction; all audit events written downstream inherit it. Use for multi-step user actions.';


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 5 — THE TRIGGER FUNCTION
-- ════════════════════════════════════════════════════════════════════════════
-- Generic capture function attached to all instrumented tables. Resolves
-- the actor, snapshots their role + label, computes a minimal diff,
-- classifies the event_type and severity based on which columns changed,
-- pre-renders the human-readable summary, and inserts one row.
--
-- SECURITY DEFINER + owned by postgres = bypasses RLS for the INSERT.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.audit_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id       uuid;
  v_actor_role     text;
  v_actor_label    text;
  v_event_type     text;
  v_severity       text := 'info';
  v_summary        text;
  v_delta          jsonb := '{}'::jsonb;
  v_job_id         uuid;
  v_subject_id     uuid;
  v_intent         text;
  v_correlation    uuid;
  v_changed_keys   text[];
  v_before_full    jsonb;
  v_after_full     jsonb;
  v_before_slim    jsonb;
  v_after_slim     jsonb;
BEGIN
  -- ── 1. Resolve actor ───────────────────────────────────────────────
  -- Prefer Supabase's auth.uid() (JWT); fall back to app-set GUC for
  -- system-initiated mutations (Edge Functions, scheduled jobs, etc).
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NULL THEN
    v_actor_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  END IF;

  -- Snapshot the actor's role + display label.
  IF v_actor_id IS NOT NULL THEN
    SELECT
      p.role,
      COALESCE(
        NULLIF(p.company_name, ''),
        NULLIF(p.full_name, ''),
        NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
        NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''),
        'User'
      )
    INTO v_actor_role, v_actor_label
    FROM public.profiles p
    WHERE p.id = v_actor_id;

    -- Profile join may miss (deleted user, race) — fall back gracefully.
    v_actor_role  := COALESCE(v_actor_role, 'unknown');
    v_actor_label := COALESCE(v_actor_label, 'User');
  ELSE
    v_actor_role  := 'system';
    v_actor_label := 'System';
  END IF;

  -- ── 2. GUC-supplied context ────────────────────────────────────────
  v_intent      := NULLIF(current_setting('app.actor_intent',  true), '');
  v_correlation := NULLIF(current_setting('app.correlation_id', true), '')::uuid;

  -- ── 3. Subject + job ids ───────────────────────────────────────────
  IF TG_TABLE_NAME = 'jobs' THEN
    v_subject_id := COALESCE(NEW.id, OLD.id);
    v_job_id     := v_subject_id;
  ELSIF TG_TABLE_NAME IN ('applications', 'contracts', 'payout_requests') THEN
    v_subject_id := COALESCE(NEW.id, OLD.id);
    v_job_id     := COALESCE(
                      (CASE WHEN TG_OP <> 'DELETE' THEN (to_jsonb(NEW)->>'job_id')::uuid END),
                      (CASE WHEN TG_OP <> 'INSERT' THEN (to_jsonb(OLD)->>'job_id')::uuid END)
                    );
  ELSE
    v_subject_id := COALESCE(NEW.id, OLD.id);
    v_job_id     := NULL;
  END IF;

  -- ── 4. Build delta + classify event ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    v_after_full := to_jsonb(NEW);
    v_delta      := jsonb_build_object('after', v_after_full);
    v_event_type := TG_TABLE_NAME || '.created';
    v_summary    := 'Created ' || TG_TABLE_NAME;

    IF TG_TABLE_NAME = 'jobs' THEN
      v_summary := 'Job posted: ' || COALESCE(NEW.title, 'Untitled');
    ELSIF TG_TABLE_NAME = 'applications' THEN
      v_summary := 'Application submitted';
    ELSIF TG_TABLE_NAME = 'contracts' THEN
      v_summary := 'Contract created';
    ELSIF TG_TABLE_NAME = 'payout_requests' THEN
      v_summary := 'Payout request opened';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    v_before_full := to_jsonb(OLD);
    v_after_full  := to_jsonb(NEW);

    -- Diff: which top-level keys actually changed?
    SELECT array_agg(key ORDER BY key)
    INTO v_changed_keys
    FROM jsonb_each(v_after_full) e(key, val)
    WHERE v_before_full -> e.key IS DISTINCT FROM v_after_full -> e.key
      AND e.key NOT IN ('updated_at');  -- ignore mechanical timestamps

    -- No meaningful change → drop this event entirely.
    IF v_changed_keys IS NULL OR array_length(v_changed_keys, 1) = 0 THEN
      RETURN NEW;
    END IF;

    -- Minimal before/after — only the keys that actually changed.
    SELECT jsonb_object_agg(k, v_before_full -> k)
      INTO v_before_slim
      FROM unnest(v_changed_keys) k;
    SELECT jsonb_object_agg(k, v_after_full -> k)
      INTO v_after_slim
      FROM unnest(v_changed_keys) k;
    v_delta := jsonb_build_object('before', v_before_slim, 'after', v_after_slim);

    -- Per-table event classification ------------------------------------
    IF TG_TABLE_NAME = 'jobs' THEN
      IF 'status' = ANY(v_changed_keys) THEN
        v_event_type := 'job.status_changed';
        v_summary    := 'Status: ' || OLD.status || ' → ' || NEW.status;
        IF NEW.status IN ('disputed', 'cancelled') THEN
          v_severity := 'critical';
        ELSIF NEW.status = 'completed' THEN
          v_severity := 'info';
          v_event_type := 'job.completed';
          v_summary    := 'Job marked completed';
        END IF;

      ELSIF 'contractor_id' = ANY(v_changed_keys) THEN
        IF OLD.contractor_id IS NULL AND NEW.contractor_id IS NOT NULL THEN
          v_event_type := 'job.assigned';
          v_summary    := 'Inspector assigned';
        ELSIF OLD.contractor_id IS NOT NULL AND NEW.contractor_id IS NULL THEN
          v_event_type := 'job.unassigned';
          v_summary    := 'Inspector removed';
          v_severity   := 'warning';
        ELSE
          v_event_type := 'job.reassigned';
          v_summary    := 'Inspector reassigned';
          v_severity   := 'warning';
        END IF;

      ELSIF v_changed_keys && ARRAY[
              'client_price_cents','payout_amount_cents',
              'platform_spread_cents','inspector_payout_cents'
            ]::text[] THEN
        v_event_type := 'job.price_updated';
        v_severity   := 'warning';
        IF 'client_price_cents' = ANY(v_changed_keys) THEN
          v_summary := 'Client price: $'
                    || to_char((COALESCE(OLD.client_price_cents, 0))::numeric / 100, 'FM999G999G999D00')
                    || ' → $'
                    || to_char((COALESCE(NEW.client_price_cents, 0))::numeric / 100, 'FM999G999G999D00');
        ELSE
          v_summary := 'Pricing updated';
        END IF;

      ELSIF 'scheduled_date' = ANY(v_changed_keys) THEN
        v_event_type := 'job.scheduled';
        v_summary    := 'Schedule updated';

      ELSE
        v_event_type := 'job.updated';
        v_summary    := 'Job fields updated: ' || array_to_string(v_changed_keys, ', ');
      END IF;

    ELSIF TG_TABLE_NAME = 'applications' THEN
      IF 'status' = ANY(v_changed_keys) THEN
        IF NEW.status = 'accepted' THEN
          v_event_type := 'application.accepted';
          v_summary    := 'Application accepted';
        ELSIF NEW.status = 'rejected' THEN
          v_event_type := 'application.rejected';
          v_summary    := 'Application rejected';
        ELSE
          v_event_type := 'application.updated';
          v_summary    := 'Application status: ' || OLD.status || ' → ' || NEW.status;
        END IF;
      ELSE
        v_event_type := 'application.updated';
        v_summary    := 'Application fields updated';
      END IF;

    ELSIF TG_TABLE_NAME = 'contracts' THEN
      IF 'signed_at' = ANY(v_changed_keys)
         AND OLD.signed_at IS NULL
         AND NEW.signed_at IS NOT NULL THEN
        v_event_type := 'contract.signed';
        v_summary    := 'Contract signed';
        v_severity   := 'critical';
      ELSIF 'status' = ANY(v_changed_keys) AND NEW.status = 'terminated' THEN
        v_event_type := 'contract.terminated';
        v_summary    := 'Contract terminated';
        v_severity   := 'critical';
      ELSE
        v_event_type := 'contract.updated';
        v_summary    := 'Contract fields updated';
      END IF;

    ELSIF TG_TABLE_NAME = 'payout_requests' THEN
      IF 'status' = ANY(v_changed_keys) THEN
        IF NEW.status = 'paid' THEN
          v_event_type := 'payout_request.paid';
          v_summary    := 'Payout paid';
          v_severity   := 'critical';
        ELSIF NEW.status = 'approved' THEN
          v_event_type := 'payout_request.approved';
          v_summary    := 'Payout approved';
          v_severity   := 'warning';
        ELSIF NEW.status = 'failed' THEN
          v_event_type := 'payout_request.failed';
          v_summary    := 'Payout failed';
          v_severity   := 'critical';
        ELSE
          v_event_type := 'payout_request.updated';
          v_summary    := 'Payout status: ' || OLD.status || ' → ' || NEW.status;
        END IF;
      ELSE
        v_event_type := 'payout_request.updated';
        v_summary    := 'Payout fields updated';
      END IF;

    ELSE
      v_event_type := TG_TABLE_NAME || '.updated';
      v_summary    := TG_TABLE_NAME || ' updated: ' || array_to_string(v_changed_keys, ', ');
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    v_before_full := to_jsonb(OLD);
    v_delta       := jsonb_build_object('before', v_before_full);
    v_event_type  := TG_TABLE_NAME || '.deleted';
    v_summary     := TG_TABLE_NAME || ' deleted';
    v_severity    := 'critical';  -- deletes are always notable
  END IF;

  -- ── 5. Write the event ────────────────────────────────────────────
  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id,   actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    v_event_type, v_severity,
    v_actor_id,   v_actor_role, v_actor_label,
    TG_TABLE_NAME, v_subject_id, v_job_id,
    v_summary, v_delta,
    jsonb_build_object(
      'intent',       v_intent,
      'op',           TG_OP,
      'changed_keys', to_jsonb(v_changed_keys)
    ),
    v_correlation
  );

  -- ── 6. Fan-out signal for Edge Functions / AI hooks ───────────────
  PERFORM pg_notify(
    'audit_event_emitted',
    jsonb_build_object(
      'event_type', v_event_type,
      'severity',   v_severity,
      'job_id',     v_job_id,
      'actor_id',   v_actor_id
    )::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_capture() IS
  'Generic audit trigger. Resolves actor via auth.uid(), reads intent/correlation from app.* GUCs, diffs OLD vs NEW, classifies the event by which columns changed, and inserts one row into audit_events. Owned by postgres so SECURITY DEFINER bypasses RLS.';


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 6 — TRIGGER ATTACHMENTS
-- ════════════════════════════════════════════════════════════════════════════
-- Attach the generic capture function to every instrumented table.
-- Wrapped in DO blocks with information_schema checks so the migration
-- works whether or not contracts / payout_requests exist yet.
-- ════════════════════════════════════════════════════════════════════════════

-- jobs (always exists)
DROP TRIGGER IF EXISTS audit_capture_trigger ON public.jobs;
CREATE TRIGGER audit_capture_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_capture();

-- applications (always exists — used by inspector job feed)
DROP TRIGGER IF EXISTS audit_capture_trigger ON public.applications;
CREATE TRIGGER audit_capture_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_capture();

-- contracts (conditional — table may not exist yet on all envs)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contracts'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_capture_trigger ON public.contracts';
    EXECUTE 'CREATE TRIGGER audit_capture_trigger
             AFTER INSERT OR UPDATE OR DELETE ON public.contracts
             FOR EACH ROW EXECUTE FUNCTION public.audit_capture()';
  ELSE
    RAISE NOTICE '[audit-trail] table public.contracts not found — trigger skipped.';
  END IF;
END $$;

-- payout_requests (conditional)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payout_requests'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_capture_trigger ON public.payout_requests';
    EXECUTE 'CREATE TRIGGER audit_capture_trigger
             AFTER INSERT OR UPDATE OR DELETE ON public.payout_requests
             FOR EACH ROW EXECUTE FUNCTION public.audit_capture()';
  ELSE
    RAISE NOTICE '[audit-trail] table public.payout_requests not found — trigger skipped.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 7 — GRANTS
-- ════════════════════════════════════════════════════════════════════════════

-- The trigger function does not need to be callable by normal users —
-- it only runs via triggers. Lock it down.
REVOKE EXECUTE ON FUNCTION public.audit_capture() FROM PUBLIC;

-- Intent + correlation setters: callable from any authenticated RPC.
GRANT EXECUTE ON FUNCTION public.audit_set_intent(text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_set_correlation(uuid)    TO authenticated;

-- Reads. RLS does the row-level gating; the view also strips sensitive
-- metadata for non-admin readers.
GRANT SELECT ON public.audit_events        TO authenticated;
GRANT SELECT ON public.audit_events_public TO authenticated;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
--  SMOKE TESTS — run after the COMMIT to verify the pipeline works.
--  All commented out so the migration itself is side-effect free.
-- ════════════════════════════════════════════════════════════════════════════

-- A. Table + indexes landed
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'audit_events'
-- ORDER BY ordinal_position;

-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'audit_events' ORDER BY indexname;

-- B. Triggers attached
-- SELECT event_object_table, trigger_name, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_name = 'audit_capture_trigger'
-- ORDER BY event_object_table;

-- C. Fire a real event end-to-end (use a sandbox row id; this WILL write).
-- UPDATE public.jobs
-- SET    status = status   -- no-op update; trigger should NOT fire (no change)
-- WHERE  id = '<some-job-id>';
--
-- UPDATE public.jobs
-- SET    title = title || ' '   -- forces a real diff
-- WHERE  id = '<some-job-id>';
--
-- SELECT created_at, event_type, severity, actor_role, actor_label, summary
-- FROM   public.audit_events
-- WHERE  job_id = '<some-job-id>'
-- ORDER BY created_at DESC
-- LIMIT 5;

-- D. RLS smoke — as a non-admin user, you should only see your own jobs' events.
-- (Sign in as an inspector in the app, then run from their session:)
-- SELECT count(*) FROM public.audit_events;       -- only their jobs' events
-- SELECT count(*) FROM public.audit_events_public;-- same count, masked metadata

-- E. Intent injection — wrap a mutation in an RPC that sets intent first.
-- (Example RPC, NOT created here — only the pattern shown.)
-- CREATE FUNCTION admin_adjust_job_price(p_job_id uuid, p_new_price_cents bigint, p_intent text)
-- RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--   PERFORM public.audit_set_intent(p_intent);
--   UPDATE public.jobs SET client_price_cents = p_new_price_cents WHERE id = p_job_id;
-- END $$;
--
-- Then: SELECT admin_adjust_job_price('<job-uuid>', 75000, 'Fast-track uplift');
-- Verify: SELECT summary, metadata->>'intent' FROM audit_events ORDER BY created_at DESC LIMIT 1;
