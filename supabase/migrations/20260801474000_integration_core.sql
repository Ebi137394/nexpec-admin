-- ════════════════════════════════════════════════════════════════════════════
--  20260801474000_integration_core.sql
--
--  ERP INTEGRATION CORE — the provider-independent spine.
--
--  ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────
--  This lane builds the CANONICAL CORE that provider adapters plug into. It
--  contains NO SAP vocabulary, NO Oracle vocabulary, and no provider-specific
--  column, table or function anywhere. The only adapter kind this migration
--  admits is 'mock', which exists solely to prove the seam. SAP and Oracle
--  adapters are LATER lanes; when they land they add an adapter_kind and a set
--  of field-mapping rows, and NOTHING in this file has to change. That is the
--  test of whether the core is genuinely provider-independent, and it is the
--  reason the vocabulary below is expressed as DATA (integration_canonical_
--  entities / integration_canonical_fields) rather than as hard-coded CHECKs
--  scattered across five tables.
--
--  NO REAL TENANT CREDENTIAL EXISTS AT THIS HEAD. Nothing here has been run
--  against a real SAP or Oracle system and this migration does not claim
--  otherwise.
--
--  ── REUSE: WHAT ALREADY EXISTED AND IS USED AS-IS ──────────────────────────
--  Nothing in this lane is a v2 of anything. Re-derived at this HEAD:
--
--   IDEMPOTENCY LIFECYCLE — public.claim_stripe_webhook_event (baseline:6682)
--     is the house pattern: INSERT ... ON CONFLICT DO NOTHING, then a status
--     machine over pending/processing/completed/failed_retryable with a
--     claim-then-process discipline so a handler failure RELEASES the row and
--     the sender's own retry re-runs it. stripe-connect-webhook/index.ts:114
--     and stripe-payments-webhook are its two callers. nx_integration_claim_
--     message reproduces that state machine verbatim and adds only what an ERP
--     needs and Stripe does not: per-connector scoping of the key, attempt
--     counting with backoff, a terminal dead_letter state, and detection of a
--     sender that reuses an external id for a DIFFERENT body.
--     public.stripe_webhook_events is NOT reused as storage — it is keyed on a
--     bare Stripe event id with no org and no connector, so putting ERP traffic
--     in it would be the cross-tenant leak this lane must prevent.
--
--   ORG SCOPING — public.nx_is_org_member(uuid,uuid) (20260801468000:38, reads
--     profiles.organization_id) and public.nx_user_is_org_admin(uuid,uuid)
--     (baseline:14672, reads org_members.role IN owner|procurement_admin).
--     BOTH are used, and the split is deliberate: READ admits either membership
--     model, WRITE requires the stricter org_members one. See the note at §9.
--     public.nx_is_admin(uuid) (baseline:14551) is the platform-admin overlay.
--
--   updated_at — public.tg_coordination_bridges_set_updated_at() (baseline:
--     18886), the generic touch trigger 20260801448000:150 also reuses.
--
--   HASHING — extensions.digest(...,'sha256') (pgcrypto lives in the
--     "extensions" schema on Supabase; baseline:55, and 20260801153000:21).
--     Every reference below is schema-qualified because search_path is pinned
--     to public, pg_temp.
--
--   BUSINESS TABLES — public.jobs, public.projects, public.reports,
--     public.supplier_profiles, public.deal_nonconformances and
--     public.inspection_events are the canonical records. This lane creates NO
--     shadow copy of any of them. integration_record_links POINTS AT them; it
--     does not restate them.
--
--  ── THE INTEGRATION CORE MOVES NO MONEY. THREE INDEPENDENT PROOFS. ─────────
--  An ERP must never be able to settle a job. This is enforced three ways, so
--  that defeating one does not defeat the property:
--
--    P1 (declarative, permanent) — integration_canonical_fields carries
--       integration_canonical_fields_money_free, a CHECK that REFUSES any
--       canonical field whose name contains money vocabulary (amount, price,
--       cost, currency, invoice, payment, payout, fee, cents, billing, charge,
--       wallet, ledger, settle, budget, salary, wage, total). An inbound
--       message is mapped ONLY into canonical fields. A price therefore has no
--       canonical field to land in — it is not filtered out at runtime, it is
--       inexpressible.
--
--    P2 (declarative, permanent) — integration_record_links_table_allowlist
--       constrains internal_table to the six business tables above. No wallet,
--       transaction, earning, payout, job_funding_stage, deal_money_leg or
--       price-bearing table can EVER be the target of a connector link.
--
--    P3 (catalogue, asserted in §10) — no function named nx_integration_%
--       performs INSERT / UPDATE / DELETE against ANY table that is not itself
--       an integration_% table. The core writes only its own ledger. It does
--       not write jobs, it does not write projects, it does not write reports.
--       Resolution of an external reference to an internal row is an explicit,
--       authorised operator act (nx_integration_bind_record), and even that
--       writes only integration_record_links.
--
--  ── IDEMPOTENCY IS THE POINT OF THE LANE ───────────────────────────────────
--  ERPs retry by contract. Every inbound message carries an external id and
--  the pair (connector_id, external_id) is UNIQUE. A replay therefore cannot
--  create a second row; it collides, the claim returns claimed=false with
--  reason 'already_completed', and the caller short-circuits with 200. The
--  payload of a completed message is NEVER overwritten by a replay, so a
--  sender that reuses an external id for a different body cannot mutate
--  history — the divergence is COUNTED (payload_conflict_count) and surfaced
--  to the operator instead of being silently applied.
--
--  The key is scoped to the connector, not global. Two tenants may legitimately
--  both emit "REQ-1000"; a global key would make one tenant's message silently
--  no-op the other's. That is a cross-org leak wearing an idempotency costume.
--
--  ── FAILURES ARE NEVER SILENTLY SWALLOWED ──────────────────────────────────
--  A message can end in exactly one of two terminal failure states, and BOTH
--  keep the full payload and the last error:
--    dead_letter — retries exhausted, or a permanent defect. Operator-visible
--                  in integration_dead_letter_queue and replayable.
--    rejected    — the payload does not satisfy the canonical shape. Retrying
--                  an identical body can never succeed, so it goes terminal
--                  immediately rather than burning eight attempts, and the
--                  validation errors are stored on the row.
--  There is no code path that discards a message. Every exit writes a row.
--
--  The dead-letter queue is a VIEW over the ONE ledger, not a second table. A
--  separate failure table would be a second source of truth for the same
--  message and would immediately drift from the first.
--
--  ── CREDENTIALS ARE NEVER STORED IN PLAINTEXT ──────────────────────────────
--  integration_connector_secrets stores a SHA-256 hex digest and a short
--  non-secret prefix for operator identification. The CHECK enforces the digest
--  shape (64 lowercase hex chars), so a plaintext token cannot be stored even
--  by mistake — it would not match. Secrets are per-connector (therefore
--  per-organization) and revocable by stamping revoked_at; revocation is
--  immediate because nx_integration_resolve_connector filters on it.
--  The table is reachable by NOBODY except the platform admin and service_role
--  — not even an organization admin, who manages secrets through RPCs that
--  return metadata only and never the digest.
--
--  ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────────
--   • No SAP or Oracle adapter, and no provider-shaped column awaiting one.
--   • No write to any business table, ever. See P3.
--   • No outbound push. This lane is the INBOUND spine; an outbound projector
--     would need its own delivery-guarantee design and is a separate concern.
--   • No cron, no scheduled drain. The retry clock is next_attempt_at and the
--     sender's own retry is what advances it, exactly as Stripe's does today.
--     A scheduled drainer can be added later without touching this schema.
--   • No new membership model. See the §9 note on the two that already exist.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  §1. THE CANONICAL VOCABULARY — as data, not as hard-coded CHECKs
--
--  One table names the entities, one names their fields. Every other table in
--  this lane takes a FOREIGN KEY onto them, so there is exactly ONE place the
--  vocabulary is defined and it is impossible for two tables to disagree about
--  what a legal entity type is. Adding an entity later is an INSERT, not a
--  constraint rewrite across five tables.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_canonical_entities (
  entity_type  text PRIMARY KEY,
  label        text NOT NULL,
  description  text,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_canonical_entities_slug_shape
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE public.integration_canonical_entities IS
  'THE canonical, provider-neutral entity vocabulary of the integration core. Every other '
  'integration table FKs onto this one, so the vocabulary is defined exactly once and cannot '
  'drift between tables. Deliberately free of SAP and Oracle nouns: an adapter maps ITS words '
  'onto these, never the reverse. Adding an entity is an INSERT, not a schema change.';

CREATE TABLE IF NOT EXISTS public.integration_canonical_fields (
  entity_type     text NOT NULL
    REFERENCES public.integration_canonical_entities(entity_type) ON DELETE CASCADE,
  canonical_field text NOT NULL,
  data_type       text NOT NULL,
  is_required     boolean NOT NULL DEFAULT false,
  description     text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_canonical_fields_pk PRIMARY KEY (entity_type, canonical_field),
  CONSTRAINT integration_canonical_fields_shape
    CHECK (canonical_field ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT integration_canonical_fields_type_check
    CHECK (data_type = ANY (ARRAY['text','number','boolean','timestamp','uuid'])),
  --  ── MONEY-BLINDNESS PROOF P1 ──────────────────────────────────────────────
  --  The canonical shape is the ONLY thing an inbound payload can be mapped
  --  into. If money has no canonical field, an ERP cannot express money at all.
  --  This is not a runtime filter that a later change could forget to apply —
  --  it is a constraint, and it refuses the field at DDL/DML time forever.
  CONSTRAINT integration_canonical_fields_money_free CHECK (
    canonical_field !~* '(amount|price|cost|currency|invoice|payment|payout|fee|cents|billing|charge|wallet|ledger|settle|budget|salary|wage|total)'
  )
);

COMMENT ON TABLE public.integration_canonical_fields IS
  'The canonical SHAPE of each entity: which fields exist, their type, and whether they are '
  'required. nx_integration_validate_canonical enforces inbound payloads against exactly this '
  'registry — an unknown field is an error, a missing required field is an error. '
  'integration_canonical_fields_money_free is proof P1 that the integration core moves no '
  'money: no field whose name carries money vocabulary can ever be registered, so a price has '
  'no canonical slot to land in. It is inexpressible, not merely ignored.';

COMMENT ON COLUMN public.integration_canonical_fields.is_required IS
  'A required field must be present and non-null after mapping or the message is REJECTED '
  '(terminal, not retried — an identical body can never satisfy it on a second attempt).';

-- ─── the vocabulary itself ──────────────────────────────────────────────────
INSERT INTO public.integration_canonical_entities (entity_type, label, description) VALUES
  ('inspection_request', 'Inspection request',
   'An external system asks for an inspection. The demand signal, before it becomes a job.'),
  ('purchase_order', 'Purchase order',
   'A commercial order identifier the inspection hangs off. Identifier and linkage only — this core carries no order value.'),
  ('project', 'Project',
   'A project identifier in the external system, mapped onto public.projects.'),
  ('supplier', 'Supplier',
   'Supplier / vendor master data, mapped onto public.supplier_profiles. Provider-neutral term is "supplier"; adapters map "vendor" onto it.'),
  ('job', 'Job',
   'A dispatched inspection assignment, mapped onto public.jobs.'),
  ('inspection_status', 'Inspection status',
   'A status transition reported against an inspection or job.'),
  ('project_status', 'Project status',
   'A status transition reported against a project.'),
  ('supplier_status', 'Supplier status',
   'A status transition reported against a supplier.'),
  ('report', 'Report',
   'An inspection report reference, mapped onto public.reports.'),
  ('document', 'Document',
   'A generic document reference attached to a job or project.'),
  ('ncr', 'Non-conformance report',
   'An NCR raised against a job, project or supplier, mapped onto public.deal_nonconformances.'),
  ('completion', 'Completion',
   'Notification that work is complete. Records COMPLETION ONLY — it authorises no settlement and touches no money surface.')
ON CONFLICT (entity_type) DO NOTHING;

INSERT INTO public.integration_canonical_fields
  (entity_type, canonical_field, data_type, is_required, description) VALUES
  -- inspection_request
  ('inspection_request', 'external_ref',        'text',      true,  'The external system identifier for this request.'),
  ('inspection_request', 'title',               'text',      true,  'Short human title.'),
  ('inspection_request', 'purchase_order_ref',  'text',      false, 'External purchase order identifier.'),
  ('inspection_request', 'project_ref',         'text',      false, 'External project identifier.'),
  ('inspection_request', 'supplier_ref',        'text',      false, 'External supplier identifier.'),
  ('inspection_request', 'description',         'text',      false, 'Free text scope narrative.'),
  ('inspection_request', 'inspection_scope',    'text',      false, 'Scope or method descriptor.'),
  ('inspection_request', 'requested_date',      'timestamp', false, 'When the requester wants the inspection.'),
  ('inspection_request', 'site_location',       'text',      false, 'Site description.'),
  ('inspection_request', 'site_country',        'text',      false, 'ISO country of the site.'),
  ('inspection_request', 'priority',            'text',      false, 'Requester-declared priority.'),
  ('inspection_request', 'requester_name',      'text',      false, 'Named requester in the external system.'),
  ('inspection_request', 'requester_email',     'text',      false, 'Requester contact address.'),
  -- purchase_order
  ('purchase_order', 'external_ref',   'text',      true,  'The external purchase order identifier.'),
  ('purchase_order', 'project_ref',    'text',      false, 'External project identifier this order belongs to.'),
  ('purchase_order', 'supplier_ref',   'text',      false, 'External supplier identifier.'),
  ('purchase_order', 'description',    'text',      false, 'Order description.'),
  ('purchase_order', 'issued_date',    'timestamp', false, 'When the order was issued.'),
  ('purchase_order', 'status',         'text',      false, 'Order lifecycle state in the external system.'),
  -- project
  ('project', 'external_ref',   'text',      true,  'The external project identifier.'),
  ('project', 'name',           'text',      true,  'Project name.'),
  ('project', 'description',    'text',      false, 'Project description.'),
  ('project', 'status',         'text',      false, 'Project lifecycle state in the external system.'),
  ('project', 'start_date',     'timestamp', false, 'Planned or actual start.'),
  ('project', 'end_date',       'timestamp', false, 'Planned or actual end.'),
  ('project', 'site_location',  'text',      false, 'Primary site description.'),
  ('project', 'site_country',   'text',      false, 'ISO country of the primary site.'),
  -- supplier
  ('supplier', 'external_ref',   'text',    true,  'The external supplier identifier.'),
  ('supplier', 'legal_name',     'text',    true,  'Registered legal name.'),
  ('supplier', 'display_name',   'text',    false, 'Trading name.'),
  ('supplier', 'country_code',   'text',    false, 'ISO country of registration.'),
  ('supplier', 'contact_email',  'text',    false, 'Primary contact address.'),
  ('supplier', 'contact_name',   'text',    false, 'Primary contact person.'),
  ('supplier', 'status',         'text',    false, 'Supplier lifecycle state in the external system.'),
  ('supplier', 'capabilities',   'text',    false, 'Declared capabilities, delimited text.'),
  ('supplier', 'is_active',      'boolean', false, 'Whether the external system considers the supplier active.'),
  -- job
  ('job', 'external_ref',            'text',      true,  'The external identifier for this job.'),
  ('job', 'title',                   'text',      true,  'Short human title.'),
  ('job', 'inspection_request_ref',  'text',      false, 'External inspection request this job realises.'),
  ('job', 'project_ref',             'text',      false, 'External project identifier.'),
  ('job', 'purchase_order_ref',      'text',      false, 'External purchase order identifier.'),
  ('job', 'description',             'text',      false, 'Scope narrative.'),
  ('job', 'scheduled_date',          'timestamp', false, 'Scheduled execution date.'),
  ('job', 'site_location',           'text',      false, 'Site description.'),
  ('job', 'site_country',            'text',      false, 'ISO country of the site.'),
  ('job', 'status',                  'text',      false, 'Job lifecycle state in the external system.'),
  -- inspection_status
  ('inspection_status', 'external_ref',      'text',      true,  'External identifier of the inspection or job this status is about.'),
  ('inspection_status', 'status',            'text',      true,  'The reported state, in the external system''s own vocabulary.'),
  ('inspection_status', 'status_changed_at', 'timestamp', false, 'When the transition happened.'),
  ('inspection_status', 'note',              'text',      false, 'Operator note accompanying the transition.'),
  -- project_status
  ('project_status', 'external_ref',      'text',      true,  'External identifier of the project this status is about.'),
  ('project_status', 'status',            'text',      true,  'The reported state.'),
  ('project_status', 'status_changed_at', 'timestamp', false, 'When the transition happened.'),
  ('project_status', 'note',              'text',      false, 'Operator note accompanying the transition.'),
  -- supplier_status
  ('supplier_status', 'external_ref',      'text',      true,  'External identifier of the supplier this status is about.'),
  ('supplier_status', 'status',            'text',      true,  'The reported state.'),
  ('supplier_status', 'status_changed_at', 'timestamp', false, 'When the transition happened.'),
  ('supplier_status', 'note',              'text',      false, 'Operator note accompanying the transition.'),
  -- report
  ('report', 'external_ref',   'text',      true,  'The external identifier for this report.'),
  ('report', 'title',          'text',      true,  'Report title.'),
  ('report', 'job_ref',        'text',      false, 'External job identifier the report belongs to.'),
  ('report', 'project_ref',    'text',      false, 'External project identifier.'),
  ('report', 'document_url',   'text',      false, 'Location of the report document.'),
  ('report', 'document_type',  'text',      false, 'Document classification.'),
  ('report', 'result',         'text',      false, 'Reported outcome.'),
  ('report', 'issued_at',      'timestamp', false, 'When the report was issued.'),
  ('report', 'author_name',    'text',      false, 'Named author in the external system.'),
  -- document
  ('document', 'external_ref',   'text',      true,  'The external identifier for this document.'),
  ('document', 'title',          'text',      true,  'Document title.'),
  ('document', 'job_ref',        'text',      false, 'External job identifier.'),
  ('document', 'project_ref',    'text',      false, 'External project identifier.'),
  ('document', 'document_url',   'text',      false, 'Location of the document.'),
  ('document', 'document_type',  'text',      false, 'Document classification.'),
  ('document', 'issued_at',      'timestamp', false, 'When the document was issued.'),
  -- ncr
  ('ncr', 'external_ref',   'text',      true,  'The external identifier for this non-conformance.'),
  ('ncr', 'title',          'text',      true,  'Short description of the non-conformance.'),
  ('ncr', 'job_ref',        'text',      false, 'External job identifier.'),
  ('ncr', 'project_ref',    'text',      false, 'External project identifier.'),
  ('ncr', 'supplier_ref',   'text',      false, 'External supplier identifier.'),
  ('ncr', 'description',    'text',      false, 'Detail of the non-conformance.'),
  ('ncr', 'severity',       'text',      false, 'Severity in the external system''s vocabulary.'),
  ('ncr', 'basis',          'text',      false, 'The requirement the work failed against.'),
  ('ncr', 'code_ref',       'text',      false, 'Standard or clause reference.'),
  ('ncr', 'status',         'text',      false, 'Non-conformance lifecycle state.'),
  ('ncr', 'raised_at',      'timestamp', false, 'When it was raised.'),
  ('ncr', 'resolved_at',    'timestamp', false, 'When it was closed.'),
  -- completion
  ('completion', 'external_ref',  'text',      true,  'External identifier of the thing that completed.'),
  ('completion', 'completed_at',  'timestamp', true,  'When completion occurred.'),
  ('completion', 'job_ref',       'text',      false, 'External job identifier.'),
  ('completion', 'project_ref',   'text',      false, 'External project identifier.'),
  ('completion', 'outcome',       'text',      false, 'Completion outcome in the external vocabulary.'),
  ('completion', 'note',          'text',      false, 'Operator note.')
ON CONFLICT (entity_type, canonical_field) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
--  §2. CONNECTORS — one per (organization, external system instance)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_connectors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  display_name      text NOT NULL,
  adapter_kind      text NOT NULL DEFAULT 'mock',
  status            text NOT NULL DEFAULT 'active',
  --  retry policy is PER CONNECTOR because ERPs differ wildly in how patient
  --  they are; a single platform-wide constant would be wrong for all of them.
  max_attempts      integer NOT NULL DEFAULT 8,
  retry_base_seconds integer NOT NULL DEFAULT 30,
  retry_max_seconds  integer NOT NULL DEFAULT 3600,
  notes             text,
  created_by        uuid,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at        timestamp with time zone,
  revoked_by        uuid,
  CONSTRAINT integration_connectors_slug_uq UNIQUE (organization_id, slug),
  CONSTRAINT integration_connectors_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  CONSTRAINT integration_connectors_name_not_blank CHECK (length(btrim(display_name)) > 0),
  --  'mock' is the ONLY adapter this lane ships. SAP and Oracle adapters are
  --  later lanes and will extend this list; the core does not anticipate their
  --  vocabulary because a core that anticipates a provider is not a core.
  CONSTRAINT integration_connectors_adapter_check CHECK (adapter_kind = ANY (ARRAY['mock'])),
  CONSTRAINT integration_connectors_status_check
    CHECK (status = ANY (ARRAY['active','paused','revoked'])),
  CONSTRAINT integration_connectors_revoked_coherent CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)),
  CONSTRAINT integration_connectors_attempts_rng CHECK (max_attempts BETWEEN 1 AND 50),
  CONSTRAINT integration_connectors_base_rng     CHECK (retry_base_seconds BETWEEN 1 AND 86400),
  CONSTRAINT integration_connectors_max_rng      CHECK (retry_max_seconds BETWEEN 1 AND 604800),
  CONSTRAINT integration_connectors_backoff_ordered CHECK (retry_max_seconds >= retry_base_seconds)
);

