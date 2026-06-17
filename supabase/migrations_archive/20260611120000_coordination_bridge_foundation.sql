-- ════════════════════════════════════════════════════════════════════════════
--  20260611120000_coordination_bridge_foundation.sql
--
--  COORDINATION BRIDGE — Sprint A (foundation).
--
--  WHAT THIS DELIVERS
--  ──────────────────
--  A bounded, audit-grade workspace where the inspector assigned to a job
--  exchanges scheduling proposals and preliminary documents with the
--  third-party vendor (manufacturer / factory / site contact) being
--  inspected. The vendor is NOT a NEXPEC user — they never sign up, never
--  see pricing, never see other tenants. They access exactly one job's
--  Bridge via a time-bounded, revocable magic-link token.
--
--  SCHEMA
--  ──────
--    • vendor_contacts          — vendor identities (no NEXPEC accounts)
--    • coordination_bridges     — one per job (UNIQUE on job_id)
--    • bridge_slots             — finite state-machine slots per bridge
--    • bridge_documents         — vendor-uploaded artifacts with SHA-256
--
--  CRYPTOGRAPHIC POSTURE
--  ─────────────────────
--  Every document the vendor uploads is stored with its SHA-256 hash.
--  Sprint C will fold those hashes into pi_seal_inspection_report's root,
--  extending the inspection's cryptographic chain BACKWARDS into the
--  vendor relationship. The chain a regulator can re-derive will then
--  span "vendor disclosed X document" → "inspector verified X on site"
--  → "client countersigned the report."
--
--  RLS POSTURE
--  ───────────
--  The Bridge is one physical workspace viewed from FOUR perspectives.
--  Same rows, role-aware filtering:
--    • Vendor (token-bearer, no auth.uid()) — handled by Edge Function
--      acting as a SECURITY DEFINER gateway. No direct RLS access.
--    • Inspector (jobs.contractor_id) — sees full Bridge + private notes.
--    • Client   (jobs.client_id)     — sees full Bridge, NOT inspector
--      private notes.
--    • Platform Owner (super_admin)  — sees everything.
--    • Agency (if intermediary)      — same as client for now.
--
--  All Bridge mutations route through SECURITY DEFINER RPCs; direct
--  table writes are REVOKE'd. Token-bearing actions land via the
--  vendor-bridge-auth Edge Function using the service-role key.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ENUMs — strict domains so typos cannot pollute the data.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_bridge_status') THEN
    CREATE TYPE public.coordination_bridge_status AS ENUM (
      'pending_invite',        -- token issued, vendor hasn't opened the link yet
      'in_progress',           -- vendor has opened; slots being negotiated
      'ready_for_inspection',  -- all required slots completed, awaiting inspection
      'completed',             -- inspection complete; bridge sealed
      'cancelled'              -- explicitly cancelled (by inspector / client / admin)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_bridge_slot_kind') THEN
    CREATE TYPE public.coordination_bridge_slot_kind AS ENUM (
      'schedule',           -- date + time + timezone agreement
      'document_request',   -- inspector requests a specific document
      'site_access',        -- vendor declares PPE / escort / entry hours
      'pre_inspection_ack', -- vendor confirms scope; inspector confirms readiness
      'arrival_ack'         -- vendor signs that the inspector arrived
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_bridge_slot_status') THEN
    CREATE TYPE public.coordination_bridge_slot_status AS ENUM (
      'pending',            -- created; no party has acted yet
      'awaiting_vendor',    -- inspector has acted; vendor must respond
      'awaiting_inspector', -- vendor has acted; inspector must review
      'completed',          -- mutually agreed / fulfilled
      'rejected'            -- one party explicitly declined
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_bridge_actor_kind') THEN
    CREATE TYPE public.coordination_bridge_actor_kind AS ENUM (
      'inspector',
      'vendor',
      'client',
      'platform_owner',
      'system'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) vendor_contacts — vendor identities WITHOUT NEXPEC accounts.
--
--    Created on-demand by inspectors when initiating a Coordination
--    Bridge. After a vendor has coordinated 3+ inspections, the
--    optional `claimed_user_id` allows them to upgrade to a real
--    NEXPEC account while retaining history (future sprint).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_contacts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL    DEFAULT now(),
  updated_at          timestamptz NOT NULL    DEFAULT now(),

  -- Identity
  company_name        text        NOT NULL,
  contact_name        text,
  contact_email       text        NOT NULL,
  contact_phone       text,

  -- Locale + i18n
  country_code        text,                  -- ISO-3166-1 alpha-2 (e.g. 'DE')
  timezone            text,                  -- IANA (e.g. 'Europe/Berlin')
  language_code       text        NOT NULL DEFAULT 'en',  -- 'en','de','fr','es', ...

  -- Provenance
  created_by_user_id  uuid        NOT NULL   REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Optional upgrade path
  claimed_user_id     uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at          timestamptz,

  -- Platform Owner notes (NEVER surfaced to client / inspector / vendor)
  platform_notes      text,

  -- Soft-delete
  deleted_at          timestamptz,

  CONSTRAINT vendor_contacts_email_format CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

COMMENT ON TABLE public.vendor_contacts IS
  'Vendor identities without NEXPEC accounts. Accessed via signed magic-link tokens on a per-Bridge basis.';

CREATE INDEX IF NOT EXISTS vendor_contacts_email_idx
  ON public.vendor_contacts (lower(contact_email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS vendor_contacts_company_idx
  ON public.vendor_contacts (lower(company_name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS vendor_contacts_creator_idx
  ON public.vendor_contacts (created_by_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_vendor_contacts_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_vendor_contacts_set_updated_at ON public.vendor_contacts;
CREATE TRIGGER tg_vendor_contacts_set_updated_at
  BEFORE UPDATE ON public.vendor_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_vendor_contacts_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 3) coordination_bridges — one per job (UNIQUE).
--
--    Sprint A allows exactly one bridge per job. If a re-coordination
--    is needed (e.g. vendor changed), cancel the existing bridge first.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coordination_bridges (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL    DEFAULT now(),
  updated_at               timestamptz NOT NULL    DEFAULT now(),

  -- The job this bridge belongs to.
  job_id                   uuid        NOT NULL    UNIQUE
                                       REFERENCES public.jobs(id) ON DELETE CASCADE,

  -- The vendor identity this bridge connects to.
  vendor_contact_id        uuid        NOT NULL    REFERENCES public.vendor_contacts(id) ON DELETE RESTRICT,

  -- The inspector who initiated. Must match jobs.contractor_id at creation time.
  inspector_id             uuid        NOT NULL    REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Denormalised from jobs.client_id for fast RLS evaluation.
  client_id                uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- State machine.
  status                   public.coordination_bridge_status NOT NULL DEFAULT 'pending_invite',

  -- Magic-link token (we store ONLY the hash; the raw token is sent
  -- once to the vendor by email and never persisted in the database).
  token_sha256             text        NOT NULL,
  token_issued_at          timestamptz NOT NULL    DEFAULT now(),
  token_expires_at         timestamptz NOT NULL,
  token_revoked_at         timestamptz,

  -- Vendor session activity tracking.
  vendor_first_seen_at     timestamptz,
  vendor_last_seen_at      timestamptz,
  vendor_session_count     integer     NOT NULL    DEFAULT 0,

  -- Lifecycle timestamps.
  ready_for_inspection_at  timestamptz,
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_by_user_id     uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancellation_reason      text,

  -- Inspector private notes — NEVER visible to client, vendor, or auditor.
  -- Surfaced only to the inspector themselves and to Platform Owner.
  inspector_private_notes  text,

  CONSTRAINT coordination_bridges_token_expiry_future
    CHECK (token_expires_at > token_issued_at)
);

COMMENT ON TABLE public.coordination_bridges IS
  'One Coordination Bridge per job. The vendor accesses this via a signed magic-link token. All mutations route through SECURITY DEFINER RPCs.';

COMMENT ON COLUMN public.coordination_bridges.token_sha256 IS
  'SHA-256 hash of the raw magic-link token. The raw token is delivered to the vendor by email exactly once and is NEVER stored. This column lets the Edge Function validate a presented token by hashing and lookup.';

COMMENT ON COLUMN public.coordination_bridges.inspector_private_notes IS
  'Inspector working notes. Never visible to vendor, client, or auditor. Visible only to the inspector themselves and to Platform Owner.';

CREATE INDEX IF NOT EXISTS coordination_bridges_job_idx
  ON public.coordination_bridges (job_id);

CREATE INDEX IF NOT EXISTS coordination_bridges_inspector_idx
  ON public.coordination_bridges (inspector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS coordination_bridges_client_idx
  ON public.coordination_bridges (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS coordination_bridges_vendor_idx
  ON public.coordination_bridges (vendor_contact_id, created_at DESC);

-- Hot-path lookup: the Edge Function hashes the presented token and looks it up.
CREATE UNIQUE INDEX IF NOT EXISTS coordination_bridges_token_idx
  ON public.coordination_bridges (token_sha256)
  WHERE token_revoked_at IS NULL;

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_coordination_bridges_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_coordination_bridges_set_updated_at ON public.coordination_bridges;
CREATE TRIGGER tg_coordination_bridges_set_updated_at
  BEFORE UPDATE ON public.coordination_bridges
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 4) bridge_slots — finite state-machine slots per Bridge.
--
--    The Bridge is not a chat. It is structured negotiation surfaces.
--    Each slot has a kind, a status, and a kind-specific payload_json.
--
--    Payload schemas (advisory; not enforced at the DB layer to keep
--    flexibility for sprint iteration):
--      schedule         : { proposed_at, agreed_at, timezone,
--                           proposed_by_kind, agreed_by_kind, notes }
--      document_request : { filename_hint, required, max_size_bytes,
--                           mime_hints[], reason }
--      site_access      : { ppe[], escort_required, badge_required,
--                           entry_hours, contact_on_arrival }
--      pre_inspection_ack: { scope_summary, acknowledged_at, by_kind }
--      arrival_ack      : { typed_name, ip, signed_at, by_kind }
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bridge_slots (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL    DEFAULT now(),
  updated_at               timestamptz NOT NULL    DEFAULT now(),

  bridge_id                uuid        NOT NULL    REFERENCES public.coordination_bridges(id) ON DELETE CASCADE,
  kind                     public.coordination_bridge_slot_kind     NOT NULL,
  status                   public.coordination_bridge_slot_status   NOT NULL DEFAULT 'pending',

  title                    text        NOT NULL,
  description              text,
  required                 boolean     NOT NULL    DEFAULT true,
  sort_order               integer     NOT NULL    DEFAULT 0,

  payload_json             jsonb       NOT NULL    DEFAULT '{}'::jsonb,

  -- Provenance of the slot itself.
  created_by_user_id       uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_actor_kind    public.coordination_bridge_actor_kind    NOT NULL DEFAULT 'inspector',

  -- Last actor.
  last_action_at           timestamptz,
  last_action_by_user_id   uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_action_by_actor_kind public.coordination_bridge_actor_kind,
  last_action_note         text,

  -- Terminal state.
  completed_at             timestamptz,
  rejected_at              timestamptz,
  rejected_reason          text,

  CONSTRAINT bridge_slots_terminal_coherence CHECK (
    NOT (completed_at IS NOT NULL AND rejected_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.bridge_slots IS
  'Finite state-machine slots inside a Coordination Bridge. Each slot represents one structured negotiation surface (schedule, document request, site access, etc.).';

CREATE INDEX IF NOT EXISTS bridge_slots_bridge_idx
  ON public.bridge_slots (bridge_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS bridge_slots_kind_status_idx
  ON public.bridge_slots (bridge_id, kind, status);

CREATE INDEX IF NOT EXISTS bridge_slots_awaiting_vendor_idx
  ON public.bridge_slots (bridge_id, last_action_at DESC)
  WHERE status = 'awaiting_vendor';

CREATE INDEX IF NOT EXISTS bridge_slots_awaiting_inspector_idx
  ON public.bridge_slots (bridge_id, last_action_at DESC)
  WHERE status = 'awaiting_inspector';

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_bridge_slots_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_bridge_slots_set_updated_at ON public.bridge_slots;
CREATE TRIGGER tg_bridge_slots_set_updated_at
  BEFORE UPDATE ON public.bridge_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_bridge_slots_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 5) bridge_documents — vendor-uploaded artifacts (the cryptographic
--    extension of the inspection chain).
--
--    Every document carries a SHA-256 hash computed by both client and
--    server. The hash will be folded into the inspection report's seal
--    in Sprint C, extending the cryptographic chain backwards from the
--    inspection moment into the vendor relationship.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bridge_documents (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL    DEFAULT now(),

  bridge_id                   uuid        NOT NULL    REFERENCES public.coordination_bridges(id) ON DELETE CASCADE,
  slot_id                     uuid                    REFERENCES public.bridge_slots(id) ON DELETE SET NULL,

  -- Who uploaded.
  uploaded_by_actor_kind      public.coordination_bridge_actor_kind  NOT NULL,
  uploaded_via_token          boolean     NOT NULL    DEFAULT false,
  uploaded_by_user_id         uuid                    REFERENCES public.profiles(id)        ON DELETE SET NULL,
  uploaded_by_vendor_contact_id uuid                  REFERENCES public.vendor_contacts(id) ON DELETE SET NULL,

  -- File metadata.
  storage_bucket              text        NOT NULL    DEFAULT 'bridge-documents',
  storage_path                text        NOT NULL,
  original_filename           text        NOT NULL,
  mime_type                   text,
  file_size_bytes             bigint,

  -- Cryptographic chain link.
  sha256_client_computed      text        NOT NULL,   -- vendor's browser computed
  sha256_server_verified      text,                   -- nullable until server re-verifies (async)
  sha256_verified_at          timestamptz,
  sha256_match                boolean,

  -- Acceptance lifecycle by the inspector.
  accepted_at                 timestamptz,
  accepted_by_user_id         uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at                 timestamptz,
  rejected_by_user_id         uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_reason             text,

  CONSTRAINT bridge_documents_uploader_coherence CHECK (
    (uploaded_by_actor_kind = 'vendor'    AND uploaded_by_vendor_contact_id IS NOT NULL)
    OR
    (uploaded_by_actor_kind = 'inspector' AND uploaded_by_user_id IS NOT NULL)
    OR
    (uploaded_by_actor_kind IN ('client','platform_owner','system') AND uploaded_by_user_id IS NOT NULL)
  ),
  CONSTRAINT bridge_documents_terminal_coherence CHECK (
    NOT (accepted_at IS NOT NULL AND rejected_at IS NOT NULL)
  ),
  CONSTRAINT bridge_documents_sha256_format CHECK (
    sha256_client_computed ~ '^[a-f0-9]{64}$'
  )
);

COMMENT ON TABLE public.bridge_documents IS
  'Documents exchanged through a Coordination Bridge. Each row carries a SHA-256 hash that will be folded into the inspection report seal (Sprint C).';

CREATE INDEX IF NOT EXISTS bridge_documents_bridge_idx
  ON public.bridge_documents (bridge_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bridge_documents_slot_idx
  ON public.bridge_documents (slot_id, created_at DESC)
  WHERE slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bridge_documents_pending_acceptance_idx
  ON public.bridge_documents (bridge_id, created_at)
  WHERE accepted_at IS NULL AND rejected_at IS NULL;

CREATE INDEX IF NOT EXISTS bridge_documents_sha256_idx
  ON public.bridge_documents (sha256_client_computed);

-- ─────────────────────────────────────────────────────────────────────
-- 6) Storage bucket for vendor-uploaded documents.
--
--    Private bucket. Access via signed URLs only, generated by the
--    vendor-bridge-auth Edge Function after token validation.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('bridge-documents', 'bridge-documents', false)
  ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 7) RLS — read-only policies. All writes are RPC-only.
--
--    Vendor access is NOT modeled at the RLS layer because vendors
--    don't have auth.uid(). The Edge Function holds the service-role
--    key and bypasses RLS after validating the magic-link token.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.vendor_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordination_bridges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_slots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_documents      ENABLE ROW LEVEL SECURITY;

-- ── vendor_contacts ────────────────────────────────────────────────
DROP POLICY IF EXISTS vendor_contacts_select_admin     ON public.vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_select_inspector ON public.vendor_contacts;
DROP POLICY IF EXISTS vendor_contacts_select_client    ON public.vendor_contacts;

CREATE POLICY vendor_contacts_select_admin
  ON public.vendor_contacts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Inspectors see vendor contacts they created OR that appear on their bridges.
CREATE POLICY vendor_contacts_select_inspector
  ON public.vendor_contacts FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      created_by_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.coordination_bridges cb
         WHERE cb.vendor_contact_id = vendor_contacts.id
           AND cb.inspector_id = auth.uid()
      )
    )
  );

-- Clients see vendor contacts attached to bridges on their own jobs.
CREATE POLICY vendor_contacts_select_client
  ON public.vendor_contacts FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.coordination_bridges cb
       WHERE cb.vendor_contact_id = vendor_contacts.id
         AND cb.client_id = auth.uid()
    )
  );

-- ── coordination_bridges ───────────────────────────────────────────
DROP POLICY IF EXISTS coordination_bridges_select_admin     ON public.coordination_bridges;
DROP POLICY IF EXISTS coordination_bridges_select_inspector ON public.coordination_bridges;
DROP POLICY IF EXISTS coordination_bridges_select_client    ON public.coordination_bridges;

CREATE POLICY coordination_bridges_select_admin
  ON public.coordination_bridges FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY coordination_bridges_select_inspector
  ON public.coordination_bridges FOR SELECT
  USING (inspector_id = auth.uid());

CREATE POLICY coordination_bridges_select_client
  ON public.coordination_bridges FOR SELECT
  USING (client_id = auth.uid());

-- ── bridge_slots ───────────────────────────────────────────────────
DROP POLICY IF EXISTS bridge_slots_select_admin     ON public.bridge_slots;
DROP POLICY IF EXISTS bridge_slots_select_inspector ON public.bridge_slots;
DROP POLICY IF EXISTS bridge_slots_select_client    ON public.bridge_slots;

CREATE POLICY bridge_slots_select_admin
  ON public.bridge_slots FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY bridge_slots_select_inspector
  ON public.bridge_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.coordination_bridges cb
       WHERE cb.id = bridge_slots.bridge_id
         AND cb.inspector_id = auth.uid()
    )
  );

CREATE POLICY bridge_slots_select_client
  ON public.bridge_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.coordination_bridges cb
       WHERE cb.id = bridge_slots.bridge_id
         AND cb.client_id = auth.uid()
    )
  );

-- ── bridge_documents ───────────────────────────────────────────────
DROP POLICY IF EXISTS bridge_documents_select_admin     ON public.bridge_documents;
DROP POLICY IF EXISTS bridge_documents_select_inspector ON public.bridge_documents;
DROP POLICY IF EXISTS bridge_documents_select_client    ON public.bridge_documents;

CREATE POLICY bridge_documents_select_admin
  ON public.bridge_documents FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY bridge_documents_select_inspector
  ON public.bridge_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.coordination_bridges cb
       WHERE cb.id = bridge_documents.bridge_id
         AND cb.inspector_id = auth.uid()
    )
  );