CREATE INDEX IF NOT EXISTS integration_connectors_org_idx
  ON public.integration_connectors (organization_id);

COMMENT ON TABLE public.integration_connectors IS
  'One connector per (organization, external system instance). PROVIDER-INDEPENDENT: adapter_kind '
  'is the only provider-shaped column and it currently admits ''mock'' alone — SAP and Oracle '
  'adapters are later lanes and will extend the CHECK without touching anything else here. '
  'Every inbound message, mapping version, record link and history row reaches its owning '
  'organization through this row, which is why cross-org containment is enforced once, here. '
  'Carries no credential: secrets live hashed in integration_connector_secrets.';

COMMENT ON COLUMN public.integration_connectors.status IS
  'active | paused | revoked. Only an active connector may claim a message — a paused or '
  'revoked connector is refused at nx_integration_claim_message, so pausing is an immediate, '
  'total stop rather than a UI nicety.';

DROP TRIGGER IF EXISTS trg_integration_connectors_touch ON public.integration_connectors;
CREATE TRIGGER trg_integration_connectors_touch
  BEFORE UPDATE ON public.integration_connectors
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
--  §3. CREDENTIALS — HASHED, per-organization, revocable
--
--  The digest CHECK is what makes plaintext storage impossible rather than
--  merely discouraged: a 40-character bearer token does not match 64 lowercase
--  hex characters, so the INSERT fails.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_connector_secrets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  uuid NOT NULL REFERENCES public.integration_connectors(id) ON DELETE CASCADE,
  secret_kind   text NOT NULL DEFAULT 'inbound_token',
  token_hash    text NOT NULL,
  token_prefix  text NOT NULL,
  label         text,
  created_by    uuid,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at  timestamp with time zone,
  revoked_at    timestamp with time zone,
  revoked_by    uuid,
  CONSTRAINT integration_connector_secrets_kind_check
    CHECK (secret_kind = ANY (ARRAY['inbound_token','signing_key'])),
  --  NEVER PLAINTEXT. sha256 hex, lowercase, exactly 64 chars.
  CONSTRAINT integration_connector_secrets_digest_shape
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  --  The prefix exists so an operator can tell two live tokens apart in the
  --  UI without ever seeing either. It is short enough to be useless as a
  --  credential and is derived from the DIGEST, not from the token.
  CONSTRAINT integration_connector_secrets_prefix_shape
    CHECK (token_prefix ~ '^[0-9a-f]{8}$'),
  CONSTRAINT integration_connector_secrets_hash_uq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS integration_connector_secrets_connector_idx
  ON public.integration_connector_secrets (connector_id);

--  The hot path of every inbound request: hash -> live secret. Partial so a
--  revoked secret leaves the index entirely.
CREATE INDEX IF NOT EXISTS integration_connector_secrets_live_idx
  ON public.integration_connector_secrets (token_hash)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.integration_connector_secrets IS
  'Connector credentials, HASHED. token_hash is a SHA-256 hex digest and the digest_shape CHECK '
  'refuses anything that is not one — a plaintext token cannot be stored even by mistake, '
  'because it would not match ^[0-9a-f]{64}$. Per-connector and therefore per-organization. '
  'Revocation is stamping revoked_at and takes effect on the very next request because '
  'nx_integration_resolve_connector filters on it. NO organization user can read this table at '
  'all — org admins manage secrets through RPCs that return prefix/label/timestamps and never '
  'the digest. token_prefix is derived from the DIGEST, not from the token, so it leaks nothing.';

-- ════════════════════════════════════════════════════════════════════════════
--  §4. FIELD MAPPING — per-organization (via connector) and VERSIONED
--
--  A version is the unit of change. Exactly one version per (connector,
--  entity_type) may be active at a time, enforced by a partial unique index —
--  so a mapping can be edited as a draft and switched atomically, and the
--  version that mapped a given message is recorded ON that message forever.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_mapping_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  uuid NOT NULL REFERENCES public.integration_connectors(id) ON DELETE CASCADE,
  entity_type   text NOT NULL
    REFERENCES public.integration_canonical_entities(entity_type) ON DELETE RESTRICT,
  version       integer NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  notes         text,
  created_by    uuid,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  activated_at  timestamp with time zone,
  retired_at    timestamp with time zone,
  CONSTRAINT integration_mapping_versions_uq UNIQUE (connector_id, entity_type, version),
  CONSTRAINT integration_mapping_versions_version_rng CHECK (version >= 1),
  CONSTRAINT integration_mapping_versions_status_check
    CHECK (status = ANY (ARRAY['draft','active','retired'])),
  CONSTRAINT integration_mapping_versions_active_coherent CHECK (
    (status = 'active'  AND activated_at IS NOT NULL)
    OR (status = 'draft' AND activated_at IS NULL AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL))
);

--  ONE active version per connector+entity. This is the constraint that makes
--  "which mapping was in force" a question with a single answer.
CREATE UNIQUE INDEX IF NOT EXISTS integration_mapping_versions_one_active_uq
  ON public.integration_mapping_versions (connector_id, entity_type)
  WHERE status = 'active';

COMMENT ON TABLE public.integration_mapping_versions IS
  'A versioned field-mapping set for one connector and one canonical entity. Exactly one may be '
  'active per (connector, entity_type) — integration_mapping_versions_one_active_uq — so '
  '"which mapping was in force" always has a single answer. The id of the version that mapped a '
  'message is stamped on that message and never rewritten, so re-reading history does not '
  'reinterpret it under today''s mapping.';

CREATE TABLE IF NOT EXISTS public.integration_field_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      uuid NOT NULL
    REFERENCES public.integration_mapping_versions(id) ON DELETE CASCADE,
  external_field  text NOT NULL,
  canonical_field text NOT NULL,
  transform       text NOT NULL DEFAULT 'none',
  default_value   text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_field_mappings_external_uq UNIQUE (version_id, external_field),
  --  Two external fields mapping onto ONE canonical field is a silent
  --  last-writer-wins data loss. Refused.
  CONSTRAINT integration_field_mappings_canonical_uq UNIQUE (version_id, canonical_field),
  CONSTRAINT integration_field_mappings_transform_check
    CHECK (transform = ANY (ARRAY['none','trim','upper','lower'])),
  CONSTRAINT integration_field_mappings_external_not_blank
    CHECK (length(btrim(external_field)) > 0)
);

CREATE INDEX IF NOT EXISTS integration_field_mappings_version_idx
  ON public.integration_field_mappings (version_id);

COMMENT ON TABLE public.integration_field_mappings IS
  'external_field -> canonical_field for one mapping version. transform is presentation-level '
  'only (none|trim|upper|lower); TYPE coercion is not a mapping concern, it is the validator''s, '
  'driven by integration_canonical_fields.data_type — so there is one place that decides what a '
  'timestamp is. The (version_id, canonical_field) UNIQUE refuses two external fields collapsing '
  'onto one canonical field, which would be silent last-writer-wins data loss.';

--  A mapping must target a field the canonical shape actually has, for the
--  entity its version is for. This cannot be a composite FK because
--  canonical_field lives here and entity_type lives on the parent version, so
--  it is a trigger — the same instrument 20260801468000 used for the
--  project/program org check, and for the same reason.
CREATE OR REPLACE FUNCTION public.nx_integration_guard_mapping_target()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_entity text;
BEGIN
  SELECT entity_type INTO v_entity
    FROM public.integration_mapping_versions WHERE id = NEW.version_id;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'MAPPING_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integration_canonical_fields f
     WHERE f.entity_type = v_entity AND f.canonical_field = NEW.canonical_field
  ) THEN
    RAISE EXCEPTION
      'UNKNOWN_CANONICAL_FIELD: % is not a field of canonical entity % — a mapping cannot invent a canonical field, and money fields cannot exist at all (integration_canonical_fields_money_free)',
      NEW.canonical_field, v_entity
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_integration_guard_mapping_target() OWNER TO postgres;

--  INSERT and UPDATE both: a row must not be able to be BORN invalid. This is
--  the 20260801462000 lesson, where UPDATE-only guards left the INSERT open.
DROP TRIGGER IF EXISTS trg_integration_field_mappings_target ON public.integration_field_mappings;
CREATE TRIGGER trg_integration_field_mappings_target
  BEFORE INSERT OR UPDATE ON public.integration_field_mappings
  FOR EACH ROW EXECUTE FUNCTION public.nx_integration_guard_mapping_target();