CREATE POLICY bridge_documents_select_client
  ON public.bridge_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.coordination_bridges cb
       WHERE cb.id = bridge_documents.bridge_id
         AND cb.client_id = auth.uid()
    )
  );

-- Lock down direct writes. All mutations route through SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.vendor_contacts      FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.coordination_bridges FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.bridge_slots         FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.bridge_documents     FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 8) Realtime publication so inspector + client UIs reflect state
--    transitions sub-second without polling.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'coordination_bridges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coordination_bridges;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'coordination_bridges realtime publication add: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'bridge_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bridge_slots;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'bridge_slots realtime publication add: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'bridge_documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bridge_documents;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'bridge_documents realtime publication add: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 9) Helper: emit a Bridge audit event into public.audit_events.
--
--    Sprint C wires the bridge's transcript + document hashes into
--    assemble_evidence_pack via a `vendor_coordination` artifact group
--    that reads from audit_events with subject_table='coordination_bridges'.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cb_emit_audit(
  p_event_type   text,
  p_severity     text,
  p_actor_id     uuid,
  p_actor_role   text,
  p_actor_label  text,
  p_bridge_id    uuid,
  p_job_id       uuid,
  p_summary      text,
  p_delta        jsonb,
  p_metadata     jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF to_regclass('public.audit_events') IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    p_event_type, COALESCE(p_severity, 'info'),
    p_actor_id, p_actor_role, p_actor_label,
    'coordination_bridges', p_bridge_id, p_job_id,
    p_summary, COALESCE(p_delta, '{}'::jsonb), COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cb_emit_audit(%): %', p_event_type, SQLERRM;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.cb_emit_audit(text, text, uuid, text, text, uuid, uuid, text, jsonb, jsonb)
  FROM PUBLIC, authenticated, anon;

COMMIT;