-- ════════════════════════════════════════════════════════════════════════════
--  §5. THE INBOUND LEDGER — idempotency, retry state and the failure queue,
--      in ONE table.
--
--  Deliberately one table and not three. A message has one identity and one
--  lifecycle; splitting "in flight", "succeeded" and "dead" across tables makes
--  the idempotency key non-unique across the set, which is exactly the property
--  the lane exists to guarantee.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_inbound_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id          uuid NOT NULL REFERENCES public.integration_connectors(id) ON DELETE CASCADE,
  --  DENORMALISED on purpose and trigger-guarded to match the connector, so
  --  every RLS policy on this table can be a single-column comparison instead
  --  of a join. Cross-org leakage here is a P0; the cheap policy is the one
  --  that stays correct.
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id           text NOT NULL,
  entity_type           text NOT NULL
    REFERENCES public.integration_canonical_entities(entity_type) ON DELETE RESTRICT,
  external_ref          text,
  payload               jsonb NOT NULL,
  payload_digest        text NOT NULL,
  canonical             jsonb,
  mapping_version_id    uuid REFERENCES public.integration_mapping_versions(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'received',
  attempts              integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamp with time zone,
  last_error            text,
  validation_errors     jsonb,
  payload_conflict_count integer NOT NULL DEFAULT 0,
  last_conflict_at      timestamp with time zone,
  replay_count          integer NOT NULL DEFAULT 0,
  last_replayed_at      timestamp with time zone,
  last_replayed_by      uuid,
  received_at           timestamp with time zone NOT NULL DEFAULT now(),
  claimed_at            timestamp with time zone,
  processed_at          timestamp with time zone,
  dead_lettered_at      timestamp with time zone,
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),

  --  ── THE IDEMPOTENCY KEY ─────────────────────────────────────────────────
  --  Scoped to the connector, never global. Two tenants may legitimately both
  --  emit "REQ-1000"; a global key would let one tenant's message silently
  --  no-op the other's, which is a cross-org leak wearing an idempotency
  --  costume. Because a connector belongs to exactly one organization, this
  --  key is also implicitly org-scoped.
  CONSTRAINT integration_inbound_messages_idem_uq UNIQUE (connector_id, external_id),

  CONSTRAINT integration_inbound_messages_external_id_not_blank
    CHECK (length(btrim(external_id)) > 0),
  CONSTRAINT integration_inbound_messages_status_check CHECK (
    status = ANY (ARRAY['received','processing','completed','failed_retryable','dead_letter','rejected'])),
  CONSTRAINT integration_inbound_messages_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT integration_inbound_messages_digest_shape CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  --  A completed message must say when; a message that has not completed must
  --  not pretend it did. Mirrors job_funding_stages_funded_at_chk.
  CONSTRAINT integration_inbound_messages_processed_coherent CHECK (
    (status = 'completed' AND processed_at IS NOT NULL)
    OR (status <> 'completed' AND processed_at IS NULL)),
  --  A dead-lettered message must carry the reason it died. This is what makes
  --  "failures are never silently swallowed" a constraint and not a promise.
  CONSTRAINT integration_inbound_messages_dead_coherent CHECK (
    (status = 'dead_letter' AND dead_lettered_at IS NOT NULL AND last_error IS NOT NULL)
    OR (status <> 'dead_letter' AND dead_lettered_at IS NULL)),
  CONSTRAINT integration_inbound_messages_rejected_coherent CHECK (
    status <> 'rejected' OR validation_errors IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS integration_inbound_messages_connector_idx
  ON public.integration_inbound_messages (connector_id, received_at DESC);

CREATE INDEX IF NOT EXISTS integration_inbound_messages_org_idx
  ON public.integration_inbound_messages (organization_id);

--  The operator's two hot queries: what is stuck, and what is due.
CREATE INDEX IF NOT EXISTS integration_inbound_messages_dead_idx
  ON public.integration_inbound_messages (connector_id, dead_lettered_at DESC)
  WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS integration_inbound_messages_due_idx
  ON public.integration_inbound_messages (next_attempt_at)
  WHERE status = 'failed_retryable';

COMMENT ON TABLE public.integration_inbound_messages IS
  'THE inbound ledger: idempotency key, retry state and failure queue in one table, because a '
  'message has one identity and one lifecycle. (connector_id, external_id) is UNIQUE — that is '
  'the idempotency guarantee, and it is connector-scoped rather than global so two tenants '
  'emitting the same external id cannot no-op each other. A replay of a completed message never '
  'overwrites its payload; a sender that reuses an external id for a DIFFERENT body is counted '
  'in payload_conflict_count and surfaced, not silently applied. Terminal failure is '
  'dead_letter (retries exhausted or permanent) or rejected (payload does not satisfy the '
  'canonical shape, so retrying an identical body can never succeed). Both keep the full '
  'payload and the error. There is no code path that discards a message.';

COMMENT ON COLUMN public.integration_inbound_messages.external_id IS
  'The sender''s own message identifier — the thing an ERP repeats when it retries. Required, '
  'non-blank, and half of the UNIQUE idempotency key. A payload arriving without one is refused '
  'at the edge with 400 and no row is written: there is nothing to be idempotent ABOUT.';

COMMENT ON COLUMN public.integration_inbound_messages.payload_conflict_count IS
  'How many times this external_id arrived carrying a DIFFERENT body than the one first stored. '
  'Non-zero means the sender is reusing identifiers for distinct messages — a real ERP defect '
  'that must be visible to an operator rather than resolved by silently overwriting history.';

COMMENT ON COLUMN public.integration_inbound_messages.organization_id IS
  'Denormalised from the connector and trigger-enforced to match it on INSERT and UPDATE '
  '(nx_integration_guard_message_org). Cross-org leakage through a connector is a P0, so the '
  'org lives on the row itself and every policy is a single-column comparison.';

DROP TRIGGER IF EXISTS trg_integration_inbound_messages_touch ON public.integration_inbound_messages;
CREATE TRIGGER trg_integration_inbound_messages_touch
  BEFORE UPDATE ON public.integration_inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

-- ─── org coherence: a message can never belong to an org its connector doesn't
CREATE OR REPLACE FUNCTION public.nx_integration_guard_message_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.integration_connectors WHERE id = NEW.connector_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'CONNECTOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION
      'CONNECTOR_ORG_MISMATCH: a message cannot be filed against an organization its connector does not belong to (connector org %, message org %)',
      v_org, NEW.organization_id
      USING ERRCODE = '42501';
  END IF;
  --  Re-pointing a stored message at a different connector would move it
  --  between tenants. There is no legitimate reason to do it.
  IF TG_OP = 'UPDATE' AND NEW.connector_id IS DISTINCT FROM OLD.connector_id THEN
    RAISE EXCEPTION
      'CONNECTOR_REBIND_FORBIDDEN: an inbound message cannot be moved to a different connector'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_integration_guard_message_org() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_integration_inbound_messages_org ON public.integration_inbound_messages;
CREATE TRIGGER trg_integration_inbound_messages_org
  BEFORE INSERT OR UPDATE ON public.integration_inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.nx_integration_guard_message_org();

-- ════════════════════════════════════════════════════════════════════════════
--  §6. RECORD LINKS + CHANGE HISTORY
--
--  A link is the identity bridge: "external ref X on connector C is our row Y".
--  It is NOT a copy of the business row. The core creates no shadow jobs table,
--  no shadow suppliers table and no shadow reports table — it points at the
--  ones that already exist.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_record_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id     uuid NOT NULL REFERENCES public.integration_connectors(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type      text NOT NULL
    REFERENCES public.integration_canonical_entities(entity_type) ON DELETE RESTRICT,
  external_ref     text NOT NULL,
  internal_table   text,
  internal_id      uuid,
  last_canonical   jsonb,
  last_message_id  uuid REFERENCES public.integration_inbound_messages(id) ON DELETE SET NULL,
  first_seen_at    timestamp with time zone NOT NULL DEFAULT now(),
  last_synced_at   timestamp with time zone NOT NULL DEFAULT now(),
  bound_at         timestamp with time zone,
  bound_by         uuid,
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_record_links_uq UNIQUE (connector_id, entity_type, external_ref),
  CONSTRAINT integration_record_links_external_ref_not_blank
    CHECK (length(btrim(external_ref)) > 0),
  --  ── MONEY-BLINDNESS PROOF P2 ────────────────────────────────────────────
  --  The complete set of internal rows a connector may ever be bound to. Every
  --  one of these is an operational record. No wallet, transaction, earning,
  --  payout, funding stage, money leg, invoice or price-bearing table appears,
  --  and none can be added without editing this constraint in a migration that
  --  a reviewer will see.
  CONSTRAINT integration_record_links_table_allowlist CHECK (
    internal_table IS NULL OR internal_table = ANY (ARRAY[
      'jobs','projects','reports','supplier_profiles','deal_nonconformances','inspection_events'
    ])),
  CONSTRAINT integration_record_links_bind_coherent CHECK (
    (internal_table IS NULL AND internal_id IS NULL AND bound_at IS NULL)
    OR (internal_table IS NOT NULL AND internal_id IS NOT NULL AND bound_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS integration_record_links_org_idx
  ON public.integration_record_links (organization_id);

CREATE INDEX IF NOT EXISTS integration_record_links_target_idx
  ON public.integration_record_links (internal_table, internal_id)
  WHERE internal_table IS NOT NULL;

COMMENT ON TABLE public.integration_record_links IS
  'The identity bridge: "external ref X on connector C is our row Y". NOT a copy of the business '
  'row — this lane creates no shadow jobs, suppliers or reports table and reuses the existing '
  'ones. internal_table/internal_id stay NULL until an authorised operator binds them '
  '(nx_integration_bind_record); the core never guesses a binding from an inbound message. '
  'integration_record_links_table_allowlist is proof P2 that the core moves no money: the six '
  'permitted targets are all operational records, and no wallet, transaction, payout, funding '
  'stage or price-bearing table is reachable. Note that a link row is org-scoped even when its '
  'TARGET is global (supplier_profiles is a platform-wide directory), so org A''s links are '
  'never visible to org B regardless of what they point at.';

DROP TRIGGER IF EXISTS trg_integration_record_links_touch ON public.integration_record_links;
CREATE TRIGGER trg_integration_record_links_touch
  BEFORE UPDATE ON public.integration_record_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

CREATE OR REPLACE FUNCTION public.nx_integration_guard_link_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid; v_target_org uuid;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.integration_connectors WHERE id = NEW.connector_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'CONNECTOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION
      'CONNECTOR_ORG_MISMATCH: a record link cannot belong to an organization its connector does not (connector org %, link org %)',
      v_org, NEW.organization_id
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.connector_id IS DISTINCT FROM OLD.connector_id THEN
    RAISE EXCEPTION
      'CONNECTOR_REBIND_FORBIDDEN: a record link cannot be moved to a different connector'
      USING ERRCODE = '42501';
  END IF;

  --  Where the TARGET is itself organization-owned, it must be THIS
  --  organization's. projects carry organization_id directly; jobs and reports
  --  reach it through projects.project_id / reports.project_id. A job or report
  --  with no project has no org to compare against and is left to the operator
  --  — refusing it would make the bridge unusable for the many existing rows
  --  that predate the project bridge (20260801412000 left project_id nullable
  --  with no backfill, deliberately).
  --
  --  supplier_profiles and inspection_events are NOT checked here:
  --  supplier_profiles is a platform-wide directory with no owning org, and
  --  inspection_events carries its own organization_id which IS checked below.
  IF NEW.internal_table IS NOT NULL AND NEW.internal_id IS NOT NULL THEN
    IF NEW.internal_table = 'projects' THEN
      SELECT organization_id INTO v_target_org FROM public.projects WHERE id = NEW.internal_id;
    ELSIF NEW.internal_table = 'jobs' THEN
      SELECT p.organization_id INTO v_target_org
        FROM public.jobs j LEFT JOIN public.projects p ON p.id = j.project_id
       WHERE j.id = NEW.internal_id;
    ELSIF NEW.internal_table = 'reports' THEN
      SELECT p.organization_id INTO v_target_org
        FROM public.reports r LEFT JOIN public.projects p ON p.id = r.project_id
       WHERE r.id = NEW.internal_id;
    ELSIF NEW.internal_table = 'inspection_events' THEN
      SELECT organization_id INTO v_target_org
        FROM public.inspection_events WHERE id = NEW.internal_id;
    ELSE
      v_target_org := NULL;
    END IF;

    IF v_target_org IS NOT NULL AND v_target_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION
        'CROSS_ORG_BIND_FORBIDDEN: connector organization % may not bind %.% which belongs to organization %',
        NEW.organization_id, NEW.internal_table, NEW.internal_id, v_target_org
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_integration_guard_link_org() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_integration_record_links_org ON public.integration_record_links;
CREATE TRIGGER trg_integration_record_links_org
  BEFORE INSERT OR UPDATE ON public.integration_record_links
  FOR EACH ROW EXECUTE FUNCTION public.nx_integration_guard_link_org();

-- ─── change history, append-only ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_record_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id       uuid NOT NULL REFERENCES public.integration_record_links(id) ON DELETE CASCADE,
  message_id    uuid REFERENCES public.integration_inbound_messages(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  change_kind   text NOT NULL,
  actor_kind    text NOT NULL DEFAULT 'connector',
  actor_id      uuid,
  before_state  jsonb,
  after_state   jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  note          text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_record_history_kind_check CHECK (
    change_kind = ANY (ARRAY['create','update','noop_replay','bind','unbind','replay_requested'])),
  CONSTRAINT integration_record_history_actor_check CHECK (
    actor_kind = ANY (ARRAY['connector','operator','system']))
);

CREATE INDEX IF NOT EXISTS integration_record_history_link_idx
  ON public.integration_record_history (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_record_history_org_idx
  ON public.integration_record_history (organization_id);

COMMENT ON TABLE public.integration_record_history IS
  'Append-only change history for every mapped record. APPEND-ONLY IS ENFORCED BY TRIGGER, not '
  'merely by the absence of an UPDATE policy — a trigger binds service_role too, and service_role '
  'bypasses RLS entirely. change_kind ''noop_replay'' is deliberately recorded: an idempotent '
  'replay producing no change is itself evidence worth keeping, because "nothing happened" and '
  '"nothing arrived" are different facts and an operator debugging a connector needs to tell '
  'them apart.';

CREATE OR REPLACE FUNCTION public.nx_integration_history_append_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION
    'APPEND_ONLY: integration_record_history is an audit trail — % is not permitted on it by any role, service_role included',
    TG_OP
    USING ERRCODE = '42501';
END $fn$;

ALTER FUNCTION public.nx_integration_history_append_only() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_integration_record_history_append_only ON public.integration_record_history;
CREATE TRIGGER trg_integration_record_history_append_only
  BEFORE UPDATE OR DELETE ON public.integration_record_history
  FOR EACH ROW EXECUTE FUNCTION public.nx_integration_history_append_only();

-- ════════════════════════════════════════════════════════════════════════════
--  §7. THE FUNCTIONS
--
--  Authority model, shared by all of them and modelled on
--  20260801434000:203 — an end-user session is one that carries auth.uid() OR
--  runs as anon/authenticated. Testing current_user as well as the JWT claim
--  closes the claimless-caller hole: a caller presenting NO claims would
--  otherwise leave the role empty, and an empty string is not 'anon', so it
--  would be mistaken for a trusted server context.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_integration_is_service_context()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text; v_actor uuid := auth.uid();
BEGIN
  BEGIN
    v_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;
  v_role := COALESCE(v_role, NULLIF(current_setting('request.jwt.claim.role', true), ''), '');

  RETURN v_actor IS NULL
     AND v_role <> 'anon'
     AND v_role <> 'authenticated'
     AND current_user NOT IN ('anon', 'authenticated');
END $fn$;

ALTER FUNCTION public.nx_integration_is_service_context() OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_is_service_context() IS
  'True only for a trusted server-side context: no identified end user, and not running as one '
  'of the two roles PostgREST switches into for untrusted callers. Tests current_user as well as '
  'the JWT claim so a caller presenting NO claims at all is not mistaken for a server context — '
  'the claimless-caller hole closed in 20260801434000.';

-- ─── org-admin authority over a connector ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_integration_can_administer(p_connector_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid;
BEGIN
  IF public.nx_integration_is_service_context() THEN RETURN true; END IF;
  IF public.nx_is_admin() THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  SELECT organization_id INTO v_org
    FROM public.integration_connectors WHERE id = p_connector_id;
  IF v_org IS NULL THEN RETURN false; END IF;

  RETURN public.nx_user_is_org_admin(auth.uid(), v_org);
END $fn$;

ALTER FUNCTION public.nx_integration_can_administer(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_can_administer(uuid) IS
  'Who may operate a connector: a trusted server context, a platform admin (nx_is_admin), or an '
  'organization admin of the connector''s own organization (nx_user_is_org_admin, i.e. an '
  'org_members row with role owner|procurement_admin). A plain org member may READ connector '
  'state but may not replay, bind or revoke.';

-- ─── deterministic backoff ──────────────────────────────────────────────────
--  Deterministic on purpose so the retry schedule is testable. The jitter is
--  derived from the message id rather than random(), so it spreads a THUNDERING
--  HERD across connectors while remaining reproducible for any single message.
CREATE OR REPLACE FUNCTION public.nx_integration_backoff_interval(
  p_attempts integer, p_base_seconds integer, p_max_seconds integer, p_seed uuid)
RETURNS interval
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE v_exp integer; v_secs bigint; v_jitter bigint;
BEGIN
  --  Cap the exponent BEFORE exponentiating. A runaway attempt count would
  --  otherwise evaluate 2^n unbounded; 2^20 is the largest this ever needs and
  --  the result is capped by retry_max_seconds a line later anyway.
  v_exp  := least(GREATEST(COALESCE(p_attempts, 1), 1) - 1, 20);
  v_secs := least((COALESCE(p_base_seconds, 30))::bigint * (2::numeric ^ v_exp)::bigint,
                  (COALESCE(p_max_seconds, 3600))::bigint);
  --  hashtext returns int4, and abs() on int4 overflows at INT_MIN — cast to
  --  bigint FIRST, not after.
  v_jitter := mod(
    abs(hashtext(COALESCE(p_seed, '00000000-0000-0000-0000-000000000000'::uuid)::text)::bigint),
    GREATEST(v_secs / 4, 1));
  RETURN make_interval(secs => (v_secs + v_jitter)::double precision);
END $fn$;

ALTER FUNCTION public.nx_integration_backoff_interval(integer,integer,integer,uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_backoff_interval(integer,integer,integer,uuid) IS
  'Exponential backoff, base * 2^(attempts-1), capped at retry_max_seconds, plus up to 25% '
  'jitter derived from the MESSAGE ID rather than random(). Deterministic per message so the '
  'schedule is testable, while still spreading a thundering herd across distinct messages. The '
  'exponent is capped at 20 before exponentiating so a runaway attempt count cannot overflow.';

-- ─── credential resolution ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_integration_resolve_connector(p_token text)
RETURNS TABLE (
  connector_id    uuid,
  organization_id uuid,
  slug            text,
  adapter_kind    text,
  connector_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_hash text; v_secret_id uuid; v_conn_id uuid; v_conn record;
BEGIN
  --  Server contexts only. An end-user session must never be able to trade a
  --  guessed token for a connector identity.
  IF NOT public.nx_integration_is_service_context() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RETURN;
  END IF;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  --  Locals throughout: the OUT columns of a RETURNS TABLE function are
  --  in-scope plpgsql variables, so assigning into them mid-body and then
  --  naming them in a WHERE clause is how a shadowing bug gets written.
  SELECT s.id, s.connector_id INTO v_secret_id, v_conn_id
    FROM public.integration_connector_secrets s
   WHERE s.token_hash = v_hash
     AND s.revoked_at IS NULL
     AND s.secret_kind = 'inbound_token'
   LIMIT 1;

  IF v_secret_id IS NULL THEN
    RETURN;  -- unknown or revoked: no row, and the caller sees only 401
  END IF;

  SELECT c.id, c.organization_id, c.slug, c.adapter_kind, c.status
    INTO v_conn
    FROM public.integration_connectors c WHERE c.id = v_conn_id;

  UPDATE public.integration_connector_secrets
     SET last_used_at = now()
   WHERE id = v_secret_id;

  RETURN QUERY SELECT v_conn.id, v_conn.organization_id, v_conn.slug,
                      v_conn.adapter_kind, v_conn.status;
END $fn$;

ALTER FUNCTION public.nx_integration_resolve_connector(text) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_resolve_connector(text) IS
  'Hashes a presented bearer token and returns the live connector it belongs to, or NO ROW for '
  'an unknown, revoked or non-inbound secret — the caller can therefore only ever distinguish '
  '"valid" from "not valid", never "wrong connector". Stamps last_used_at. Service-context only: '
  'an end-user session cannot trade a guessed token for a connector identity. Never returns, '
  'logs or accepts a plaintext secret beyond the single hashing step.';

-- ─── issue / revoke a credential (metadata out, never the digest) ───────────
CREATE OR REPLACE FUNCTION public.nx_integration_register_secret(
  p_connector_id uuid, p_token_hash text, p_label text DEFAULT NULL,
  p_secret_kind text DEFAULT 'inbound_token')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id uuid; v_hash text;
BEGIN
  IF NOT public.nx_integration_can_administer(p_connector_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  v_hash := lower(btrim(COALESCE(p_token_hash, '')));
  --  The caller hashes. This function REFUSES anything that is not already a
  --  digest, which is what makes accidental plaintext storage impossible
  --  rather than merely discouraged.
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'INVALID_SECRET_DIGEST: expected a lowercase sha256 hex digest, never a plaintext token'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.integration_connector_secrets
    (connector_id, secret_kind, token_hash, token_prefix, label, created_by)
  VALUES (p_connector_id, COALESCE(p_secret_kind, 'inbound_token'), v_hash,
          substr(v_hash, 1, 8), p_label, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'secret_id', v_id, 'token_prefix', substr(v_hash, 1, 8));
END $fn$;

ALTER FUNCTION public.nx_integration_register_secret(uuid,text,text,text) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_register_secret(uuid,text,text,text) IS
  'Registers an ALREADY-HASHED connector credential. Refuses anything that is not a lowercase '
  'sha256 hex digest, so a plaintext token cannot reach the database through this path. Returns '
  'only the id and the non-secret prefix. Org-admin or platform-admin authority.';

CREATE OR REPLACE FUNCTION public.nx_integration_revoke_secret(p_secret_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_connector uuid; v_revoked timestamptz;
BEGIN
  SELECT connector_id, revoked_at INTO v_connector, v_revoked
    FROM public.integration_connector_secrets WHERE id = p_secret_id;
  IF v_connector IS NULL THEN
    RAISE EXCEPTION 'SECRET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nx_integration_can_administer(v_connector) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF v_revoked IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'secret_id', p_secret_id);
  END IF;

  UPDATE public.integration_connector_secrets
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = p_secret_id;

  RETURN jsonb_build_object('ok', true, 'secret_id', p_secret_id);
END $fn$;

ALTER FUNCTION public.nx_integration_revoke_secret(uuid) OWNER TO postgres;

-- ─── validation of a canonical record against the registry ──────────────────
CREATE OR REPLACE FUNCTION public.nx_integration_validate_canonical(
  p_entity_type text, p_canonical jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_errors text[] := '{}'::text[];
  r record;
  v_key text;
  v_val text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.integration_canonical_entities
                  WHERE entity_type = p_entity_type) THEN
    RETURN jsonb_build_object('ok', false,
      'errors', to_jsonb(ARRAY['unknown canonical entity: ' || COALESCE(p_entity_type, '<null>')]));
  END IF;

  IF p_canonical IS NULL OR jsonb_typeof(p_canonical) <> 'object' THEN
    RETURN jsonb_build_object('ok', false,
      'errors', to_jsonb(ARRAY['canonical record must be a JSON object']));
  END IF;

  --  1. every required field present and non-null
  FOR r IN
    SELECT canonical_field, data_type FROM public.integration_canonical_fields
     WHERE entity_type = p_entity_type AND is_required
  LOOP
    IF NOT (p_canonical ? r.canonical_field)
       OR jsonb_typeof(p_canonical -> r.canonical_field) = 'null'
       OR btrim(COALESCE(p_canonical ->> r.canonical_field, '')) = '' THEN
      v_errors := v_errors || ('missing required field: ' || r.canonical_field);
    END IF;
  END LOOP;

  --  2. no unknown field may survive mapping. An unknown field means the
  --     mapping and the canonical shape disagree, and silently dropping it
  --     would lose data the sender believed it delivered.
  FOR v_key IN SELECT jsonb_object_keys(p_canonical)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.integration_canonical_fields
                    WHERE entity_type = p_entity_type AND canonical_field = v_key) THEN
      v_errors := v_errors || ('unknown canonical field: ' || v_key);
    END IF;
  END LOOP;

  --  3. type coherence, driven by the registry
  FOR r IN
    SELECT canonical_field, data_type FROM public.integration_canonical_fields
     WHERE entity_type = p_entity_type
  LOOP
    IF (p_canonical ? r.canonical_field)
       AND jsonb_typeof(p_canonical -> r.canonical_field) <> 'null' THEN
      v_val := p_canonical ->> r.canonical_field;
      IF r.data_type = 'number' AND v_val !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        v_errors := v_errors || (r.canonical_field || ': not a number');
      ELSIF r.data_type = 'boolean'
            AND lower(v_val) NOT IN ('true','false','t','f','1','0','yes','no') THEN
        v_errors := v_errors || (r.canonical_field || ': not a boolean');
      ELSIF r.data_type = 'uuid'
            AND v_val !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_errors := v_errors || (r.canonical_field || ': not a uuid');
      ELSIF r.data_type = 'timestamp' THEN
        BEGIN
          PERFORM v_val::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors || (r.canonical_field || ': not a timestamp');
        END;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors));
END $fn$;

ALTER FUNCTION public.nx_integration_validate_canonical(text,jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_validate_canonical(text,jsonb) IS
  'Validates a MAPPED record against integration_canonical_fields: every required field present '
  'and non-blank, no unknown field surviving mapping, and every value coherent with its '
  'registered data_type. An unknown field is an ERROR rather than a silent drop, because '
  'dropping it would lose data the sender believed it delivered. Returns {ok, errors[]} and '
  'never raises, so the caller decides whether the defect is terminal.';

-- ─── mapping an inbound payload into the canonical shape ────────────────────
CREATE OR REPLACE FUNCTION public.nx_integration_map_payload(
  p_connector_id uuid, p_entity_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_version_id uuid;
  v_canonical  jsonb := '{}'::jsonb;
  r record;
  v_raw text;
BEGIN
  SELECT id INTO v_version_id
    FROM public.integration_mapping_versions
   WHERE connector_id = p_connector_id
     AND entity_type  = p_entity_type
     AND status       = 'active';

  IF v_version_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'no_active_mapping',
      'errors', to_jsonb(ARRAY[
        'no active mapping version for entity ' || p_entity_type ||
        ' on this connector — configure one, then replay']));
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_payload',
      'mapping_version_id', v_version_id,
      'errors', to_jsonb(ARRAY['inbound payload must be a JSON object']));
  END IF;

  FOR r IN
    SELECT external_field, canonical_field, transform, default_value
      FROM public.integration_field_mappings
     WHERE version_id = v_version_id
  LOOP
    IF (p_payload ? r.external_field)
       AND jsonb_typeof(p_payload -> r.external_field) <> 'null' THEN
      v_raw := p_payload ->> r.external_field;
    ELSE
      v_raw := r.default_value;
    END IF;

    IF v_raw IS NOT NULL THEN
      v_raw := CASE r.transform
                 WHEN 'trim'  THEN btrim(v_raw)
                 WHEN 'upper' THEN upper(btrim(v_raw))
                 WHEN 'lower' THEN lower(btrim(v_raw))
                 ELSE v_raw
               END;
      v_canonical := v_canonical || jsonb_build_object(r.canonical_field, v_raw);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'mapping_version_id', v_version_id,
                            'canonical', v_canonical);
END $fn$;

ALTER FUNCTION public.nx_integration_map_payload(uuid,text,jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_map_payload(uuid,text,jsonb) IS
  'Applies the ACTIVE mapping version for (connector, entity) to an inbound payload and returns '
  'the canonical record. A missing active mapping is a RETRYABLE configuration error, not a '
  'permanent one — the operator adds the mapping and replays, and the stored payload is still '
  'there to replay from. Unmapped external fields are simply not carried: the canonical shape is '
  'the contract, and a field with no canonical home has nowhere to go by construction.';

-- ─── CLAIM: the idempotency gate. Modelled on claim_stripe_webhook_event. ───
CREATE OR REPLACE FUNCTION public.nx_integration_claim_message(
  p_connector_id  uuid,
  p_external_id   text,
  p_entity_type   text,
  p_payload       jsonb,
  p_external_ref  text DEFAULT NULL)
RETURNS TABLE (claimed boolean, reason text, message_id uuid, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org       uuid;
  v_status    text;
  v_conn      record;
  v_digest    text;
  v_row       record;
  v_id        uuid;
BEGIN
  IF NOT public.nx_integration_is_service_context() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT c.organization_id, c.status, c.max_attempts, c.retry_base_seconds, c.retry_max_seconds
    INTO v_conn
    FROM public.integration_connectors c WHERE c.id = p_connector_id;
  IF v_conn IS NULL THEN
    RAISE EXCEPTION 'CONNECTOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_conn.status <> 'active' THEN
    RAISE EXCEPTION
      'CONNECTOR_NOT_ACTIVE: connector is % — a paused or revoked connector accepts nothing',
      v_conn.status USING ERRCODE = '42501';
  END IF;
  v_org := v_conn.organization_id;

  IF p_external_id IS NULL OR length(btrim(p_external_id)) = 0 THEN
    RAISE EXCEPTION
      'EXTERNAL_ID_REQUIRED: every inbound message must carry the sender''s own identifier — without one there is nothing to be idempotent about'
      USING ERRCODE = '22023';
  END IF;

  v_digest := encode(extensions.digest(COALESCE(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex');

  --  ── The house pattern (baseline:6689): insert-or-nothing, then inspect ──
  INSERT INTO public.integration_inbound_messages
    (connector_id, organization_id, external_id, entity_type, external_ref,
     payload, payload_digest, status, attempts, claimed_at)
  VALUES
    (p_connector_id, v_org, btrim(p_external_id), p_entity_type, p_external_ref,
     COALESCE(p_payload, '{}'::jsonb), v_digest, 'processing', 1, now())
  ON CONFLICT (connector_id, external_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'newly_claimed'::text, v_id, 1;
    RETURN;
  END IF;

  --  ── A row already exists. THIS IS THE REPLAY PATH. ─────────────────────
  SELECT * INTO v_row
    FROM public.integration_inbound_messages
   WHERE connector_id = p_connector_id AND external_id = btrim(p_external_id)
   FOR UPDATE;

  --  A sender reusing one external id for two DIFFERENT bodies is an ERP
  --  defect. Count it and surface it; never overwrite the stored payload,
  --  because doing so would rewrite history under an operator who already
  --  read it.
  IF v_row.payload_digest IS DISTINCT FROM v_digest THEN
    UPDATE public.integration_inbound_messages
       SET payload_conflict_count = payload_conflict_count + 1,
           last_conflict_at = now()
     WHERE id = v_row.id;
  END IF;

  IF v_row.status = 'completed' THEN
    --  THE IDEMPOTENCY GUARANTEE. A replay of a processed message does
    --  nothing at all, and the caller answers the sender 200.
    RETURN QUERY SELECT false, 'already_completed'::text, v_row.id, v_row.attempts;
    RETURN;
  END IF;

  IF v_row.status = 'processing' THEN
    RETURN QUERY SELECT false, 'in_flight_elsewhere'::text, v_row.id, v_row.attempts;
    RETURN;
  END IF;

  IF v_row.status = 'dead_letter' THEN
    RETURN QUERY SELECT false, 'dead_letter'::text, v_row.id, v_row.attempts;
    RETURN;
  END IF;

  IF v_row.status = 'rejected' THEN
    RETURN QUERY SELECT false, 'rejected_invalid'::text, v_row.id, v_row.attempts;
    RETURN;
  END IF;

  IF v_row.status IN ('received', 'failed_retryable') THEN
    IF v_row.next_attempt_at IS NOT NULL AND v_row.next_attempt_at > now() THEN
      RETURN QUERY SELECT false, 'backoff_not_elapsed'::text, v_row.id, v_row.attempts;
      RETURN;
    END IF;
    UPDATE public.integration_inbound_messages
       SET status = 'processing', claimed_at = now(), attempts = attempts + 1
     WHERE id = v_row.id
     RETURNING attempts INTO v_row.attempts;
    RETURN QUERY SELECT true, 'reclaimed'::text, v_row.id, v_row.attempts;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'unknown_status'::text, v_row.id, v_row.attempts;
END $fn$;

ALTER FUNCTION public.nx_integration_claim_message(uuid,text,text,jsonb,text) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_claim_message(uuid,text,text,jsonb,text) IS
  'THE idempotency gate, and the most important function in the integration core. Reproduces the '
  'house claim-then-process lifecycle of claim_stripe_webhook_event (baseline:6682) — INSERT ... '
  'ON CONFLICT DO NOTHING, then inspect the existing row — and adds what an ERP needs and Stripe '
  'does not: per-connector key scoping, attempt counting, a backoff gate, a terminal dead_letter '
  'state and payload-divergence detection. A replay of a completed message returns '
  'claimed=false/already_completed and changes NOTHING, so the caller answers 200 and the sender '
  'stops. The stored payload of a completed message is never overwritten. Refuses a paused or '
  'revoked connector outright. Service-context or platform-admin only.';

-- ─── COMPLETE / FAIL — the two ways out, both of which write a row ──────────
CREATE OR REPLACE FUNCTION public.nx_integration_complete_message(
  p_message_id uuid, p_canonical jsonb DEFAULT NULL, p_mapping_version_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_status text;
BEGIN
  IF NOT public.nx_integration_is_service_context() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
    FROM public.integration_inbound_messages WHERE id = p_message_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message_id', p_message_id);
  END IF;

  UPDATE public.integration_inbound_messages
     SET status = 'completed',
         processed_at = now(),
         canonical = COALESCE(p_canonical, canonical),
         mapping_version_id = COALESCE(p_mapping_version_id, mapping_version_id),
         next_attempt_at = NULL,
         last_error = NULL
   WHERE id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', p_message_id, 'status', 'completed');
END $fn$;

ALTER FUNCTION public.nx_integration_complete_message(uuid,jsonb,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.nx_integration_fail_message(
  p_message_id uuid,
  p_error      text,
  p_permanent  boolean DEFAULT false,
  p_validation_errors jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_msg  record;
  v_conn record;
  v_next timestamptz;
  v_terminal boolean;
  v_status text;
BEGIN
  IF NOT public.nx_integration_is_service_context() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_msg
    FROM public.integration_inbound_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.status IN ('completed','dead_letter','rejected') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
                              'message_id', p_message_id, 'status', v_msg.status);
  END IF;

  SELECT max_attempts, retry_base_seconds, retry_max_seconds INTO v_conn
    FROM public.integration_connectors WHERE id = v_msg.connector_id;

  --  A validation defect is TERMINAL, and terminal in its own state. Retrying
  --  a byte-identical payload against an unchanged canonical shape can never
  --  succeed, so burning eight attempts to learn that is pure noise.
  IF p_validation_errors IS NOT NULL THEN
    UPDATE public.integration_inbound_messages
       SET status = 'rejected',
           last_error = COALESCE(p_error, 'canonical validation failed'),
           validation_errors = p_validation_errors,
           next_attempt_at = NULL
     WHERE id = p_message_id;
    RETURN jsonb_build_object('ok', true, 'message_id', p_message_id,
                              'status', 'rejected', 'terminal', true);
  END IF;

  v_terminal := COALESCE(p_permanent, false)
                OR v_msg.attempts >= COALESCE(v_conn.max_attempts, 8);

  IF v_terminal THEN
    --  DEAD LETTER. The payload, the attempt count and the last error all
    --  survive, and the row is visible in integration_dead_letter_queue. This
    --  is the "never silently swallowed" guarantee.
    UPDATE public.integration_inbound_messages
       SET status = 'dead_letter',
           dead_lettered_at = now(),
           last_error = COALESCE(p_error, 'permanent failure'),
           next_attempt_at = NULL
     WHERE id = p_message_id;
    v_status := 'dead_letter';
  ELSE
    v_next := now() + public.nx_integration_backoff_interval(
                        v_msg.attempts,
                        COALESCE(v_conn.retry_base_seconds, 30),
                        COALESCE(v_conn.retry_max_seconds, 3600),
                        p_message_id);
    UPDATE public.integration_inbound_messages
       SET status = 'failed_retryable',
           last_error = COALESCE(p_error, 'transient failure'),
           next_attempt_at = v_next
     WHERE id = p_message_id;
    v_status := 'failed_retryable';
  END IF;

  RETURN jsonb_build_object('ok', true, 'message_id', p_message_id, 'status', v_status,
                            'attempts', v_msg.attempts,
                            'next_attempt_at', v_next,
                            'terminal', v_terminal);
END $fn$;

ALTER FUNCTION public.nx_integration_fail_message(uuid,text,boolean,jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_fail_message(uuid,text,boolean,jsonb) IS
  'The only failure exit, and it always writes a row. Three outcomes: REJECTED when '
  'p_validation_errors is supplied (terminal immediately — an identical payload can never pass a '
  'shape it already failed); DEAD_LETTER when the failure is permanent or the connector''s '
  'max_attempts is exhausted; otherwise FAILED_RETRYABLE with next_attempt_at set from '
  'nx_integration_backoff_interval. In every case the payload, the attempt count and the error '
  'survive on the row. Nothing is ever discarded.';

-- ─── PROCESS: map, validate, link, record. Writes NOTHING outside this lane. ─
CREATE OR REPLACE FUNCTION public.nx_integration_process_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_msg        record;
  v_map        jsonb;
  v_canonical  jsonb;
  v_version    uuid;
  v_valid      jsonb;
  v_ref        text;
  v_link       record;
  v_link_id    uuid;
  v_kind       text;
  v_changed    text[];
BEGIN
  IF NOT public.nx_integration_is_service_context() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_msg
    FROM public.integration_inbound_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'completed');
  END IF;

  -- 1. map
  v_map := public.nx_integration_map_payload(v_msg.connector_id, v_msg.entity_type, v_msg.payload);
  IF NOT (v_map ->> 'ok')::boolean THEN
    --  A missing mapping is a CONFIGURATION error: retryable, because the
    --  operator can fix it and the stored payload is still there to replay.
    RETURN public.nx_integration_fail_message(
      p_message_id,
      'mapping failed: ' || COALESCE(v_map ->> 'reason', 'unknown') || ' ' || COALESCE(v_map ->> 'errors', ''),
      false, NULL);
  END IF;

  v_version   := (v_map ->> 'mapping_version_id')::uuid;
  v_canonical := v_map -> 'canonical';

  -- 2. validate
  v_valid := public.nx_integration_validate_canonical(v_msg.entity_type, v_canonical);
  IF NOT (v_valid ->> 'ok')::boolean THEN
    UPDATE public.integration_inbound_messages
       SET canonical = v_canonical, mapping_version_id = v_version
     WHERE id = p_message_id;
    RETURN public.nx_integration_fail_message(
      p_message_id, 'canonical validation failed', true, v_valid -> 'errors');
  END IF;

  -- 3. link. external_ref on the message wins; otherwise the canonical one.
  v_ref := COALESCE(NULLIF(btrim(COALESCE(v_msg.external_ref, '')), ''),
                    v_canonical ->> 'external_ref');
  IF v_ref IS NULL OR btrim(v_ref) = '' THEN
    RETURN public.nx_integration_fail_message(
      p_message_id, 'no external reference to link against', true,
      to_jsonb(ARRAY['external_ref is required to identify the record this message is about']));
  END IF;

  SELECT * INTO v_link
    FROM public.integration_record_links
   WHERE connector_id = v_msg.connector_id
     AND entity_type  = v_msg.entity_type
     AND external_ref = v_ref
   FOR UPDATE;

  IF v_link IS NULL THEN
    INSERT INTO public.integration_record_links
      (connector_id, organization_id, entity_type, external_ref,
       last_canonical, last_message_id, last_synced_at)
    VALUES (v_msg.connector_id, v_msg.organization_id, v_msg.entity_type, v_ref,
            v_canonical, p_message_id, now())
    RETURNING id INTO v_link_id;
    v_kind := 'create';
    v_changed := ARRAY(SELECT jsonb_object_keys(v_canonical));
  ELSE
    v_link_id := v_link.id;
    SELECT COALESCE(array_agg(k), '{}'::text[]) INTO v_changed
      FROM (
        SELECT k FROM jsonb_object_keys(
                 COALESCE(v_link.last_canonical, '{}'::jsonb) || v_canonical) AS k
         WHERE (COALESCE(v_link.last_canonical, '{}'::jsonb) ->> k)
               IS DISTINCT FROM (v_canonical ->> k)
      ) d;
    --  An idempotent replay that changes nothing is still RECORDED. "Nothing
    --  happened" and "nothing arrived" are different facts, and an operator
    --  debugging a connector needs to tell them apart.
    v_kind := CASE WHEN cardinality(v_changed) = 0 THEN 'noop_replay' ELSE 'update' END;

    UPDATE public.integration_record_links
       SET last_canonical  = v_canonical,
           last_message_id = p_message_id,
           last_synced_at  = now()
     WHERE id = v_link_id;
  END IF;

  -- 4. history
  INSERT INTO public.integration_record_history
    (link_id, message_id, organization_id, change_kind, actor_kind,
     before_state, after_state, changed_fields)
  VALUES (v_link_id, p_message_id, v_msg.organization_id, v_kind, 'connector',
          CASE WHEN v_link IS NULL THEN NULL ELSE v_link.last_canonical END,
          v_canonical, COALESCE(v_changed, '{}'::text[]));

  -- 5. complete
  PERFORM public.nx_integration_complete_message(p_message_id, v_canonical, v_version);

  RETURN jsonb_build_object('ok', true, 'status', 'completed', 'message_id', p_message_id,
                            'link_id', v_link_id, 'change_kind', v_kind,
                            'changed_fields', to_jsonb(COALESCE(v_changed, '{}'::text[])));
END $fn$;

ALTER FUNCTION public.nx_integration_process_message(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_process_message(uuid) IS
  'The worker: map -> validate -> link -> record history -> complete. WRITES NOTHING OUTSIDE THE '
  'integration_ tables — it does not write jobs, projects, reports or any money surface, which is '
  'proof P3 that an ERP cannot settle a job through this core. A mapping gap is retryable (the '
  'operator configures it and replays); a validation failure is terminal (an identical payload '
  'can never pass). Records a noop_replay history row when an idempotent replay changes nothing, '
  'because "nothing happened" and "nothing arrived" are different facts.';

-- ─── BIND: the adapter seam, and the only path to an internal row ───────────
CREATE OR REPLACE FUNCTION public.nx_integration_bind_record(
  p_link_id uuid, p_internal_table text, p_internal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_link record;
BEGIN
  SELECT * INTO v_link FROM public.integration_record_links WHERE id = p_link_id FOR UPDATE;
  IF v_link IS NULL THEN
    RAISE EXCEPTION 'LINK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nx_integration_can_administer(v_link.connector_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF v_link.internal_table IS NOT NULL
     AND v_link.internal_table = p_internal_table
     AND v_link.internal_id = p_internal_id THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'link_id', p_link_id);
  END IF;

  --  The allowlist CHECK on the table is the real gate (proof P2); this is the
  --  friendly error before the constraint fires.
  IF p_internal_table IS NULL OR p_internal_table <> ALL (ARRAY[
       'jobs','projects','reports','supplier_profiles','deal_nonconformances','inspection_events']) THEN
    RAISE EXCEPTION
      'TARGET_NOT_ALLOWED: % is not a bindable target. The integration core may only ever reference operational records — no wallet, transaction, payout, funding or price-bearing table is reachable from a connector.',
      COALESCE(p_internal_table, '<null>')
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.integration_record_links
     SET internal_table = p_internal_table,
         internal_id    = p_internal_id,
         bound_at       = now(),
         bound_by       = auth.uid()
   WHERE id = p_link_id;

  INSERT INTO public.integration_record_history
    (link_id, message_id, organization_id, change_kind, actor_kind, actor_id,
     before_state, after_state, note)
  VALUES (p_link_id, NULL, v_link.organization_id, 'bind', 'operator', auth.uid(),
          jsonb_build_object('internal_table', v_link.internal_table,
                             'internal_id', v_link.internal_id),
          jsonb_build_object('internal_table', p_internal_table,
                             'internal_id', p_internal_id),
          'operator bound the external reference to an internal record');

  RETURN jsonb_build_object('ok', true, 'link_id', p_link_id,
                            'internal_table', p_internal_table, 'internal_id', p_internal_id);
END $fn$;

ALTER FUNCTION public.nx_integration_bind_record(uuid,text,uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_bind_record(uuid,text,uuid) IS
  'THE ADAPTER SEAM: an authorised operator declares that an external reference IS a given '
  'internal record. Deliberately an explicit human act rather than something an inbound message '
  'can do on its own — a connector that could bind its own targets could point an ERP at any row '
  'it liked. Writes only integration_record_links and its history; the bound BUSINESS row is '
  'never touched. Targets are restricted to the six operational tables, and cross-org binds are '
  'refused by nx_integration_guard_link_org.';

-- ─── REPLAY: the operator's recovery for a dead-lettered message ────────────
CREATE OR REPLACE FUNCTION public.nx_integration_replay_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_msg record;
BEGIN
  SELECT * INTO v_msg
    FROM public.integration_inbound_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nx_integration_can_administer(v_msg.connector_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  --  Replaying a COMPLETED message is refused, not silently allowed. The whole
  --  guarantee of this lane is that a processed external id is processed once;
  --  an operator-triggered reprocess would break exactly that, and would do it
  --  invisibly. If a completed message really must be reprocessed, the sender
  --  must send a NEW external id — which is the honest way to say "this is a
  --  different message".
  IF v_msg.status = 'completed' THEN
    RAISE EXCEPTION
      'ALREADY_COMPLETED: message % was processed successfully; replaying it would break the idempotency guarantee. Send a new external id instead.',
      p_message_id USING ERRCODE = '22000';
  END IF;
  IF v_msg.status = 'processing' THEN
    RAISE EXCEPTION
      'IN_FLIGHT: message % is being processed right now', p_message_id USING ERRCODE = '22000';
  END IF;

  UPDATE public.integration_inbound_messages
     SET status = 'received',
         attempts = 0,
         next_attempt_at = now(),
         dead_lettered_at = NULL,
         validation_errors = NULL,
         replay_count = replay_count + 1,
         last_replayed_at = now(),
         last_replayed_by = auth.uid()
   WHERE id = p_message_id;

  --  A replay request is itself auditable, even when the message never
  --  produced a link (so there is nothing to hang a link-scoped history row
  --  on). Where a link exists we record against it.
  INSERT INTO public.integration_record_history
    (link_id, message_id, organization_id, change_kind, actor_kind, actor_id, note)
  SELECT l.id, p_message_id, v_msg.organization_id, 'replay_requested', 'operator', auth.uid(),
         'operator requeued a ' || v_msg.status || ' message'
    FROM public.integration_record_links l
   WHERE l.connector_id = v_msg.connector_id
     AND l.entity_type  = v_msg.entity_type
     AND l.external_ref = COALESCE(NULLIF(btrim(COALESCE(v_msg.external_ref, '')), ''),
                                   v_msg.canonical ->> 'external_ref');

  RETURN jsonb_build_object('ok', true, 'message_id', p_message_id,
                            'status', 'received', 'from_status', v_msg.status,
                            'replay_count', v_msg.replay_count + 1);
END $fn$;

ALTER FUNCTION public.nx_integration_replay_message(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.nx_integration_replay_message(uuid) IS
  'The operator''s recovery path for a dead_letter, rejected or failed_retryable message: resets '
  'it to received with attempts=0 so the next delivery attempt runs it again, on the SAME row — '
  'so the idempotency key is preserved and a replay can never fork a message in two. REFUSES to '
  'replay a completed message: reprocessing a successfully-processed external id is exactly what '
  'this lane exists to prevent, and a sender that genuinely has a new message must give it a new '
  'external id. Org-admin or platform-admin authority.';

-- ════════════════════════════════════════════════════════════════════════════
--  §8. OBSERVABILITY — derived, never stored
--
--  Counts are summed on read from the one ledger. A stored counter would be a
--  second source of truth that drifts the first time a message is replayed —
--  the same reasoning that keeps nx_program_rollup derived (20260801468000:17).
--
--  security_invoker so the views inherit the base tables' RLS instead of
--  running as their owner; without it a view is a hole straight through every
--  org policy below.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.integration_connector_health;
CREATE VIEW public.integration_connector_health
WITH (security_invoker = on) AS
SELECT
  c.id                AS connector_id,
  c.organization_id,
  c.slug,
  c.display_name,
  c.adapter_kind,
  c.status            AS connector_status,
  count(m.id)                                                      AS total_messages,
  count(m.id) FILTER (WHERE m.status = 'completed')                AS completed_count,
  count(m.id) FILTER (WHERE m.status = 'processing')               AS in_flight_count,
  count(m.id) FILTER (WHERE m.status = 'failed_retryable')         AS retrying_count,
  count(m.id) FILTER (WHERE m.status = 'dead_letter')              AS dead_letter_count,
  count(m.id) FILTER (WHERE m.status = 'rejected')                 AS rejected_count,
  count(m.id) FILTER (WHERE m.payload_conflict_count > 0)          AS payload_conflict_count,
  max(m.processed_at) FILTER (WHERE m.status = 'completed')        AS last_success_at,
  max(m.updated_at)   FILTER (WHERE m.status IN ('failed_retryable','dead_letter','rejected'))
                                                                   AS last_failure_at,
  max(m.received_at)                                               AS last_message_at
FROM public.integration_connectors c
LEFT JOIN public.integration_inbound_messages m ON m.connector_id = c.id
GROUP BY c.id, c.organization_id, c.slug, c.display_name, c.adapter_kind, c.status;

COMMENT ON VIEW public.integration_connector_health IS
  'Per-connector success/failure counts and last-sync state, DERIVED from the ledger on read. No '
  'stored counter, because a stored counter drifts the first time a message is replayed. '
  'security_invoker so it inherits the RLS of integration_connectors and '
  'integration_inbound_messages rather than running as its owner — without that a view is a hole '
  'straight through every org policy.';

DROP VIEW IF EXISTS public.integration_entity_sync_state;
CREATE VIEW public.integration_entity_sync_state
WITH (security_invoker = on) AS
SELECT
  m.connector_id,
  m.organization_id,
  m.entity_type,
  count(*)                                                  AS total_messages,
  count(*) FILTER (WHERE m.status = 'completed')            AS completed_count,
  count(*) FILTER (WHERE m.status = 'dead_letter')          AS dead_letter_count,
  count(*) FILTER (WHERE m.status = 'rejected')             AS rejected_count,
  max(m.processed_at) FILTER (WHERE m.status = 'completed') AS last_success_at,
  max(m.received_at)                                        AS last_message_at
FROM public.integration_inbound_messages m
GROUP BY m.connector_id, m.organization_id, m.entity_type;

COMMENT ON VIEW public.integration_entity_sync_state IS
  'Last-sync state per connector AND canonical entity, so an operator can see that suppliers are '
  'flowing while inspection requests have been dead-lettering for two days — a per-connector '
  'roll-up alone hides exactly that failure.';

DROP VIEW IF EXISTS public.integration_dead_letter_queue;
CREATE VIEW public.integration_dead_letter_queue
WITH (security_invoker = on) AS
SELECT
  m.id            AS message_id,
  m.connector_id,
  m.organization_id,
  c.slug          AS connector_slug,
  m.entity_type,
  m.external_id,
  m.external_ref,
  m.status,
  m.attempts,
  m.last_error,
  m.validation_errors,
  m.payload,
  m.payload_conflict_count,
  m.replay_count,
  m.last_replayed_at,
  m.received_at,
  m.dead_lettered_at,
  m.updated_at
FROM public.integration_inbound_messages m
JOIN public.integration_connectors c ON c.id = m.connector_id
WHERE m.status IN ('dead_letter', 'rejected');

COMMENT ON VIEW public.integration_dead_letter_queue IS
  'THE operator failure queue: every message that ended terminally, with its full payload, its '
  'attempt count and the exact error. A VIEW over the ONE ledger rather than a second table — a '
  'separate failure table would be a second source of truth for the same message and would drift '
  'from the first the moment one was replayed. Replay with nx_integration_replay_message.';

-- ════════════════════════════════════════════════════════════════════════════
--  §9. RLS + GRANTS
--
--  ── A NOTE ON THE TWO MEMBERSHIP MODELS, WHICH THIS LANE DOES NOT UNIFY ────
--  This repository has two: profiles.organization_id (which nx_is_org_member
--  reads, 20260801468000:38, and which get_organization_members also reads) and
--  public.org_members with an org_member_role (which nx_user_is_org_admin
--  reads, baseline:14672). Unifying them is a real piece of work and is NOT
--  this lane's — doing it here would be a cross-cutting identity change hidden
--  inside an integration migration.
--
--  So the split is explicit and fails SAFE in both directions:
--    READ  — either model admits you. Both are genuine evidence of membership,
--            and a member who cannot see their own connector's health is a
--            support ticket, not a security property.
--    WRITE — the STRICTER org_members model only (nx_user_is_org_admin), so
--            an ambient profiles.organization_id can never grant authority to
--            replay a message, bind a record or revoke a credential.
--
--  NO GRANT TO anon ANYWHERE. Enforced by the 20260801442000 /
--  20260801446000 posture and asserted in §10.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.integration_canonical_entities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_canonical_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connectors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connector_secrets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_mapping_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_field_mappings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_inbound_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_record_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_record_history      ENABLE ROW LEVEL SECURITY;

-- ─── the canonical contract is reference data: readable, admin-writable ─────
DROP POLICY IF EXISTS integration_canonical_entities_admin_all ON public.integration_canonical_entities;
CREATE POLICY integration_canonical_entities_admin_all ON public.integration_canonical_entities
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_canonical_entities_read ON public.integration_canonical_entities;
CREATE POLICY integration_canonical_entities_read ON public.integration_canonical_entities
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS integration_canonical_fields_admin_all ON public.integration_canonical_fields;
CREATE POLICY integration_canonical_fields_admin_all ON public.integration_canonical_fields
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_canonical_fields_read ON public.integration_canonical_fields;
CREATE POLICY integration_canonical_fields_read ON public.integration_canonical_fields
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─── connectors ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS integration_connectors_admin_all ON public.integration_connectors;
CREATE POLICY integration_connectors_admin_all ON public.integration_connectors
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_connectors_org_read ON public.integration_connectors;
CREATE POLICY integration_connectors_org_read ON public.integration_connectors
  FOR SELECT USING (
    public.nx_is_org_member(organization_id, auth.uid())
    OR public.nx_user_is_org_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS integration_connectors_org_admin_write ON public.integration_connectors;
CREATE POLICY integration_connectors_org_admin_write ON public.integration_connectors
  FOR UPDATE
  USING (public.nx_user_is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.nx_user_is_org_admin(auth.uid(), organization_id));

-- ─── secrets: platform admin ONLY. No org user reads a digest, ever. ────────
DROP POLICY IF EXISTS integration_connector_secrets_admin_all ON public.integration_connector_secrets;
CREATE POLICY integration_connector_secrets_admin_all ON public.integration_connector_secrets
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- ─── mappings ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS integration_mapping_versions_admin_all ON public.integration_mapping_versions;
CREATE POLICY integration_mapping_versions_admin_all ON public.integration_mapping_versions
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_mapping_versions_org_read ON public.integration_mapping_versions;
CREATE POLICY integration_mapping_versions_org_read ON public.integration_mapping_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.integration_connectors c
             WHERE c.id = integration_mapping_versions.connector_id
               AND (public.nx_is_org_member(c.organization_id, auth.uid())
                    OR public.nx_user_is_org_admin(auth.uid(), c.organization_id)))
  );

DROP POLICY IF EXISTS integration_mapping_versions_org_admin_write ON public.integration_mapping_versions;
CREATE POLICY integration_mapping_versions_org_admin_write ON public.integration_mapping_versions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.integration_connectors c
             WHERE c.id = integration_mapping_versions.connector_id
               AND public.nx_user_is_org_admin(auth.uid(), c.organization_id)))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.integration_connectors c
             WHERE c.id = integration_mapping_versions.connector_id
               AND public.nx_user_is_org_admin(auth.uid(), c.organization_id)));

DROP POLICY IF EXISTS integration_field_mappings_admin_all ON public.integration_field_mappings;
CREATE POLICY integration_field_mappings_admin_all ON public.integration_field_mappings
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_field_mappings_org_read ON public.integration_field_mappings;
CREATE POLICY integration_field_mappings_org_read ON public.integration_field_mappings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.integration_mapping_versions v
              JOIN public.integration_connectors c ON c.id = v.connector_id
             WHERE v.id = integration_field_mappings.version_id
               AND (public.nx_is_org_member(c.organization_id, auth.uid())
                    OR public.nx_user_is_org_admin(auth.uid(), c.organization_id)))
  );

DROP POLICY IF EXISTS integration_field_mappings_org_admin_write ON public.integration_field_mappings;
CREATE POLICY integration_field_mappings_org_admin_write ON public.integration_field_mappings
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.integration_mapping_versions v
              JOIN public.integration_connectors c ON c.id = v.connector_id
             WHERE v.id = integration_field_mappings.version_id
               AND public.nx_user_is_org_admin(auth.uid(), c.organization_id)))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.integration_mapping_versions v
              JOIN public.integration_connectors c ON c.id = v.connector_id
             WHERE v.id = integration_field_mappings.version_id
               AND public.nx_user_is_org_admin(auth.uid(), c.organization_id)));

-- ─── the ledger: raw tenant payloads. Org ADMIN read only, no user write. ───
DROP POLICY IF EXISTS integration_inbound_messages_admin_all ON public.integration_inbound_messages;
CREATE POLICY integration_inbound_messages_admin_all ON public.integration_inbound_messages
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_inbound_messages_org_admin_read ON public.integration_inbound_messages;
CREATE POLICY integration_inbound_messages_org_admin_read ON public.integration_inbound_messages
  FOR SELECT USING (public.nx_user_is_org_admin(auth.uid(), organization_id));

-- ─── links + history: visible to the org, written only through the RPCs ────
DROP POLICY IF EXISTS integration_record_links_admin_all ON public.integration_record_links;
CREATE POLICY integration_record_links_admin_all ON public.integration_record_links
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS integration_record_links_org_read ON public.integration_record_links;
CREATE POLICY integration_record_links_org_read ON public.integration_record_links
  FOR SELECT USING (
    public.nx_is_org_member(organization_id, auth.uid())
    OR public.nx_user_is_org_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS integration_record_history_admin_read ON public.integration_record_history;
CREATE POLICY integration_record_history_admin_read ON public.integration_record_history
  FOR SELECT USING (public.nx_is_admin());

DROP POLICY IF EXISTS integration_record_history_org_read ON public.integration_record_history;
CREATE POLICY integration_record_history_org_read ON public.integration_record_history
  FOR SELECT USING (
    public.nx_is_org_member(organization_id, auth.uid())
    OR public.nx_user_is_org_admin(auth.uid(), organization_id)
  );

-- ─── grants. anon gets NOTHING, anywhere. ───────────────────────────────────
REVOKE ALL ON TABLE public.integration_canonical_entities  FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_canonical_fields    FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_connectors          FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_connector_secrets   FROM anon, PUBLIC, authenticated;
REVOKE ALL ON TABLE public.integration_mapping_versions    FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_field_mappings      FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_inbound_messages    FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_record_links        FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.integration_record_history      FROM anon, PUBLIC;

GRANT SELECT ON TABLE public.integration_canonical_entities TO authenticated;
GRANT SELECT ON TABLE public.integration_canonical_fields   TO authenticated;
GRANT SELECT ON TABLE public.integration_connectors         TO authenticated;
GRANT UPDATE ON TABLE public.integration_connectors         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_mapping_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_field_mappings   TO authenticated;
GRANT SELECT ON TABLE public.integration_inbound_messages   TO authenticated;
GRANT SELECT ON TABLE public.integration_record_links       TO authenticated;
GRANT SELECT ON TABLE public.integration_record_history     TO authenticated;

GRANT ALL ON TABLE public.integration_canonical_entities  TO service_role;
GRANT ALL ON TABLE public.integration_canonical_fields    TO service_role;
GRANT ALL ON TABLE public.integration_connectors          TO service_role;
GRANT ALL ON TABLE public.integration_connector_secrets   TO service_role;
GRANT ALL ON TABLE public.integration_mapping_versions    TO service_role;
GRANT ALL ON TABLE public.integration_field_mappings      TO service_role;
GRANT ALL ON TABLE public.integration_inbound_messages    TO service_role;
GRANT ALL ON TABLE public.integration_record_links        TO service_role;
GRANT ALL ON TABLE public.integration_record_history      TO service_role;

REVOKE ALL ON public.integration_connector_health   FROM anon, PUBLIC;
REVOKE ALL ON public.integration_entity_sync_state  FROM anon, PUBLIC;
REVOKE ALL ON public.integration_dead_letter_queue  FROM anon, PUBLIC;
GRANT SELECT ON public.integration_connector_health   TO authenticated, service_role;
GRANT SELECT ON public.integration_entity_sync_state  TO authenticated, service_role;
GRANT SELECT ON public.integration_dead_letter_queue  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nx_integration_is_service_context()                    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_can_administer(uuid)                    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_backoff_interval(integer,integer,integer,uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_resolve_connector(text)                 FROM anon, PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.nx_integration_register_secret(uuid,text,text,text)    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_revoke_secret(uuid)                     FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_validate_canonical(text,jsonb)          FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_map_payload(uuid,text,jsonb)            FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_claim_message(uuid,text,text,jsonb,text) FROM anon, PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.nx_integration_complete_message(uuid,jsonb,uuid)       FROM anon, PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.nx_integration_fail_message(uuid,text,boolean,jsonb)   FROM anon, PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.nx_integration_process_message(uuid)                   FROM anon, PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.nx_integration_bind_record(uuid,text,uuid)             FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_replay_message(uuid)                    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_guard_mapping_target()                  FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_guard_message_org()                     FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_guard_link_org()                        FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_integration_history_append_only()                   FROM anon, PUBLIC;

--  The ingest path is service_role ONLY. An end-user session can never claim,
--  complete, fail or process a message — those are the connector's lifecycle,
--  not a user's.
GRANT EXECUTE ON FUNCTION public.nx_integration_resolve_connector(text)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_claim_message(uuid,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_complete_message(uuid,jsonb,uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_fail_message(uuid,text,boolean,jsonb)    TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_process_message(uuid)                    TO service_role;

--  Operator surfaces: authorised inside the function by
--  nx_integration_can_administer, so authenticated EXECUTE is safe.
GRANT EXECUTE ON FUNCTION public.nx_integration_is_service_context()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_can_administer(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_backoff_interval(integer,integer,integer,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_register_secret(uuid,text,text,text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_revoke_secret(uuid)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_validate_canonical(text,jsonb)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_map_payload(uuid,text,jsonb)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_bind_record(uuid,text,uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_integration_replay_message(uuid)                  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  §10. SELFTEST
--
--  Catalogue assertions, then a BEHAVIOURAL proof of idempotency, the dead
--  letter and cross-org containment, run inside a subtransaction that ALWAYS
--  aborts. Orphan risk is zero: either the subtransaction rolls back its
--  fixtures, or an uncaught error rolls back the entire migration.
-- ════════════════════════════════════════════════════════════════════════════
DO $selftest$
DECLARE
  v_tbl        text;
  v_n          int;
  v_bad        text;
  v_src        text;
  --  behavioural results, captured OUTSIDE the subtransaction. PL/pgSQL
  --  variables are memory, not MVCC state, so they survive its rollback.
  b_first_claim   boolean := false;
  b_replay_noop   boolean := false;
  b_single_row    boolean := false;
  b_payload_kept  boolean := false;
  b_dead_letter   boolean := false;
  b_cross_org     boolean := false;
  b_replay_refuse boolean := false;
  b_money_target  boolean := false;
  b_history_lock  boolean := false;
BEGIN
  -- ── 10a. every new table exists, has RLS, and has an admin branch ─────────
  FOREACH v_tbl IN ARRAY ARRAY[
    'integration_canonical_entities','integration_canonical_fields',
    'integration_connectors','integration_connector_secrets',
    'integration_mapping_versions','integration_field_mappings',
    'integration_inbound_messages','integration_record_links',
    'integration_record_history']
  LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'SELFTEST: table public.% was not created', v_tbl;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_tbl)::regclass) THEN
      RAISE EXCEPTION 'SELFTEST: RLS is not enabled on public.%', v_tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname='public' AND tablename=v_tbl AND qual ~ 'nx_is_admin') THEN
      RAISE EXCEPTION 'SELFTEST: public.% has no nx_is_admin branch — admin would be locked out', v_tbl;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_tbl, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'DELETE') THEN
      RAISE EXCEPTION 'SELFTEST: anon has reach on public.% — no GRANT to anon is permitted in this lane', v_tbl;
    END IF;
  END LOOP;

  --  Nobody but admin/service_role touches the credential table.
  IF has_table_privilege('authenticated', 'public.integration_connector_secrets', 'SELECT') THEN
    RAISE EXCEPTION
      'SELFTEST: authenticated can SELECT integration_connector_secrets — credential digests must be unreachable by any end user';
  END IF;

  -- ── 10b. search_path pinned on every function this lane adds ──────────────
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname LIKE 'nx\_integration\_%'
     AND NOT (array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '^search_path='
              AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpublic\M'
              AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpg_temp\M');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % function(s) do not pin search_path to public, pg_temp: %', v_n, v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'nx\_integration\_%'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'SELFTEST: anon can EXECUTE an integration function';
  END IF;

  -- ── 10c. MONEY FIREWALL, proof P3 ────────────────────────────────────────
  --  No nx_integration_% function performs DML against any table that is not
  --  itself an integration_ table. Comments and string literals are stripped
  --  first, and FOR UPDATE / DO UPDATE are normalised so they cannot be
  --  mistaken for an UPDATE statement.
  SELECT count(*), string_agg(DISTINCT s.proname || ' -> ' || s.tbl, ', ')
    INTO v_n, v_bad
    FROM (
      SELECT p.proname,
             (regexp_matches(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g'),
                    '''[^'']*''', ' ', 'g'),
                  '\m(for|do)\s+update\M', 'kept_update', 'gi'),
                '\m(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_][a-z0-9_]*)',
                'gi'))[1] AS tbl
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'nx\_integration\_%'
    ) s
   WHERE s.tbl NOT LIKE 'integration\_%';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: the integration core writes outside its own tables (%) — an ERP must never be able to reach a business or money surface', v_bad;
  END IF;

  --  Proof P1: the canonical vocabulary carries no money field, and the CHECK
  --  that keeps it that way is installed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.integration_canonical_fields'::regclass
                    AND conname  = 'integration_canonical_fields_money_free') THEN
    RAISE EXCEPTION 'SELFTEST: integration_canonical_fields_money_free is missing — a money field could be registered';
  END IF;
  SELECT count(*), string_agg(canonical_field, ', ') INTO v_n, v_bad
    FROM public.integration_canonical_fields
   WHERE canonical_field ~* '(amount|price|cost|currency|invoice|payment|payout|fee|cents|billing|charge|wallet|ledger|settle|budget|salary|wage|total)';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: the canonical shape contains money vocabulary (%)', v_bad;
  END IF;

  --  Proof P2: the bind allowlist exists and names no money table.
  SELECT pg_get_constraintdef(oid) INTO v_src FROM pg_constraint
   WHERE conrelid = 'public.integration_record_links'::regclass
     AND conname  = 'integration_record_links_table_allowlist';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: integration_record_links_table_allowlist is missing — a connector could be bound to any table';
  END IF;
  IF v_src ~* '\m(wallets|transactions|earnings|payouts|supplier_earnings|job_funding_stages|deal_money_legs|deal_payment_schedule|invoices)\M' THEN
    RAISE EXCEPTION 'SELFTEST: a money table is bindable from a connector: %', v_src;
  END IF;

  --  No trigger anywhere on an integration table reaches money DML.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_proc p  ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND c.relname LIKE 'integration\_%'
       AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings|job_funding_stages)\M'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a trigger on an integration table moves money';
  END IF;

  -- ── 10d. the idempotency key exists and is connector-scoped ───────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.integration_inbound_messages'::regclass
       AND conname  = 'integration_inbound_messages_idem_uq'
       AND contype  = 'u') THEN
    RAISE EXCEPTION 'SELFTEST: the (connector_id, external_id) idempotency key is missing — replays would duplicate';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_src FROM pg_constraint
   WHERE conrelid = 'public.integration_inbound_messages'::regclass
     AND conname  = 'integration_inbound_messages_idem_uq';
  IF v_src !~ 'connector_id' OR v_src !~ 'external_id' THEN
    RAISE EXCEPTION 'SELFTEST: the idempotency key is not (connector_id, external_id): %', v_src;
  END IF;

  --  Exactly one mapping version may be active per connector+entity.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public'
                    AND indexname='integration_mapping_versions_one_active_uq') THEN
    RAISE EXCEPTION 'SELFTEST: two mapping versions could be active at once — "which mapping was in force" would have no answer';
  END IF;

  --  No V2: this lane created no shadow copy of a business table.
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.projects') IS NULL
     OR to_regclass('public.reports') IS NULL
     OR to_regclass('public.supplier_profiles') IS NULL
     OR to_regclass('public.deal_nonconformances') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: a canonical business table is missing — this lane reuses them and creates none';
  END IF;
  IF to_regclass('public.stripe_webhook_events') IS NULL
     OR to_regprocedure('public.claim_stripe_webhook_event(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the Stripe idempotency ledger this lane models itself on has gone — the house pattern claim is no longer true';
  END IF;

  --  The views are security_invoker; without it they bypass every org policy.
  FOREACH v_tbl IN ARRAY ARRAY['integration_connector_health',
                               'integration_entity_sync_state',
                               'integration_dead_letter_queue']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class
                    WHERE oid = ('public.' || v_tbl)::regclass
                      AND array_to_string(COALESCE(reloptions, '{}'::text[]), ',') ~* 'security_invoker=(on|true)') THEN
      RAISE EXCEPTION 'SELFTEST: view public.% is not security_invoker — it would read straight through org RLS', v_tbl;
    END IF;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  --  10e. BEHAVIOURAL PROOF. Always rolled back.
  -- ══════════════════════════════════════════════════════════════════════════
  BEGIN
    DECLARE
      v_org_id  uuid := '00000000-0000-4000-8000-0000474000aa'::uuid;
      v_conn_id uuid := '00000000-0000-4000-8000-0000474000bb'::uuid;
      v_org2_id uuid := '00000000-0000-4000-8000-0000474000cc'::uuid;
      v_c       record;
      v_m1      uuid;
      v_m2      uuid;
      v_cnt     int;
      v_dig     text;
      v_link    uuid;
    BEGIN
      INSERT INTO public.organizations (id, name, slug)
      VALUES (v_org_id,  'NX selftest 474000 org A', 'nx-selftest-474000-a'),
             (v_org2_id, 'NX selftest 474000 org B', 'nx-selftest-474000-b');

      INSERT INTO public.integration_connectors
        (id, organization_id, slug, display_name, adapter_kind, max_attempts)
      VALUES (v_conn_id, v_org_id, 'selftest-mock', 'Selftest mock connector', 'mock', 2);

      -- (1) first delivery claims
      SELECT * INTO v_c FROM public.nx_integration_claim_message(
        v_conn_id, 'ERP-SELFTEST-1', 'supplier',
        '{"VENDOR_ID":"V-1","VENDOR_NAME":"Acme"}'::jsonb, 'V-1');
      b_first_claim := v_c.claimed AND v_c.reason = 'newly_claimed';
      v_m1 := v_c.message_id;

      PERFORM public.nx_integration_complete_message(v_m1, '{"external_ref":"V-1"}'::jsonb, NULL);

      SELECT payload_digest INTO v_dig
        FROM public.integration_inbound_messages WHERE id = v_m1;

      -- (2) THE REPLAY. Same external id, and a DIFFERENT body, which is the
      --     nastier real-world case. It must change nothing.
      SELECT * INTO v_c FROM public.nx_integration_claim_message(
        v_conn_id, 'ERP-SELFTEST-1', 'supplier',
        '{"VENDOR_ID":"V-1","VENDOR_NAME":"Acme CHANGED"}'::jsonb, 'V-1');
      b_replay_noop := (NOT v_c.claimed) AND v_c.reason = 'already_completed'
                       AND v_c.message_id = v_m1;

      SELECT count(*) INTO v_cnt FROM public.integration_inbound_messages
       WHERE connector_id = v_conn_id AND external_id = 'ERP-SELFTEST-1';
      b_single_row := (v_cnt = 1);

      --  the stored payload was NOT rewritten by the replay, and the
      --  divergence was counted rather than silently applied
      SELECT count(*) INTO v_cnt FROM public.integration_inbound_messages
       WHERE id = v_m1 AND payload_digest = v_dig
         AND payload ->> 'VENDOR_NAME' = 'Acme'
         AND payload_conflict_count = 1;
      b_payload_kept := (v_cnt = 1);

      -- (3) replaying a COMPLETED message is refused
      BEGIN
        PERFORM public.nx_integration_replay_message(v_m1);
        b_replay_refuse := false;
      EXCEPTION WHEN OTHERS THEN
        b_replay_refuse := (SQLERRM ~ 'ALREADY_COMPLETED');
      END;

      -- (4) dead letter after max_attempts, with the error preserved
      SELECT * INTO v_c FROM public.nx_integration_claim_message(
        v_conn_id, 'ERP-SELFTEST-2', 'supplier', '{"VENDOR_ID":"V-2"}'::jsonb, 'V-2');
      v_m2 := v_c.message_id;
      PERFORM public.nx_integration_fail_message(v_m2, 'upstream timeout', false, NULL);
      --  attempts is now 1 and max_attempts is 2, so this second failure is
      --  the one that exhausts the budget.
      UPDATE public.integration_inbound_messages
         SET status = 'processing', attempts = 2 WHERE id = v_m2;
      PERFORM public.nx_integration_fail_message(v_m2, 'upstream timeout again', false, NULL);
      SELECT count(*) INTO v_cnt FROM public.integration_inbound_messages
       WHERE id = v_m2 AND status = 'dead_letter'
         AND dead_lettered_at IS NOT NULL
         AND last_error = 'upstream timeout again'
         AND payload IS NOT NULL;
      b_dead_letter := (v_cnt = 1);

      -- (5) CROSS-ORG CONTAINMENT: a message may not be filed against another
      --     organization even by a service context.
      BEGIN
        INSERT INTO public.integration_inbound_messages
          (connector_id, organization_id, external_id, entity_type, payload, payload_digest)
        VALUES (v_conn_id, v_org2_id, 'ERP-SELFTEST-3', 'supplier', '{}'::jsonb,
                repeat('0', 64));
        b_cross_org := false;
      EXCEPTION WHEN OTHERS THEN
        b_cross_org := (SQLERRM ~ 'CONNECTOR_ORG_MISMATCH');
      END;

      -- (6) a money table can never be a bind target
      INSERT INTO public.integration_record_links
        (connector_id, organization_id, entity_type, external_ref)
      VALUES (v_conn_id, v_org_id, 'supplier', 'V-9')
      RETURNING id INTO v_link;
      BEGIN
        PERFORM public.nx_integration_bind_record(v_link, 'wallets', v_org_id);
        b_money_target := false;
      EXCEPTION WHEN OTHERS THEN
        b_money_target := (SQLERRM ~ 'TARGET_NOT_ALLOWED');
      END;

      -- (7) history is append-only even for this superuser-owned context
      INSERT INTO public.integration_record_history
        (link_id, organization_id, change_kind, actor_kind)
      VALUES (v_link, v_org_id, 'create', 'system');
      BEGIN
        UPDATE public.integration_record_history SET note = 'tampered' WHERE link_id = v_link;
        b_history_lock := false;
      EXCEPTION WHEN OTHERS THEN
        b_history_lock := (SQLERRM ~ 'APPEND_ONLY');
      END;

      --  Always abort. Fixtures never reach the committed state.
      RAISE EXCEPTION 'NX_SELFTEST_ROLLBACK';
    END;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'NX_SELFTEST_ROLLBACK' THEN
      RAISE EXCEPTION 'SELFTEST: the behavioural block aborted unexpectedly: %', SQLERRM;
    END IF;
  END;

  IF NOT b_first_claim THEN
    RAISE EXCEPTION 'SELFTEST: a first delivery did not claim — the ledger never accepts anything';
  END IF;
  IF NOT b_replay_noop THEN
    RAISE EXCEPTION
      'SELFTEST: IDEMPOTENCY BROKEN — replaying a completed external id did not return already_completed';
  END IF;
  IF NOT b_single_row THEN
    RAISE EXCEPTION
      'SELFTEST: IDEMPOTENCY BROKEN — a replay created a second row for the same (connector, external_id)';
  END IF;
  IF NOT b_payload_kept THEN
    RAISE EXCEPTION
      'SELFTEST: a replay carrying a different body overwrote the stored payload, or the divergence was not counted';
  END IF;
  IF NOT b_replay_refuse THEN
    RAISE EXCEPTION
      'SELFTEST: an operator can replay a COMPLETED message — that reprocesses a processed external id and defeats the whole lane';
  END IF;
  IF NOT b_dead_letter THEN
    RAISE EXCEPTION
      'SELFTEST: exhausting max_attempts did not dead-letter the message with its error and payload intact — a failure would be silently swallowed';
  END IF;
  IF NOT b_cross_org THEN
    RAISE EXCEPTION
      'SELFTEST: P0 — a message could be filed against an organization its connector does not belong to';
  END IF;
  IF NOT b_money_target THEN
    RAISE EXCEPTION
      'SELFTEST: a connector could be bound to a money table — an ERP could reach a wallet';
  END IF;
  IF NOT b_history_lock THEN
    RAISE EXCEPTION
      'SELFTEST: integration_record_history is not append-only — the audit trail is rewritable';
  END IF;

  RAISE NOTICE 'integration core: canonical contracts registered; idempotency, dead letter, cross-org containment and money-blindness all asserted; no business table written.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
