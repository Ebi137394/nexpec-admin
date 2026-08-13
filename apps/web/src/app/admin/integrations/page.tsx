// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrations/page.tsx — ERP Integration operations console
//
//  20260801474000 shipped the ERP Integration Core as DATABASE ONLY. Every
//  integration_* table, every nx_integration_* function and all three
//  observability views had ZERO callers anywhere in the repository and no route
//  reached any of them. A migration is not a completed phase until an operator
//  can work it, so this is that surface.
//
//  ── WHAT THIS CONSOLE HONESTLY IS ──────────────────────────────────────────
//  FIXTURE MODE. There is no live SAP or Oracle tenant, no credential for one,
//  and none is coming. The database says so itself:
//  integration_connectors_adapter_check admits exactly ARRAY['mock'], so
//  adapter_kind='sap' or 'oracle' is REFUSED by Postgres. This console
//  therefore never renders "Connected", never renders a sync success it did not
//  read from the ledger, and never offers a control the server would reject.
//  SAP and Oracle appear as ADAPTER CONTRACTS — mappings and fixtures proven by
//  a runnable test — and are labelled as exactly that.
//
//  ── WHAT THIS CONSOLE CANNOT DO, BY SCHEMA, AND WHY THAT IS CORRECT ────────
//   • MOVE MONEY. Three proofs, all in the migration and none of them ours to
//     weaken: P1 integration_canonical_fields_money_free makes a money field
//     unregisterable, so an ERP payload has no canonical slot for a price;
//     P2 integration_record_links_table_allowlist restricts bindable targets to
//     six operational tables, none of them a wallet, payout or funding row;
//     P3 no nx_integration_% function performs DML outside integration_*.
//     There is additionally NO OUTBOUND LEDGER in this lane at all — the core
//     is the inbound spine — so this console offers no export control of any
//     kind, and could not mark anything paid or settled if it tried. Manual
//     Admin settlement is untouched.
//   • READ A CREDENTIAL. integration_connector_secrets is REVOKEd from
//     `authenticated` outright, so this page does not query it — a list would
//     be a guaranteed runtime permission error dressed up as a feature. Secrets
//     are registered and revoked through RPCs that take and return metadata
//     only. See the Credentials panel, which says this plainly.
//   • CREATE A CONNECTOR. `authenticated` holds SELECT and UPDATE on
//     integration_connectors and no INSERT. So there is no create control —
//     a create form here would be a dead button.
//   • DISCARD A DEAD-LETTERED MESSAGE. "There is no code path that discards a
//     message" is an invariant of the ledger: no DELETE grant, no discard RPC.
//     Requeue is the only recovery and the queue view says so.
//
//  ── HOUSE RULES OBSERVED ───────────────────────────────────────────────────
//  Explicit column lists everywhere, never select('*'). ERROR state is distinct
//  from EMPTY state, and PERMISSION denial is distinct from both — an operator
//  who may not administer any organisation must not be shown "no connectors",
//  which reads as "nothing to do".
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { IntegrationsConsole } from './IntegrationsConsole';

export const metadata: Metadata = { title: 'ERP Integrations · NEXPEC Admin' };
export const dynamic = 'force-dynamic';

// ── Row shapes, one per relation actually read ──────────────────────────────

export interface ConnectorRow {
  id: string;
  organization_id: string;
  slug: string;
  display_name: string;
  adapter_kind: string;
  status: string;
  max_attempts: number;
  retry_base_seconds: number;
  retry_max_seconds: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface ConnectorHealthRow {
  connector_id: string;
  organization_id: string;
  slug: string;
  display_name: string;
  adapter_kind: string;
  connector_status: string;
  total_messages: number;
  completed_count: number;
  in_flight_count: number;
  retrying_count: number;
  dead_letter_count: number;
  rejected_count: number;
  payload_conflict_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_message_at: string | null;
}

export interface EntitySyncRow {
  connector_id: string;
  organization_id: string;
  entity_type: string;
  total_messages: number;
  completed_count: number;
  dead_letter_count: number;
  rejected_count: number;
  last_success_at: string | null;
  last_message_at: string | null;
}

/**
 * Deliberately WITHOUT `payload`. The recent-messages list does not need the
 * raw tenant body, and not selecting it is cheaper than redacting it. The
 * dead-letter queue does need it (that is where an operator diagnoses a
 * failure) and it is redacted before render there.
 */
export interface MessageRow {
  id: string;
  connector_id: string;
  organization_id: string;
  external_id: string;
  entity_type: string;
  external_ref: string | null;
  payload_digest: string;
  mapping_version_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  payload_conflict_count: number;
  last_conflict_at: string | null;
  replay_count: number;
  last_replayed_at: string | null;
  received_at: string;
  processed_at: string | null;
  dead_lettered_at: string | null;
}

export interface DeadLetterRow {
  message_id: string;
  connector_id: string;
  organization_id: string;
  connector_slug: string;
  entity_type: string;
  external_id: string;
  external_ref: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  validation_errors: unknown;
  payload: Record<string, unknown> | null;
  payload_conflict_count: number;
  replay_count: number;
  last_replayed_at: string | null;
  received_at: string;
  dead_lettered_at: string | null;
}

export interface MappingVersionRow {
  id: string;
  connector_id: string;
  entity_type: string;
  version: number;
  status: string;
  notes: string | null;
  created_at: string;
  activated_at: string | null;
  retired_at: string | null;
}

export interface FieldMappingRow {
  id: string;
  version_id: string;
  external_field: string;
  canonical_field: string;
  transform: string;
  default_value: string | null;
}

export interface CanonicalEntityRow {
  entity_type: string;
  label: string;
  description: string | null;
}

export interface CanonicalFieldRow {
  entity_type: string;
  canonical_field: string;
  data_type: string;
  is_required: boolean;
  description: string | null;
}

export interface RecordLinkRow {
  id: string;
  connector_id: string;
  organization_id: string;
  entity_type: string;
  external_ref: string;
  internal_table: string | null;
  internal_id: string | null;
  last_synced_at: string;
  bound_at: string | null;
}

export interface OrgRow {
  id: string;
  name: string;
  kind: string;
}

// ── Error classification ────────────────────────────────────────────────────

interface PgError {
  message: string;
  code?: string;
}

/**
 * A permission denial is NOT a read failure and NOT an empty queue. RLS that
 * filters rows returns zero rows with no error; a missing GRANT returns 42501.
 * The three states are shown differently because they mean different things to
 * whoever is on shift.
 */
function isPermissionError(e: PgError | null): boolean {
  if (!e) return false;
  return (
    e.code === '42501' ||
    e.code === 'PGRST301' ||
    /permission denied|insufficient privilege|not authorized/i.test(e.message)
  );
}

export default async function AdminIntegrationsPage() {
  const supabase = await createSupabaseServerClient();

  const [
    connectors,
    health,
    entitySync,
    messages,
    deadLetters,
    versions,
    fieldMappings,
    canonicalEntities,
    canonicalFields,
    links,
  ] = await Promise.all([
    supabase
      .from('integration_connectors')
      .select(
        'id, organization_id, slug, display_name, adapter_kind, status, max_attempts, retry_base_seconds, retry_max_seconds, notes, created_at, updated_at, revoked_at',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('integration_connector_health')
      .select(
        'connector_id, organization_id, slug, display_name, adapter_kind, connector_status, total_messages, completed_count, in_flight_count, retrying_count, dead_letter_count, rejected_count, payload_conflict_count, last_success_at, last_failure_at, last_message_at',
      )
      .limit(200),
    supabase
      .from('integration_entity_sync_state')
      .select(
        'connector_id, organization_id, entity_type, total_messages, completed_count, dead_letter_count, rejected_count, last_success_at, last_message_at',
      )
      .limit(500),
    supabase
      .from('integration_inbound_messages')
      .select(
        'id, connector_id, organization_id, external_id, entity_type, external_ref, payload_digest, mapping_version_id, status, attempts, next_attempt_at, last_error, payload_conflict_count, last_conflict_at, replay_count, last_replayed_at, received_at, processed_at, dead_lettered_at',
      )
      .order('received_at', { ascending: false })
      .limit(200),
    supabase
      .from('integration_dead_letter_queue')
      .select(
        'message_id, connector_id, organization_id, connector_slug, entity_type, external_id, external_ref, status, attempts, last_error, validation_errors, payload, payload_conflict_count, replay_count, last_replayed_at, received_at, dead_lettered_at',
      )
      .order('received_at', { ascending: false })
      .limit(100),
    supabase
      .from('integration_mapping_versions')
      .select(
        'id, connector_id, entity_type, version, status, notes, created_at, activated_at, retired_at',
      )
      .order('version', { ascending: false })
      .limit(500),
    supabase
      .from('integration_field_mappings')
      .select(
        'id, version_id, external_field, canonical_field, transform, default_value',
      )
      .limit(2000),
    supabase
      .from('integration_canonical_entities')
      .select('entity_type, label, description')
      .order('entity_type'),
    supabase
      .from('integration_canonical_fields')
      .select('entity_type, canonical_field, data_type, is_required, description')
      .order('entity_type')
      .limit(1000),
    supabase
      .from('integration_record_links')
      .select(
        'id, connector_id, organization_id, entity_type, external_ref, internal_table, internal_id, last_synced_at, bound_at',
      )
      .order('last_synced_at', { ascending: false })
      .limit(300),
  ]);

  const reads = [
    connectors,
    health,
    entitySync,
    messages,
    deadLetters,
    versions,
    fieldMappings,
    canonicalEntities,
    canonicalFields,
    links,
  ];
  const firstError = reads.map((r) => r.error as PgError | null).find(Boolean) ?? null;

  // PERMISSION state — distinct from both error and empty.
  if (isPermissionError(firstError)) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">ERP Integrations</h1>
        <div
          role="alert"
          aria-label="Permission denied"
          className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-200"
        >
          You do not have authority over any organisation&rsquo;s integration
          connectors. This is a permission boundary, not an empty queue —
          connectors exist but are not yours to see.
          <span className="mt-2 block text-xs opacity-70">
            Connector reads require organisation membership; replay, bind and
            credential actions require an org_members role of owner or
            procurement_admin, or platform admin.
          </span>
        </div>
      </main>
    );
  }

  // ERROR state — a read failed. Never an empty console, which would read as
  // "no integrations configured" and send an operator looking in the wrong place.
  if (firstError) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">ERP Integrations</h1>
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200"
        >
          Could not load the integration console. This is a read failure, not an
          empty ledger — no message state has been changed and nothing has been
          replayed.
          <span className="mt-2 block text-xs opacity-70">
            {firstError.message}
          </span>
        </div>
      </main>
    );
  }

  const connectorRows = (connectors.data ?? []) as unknown as ConnectorRow[];

  // Organisation names + kind, looked up ONLY for the connectors RLS already
  // let through. Cross-org isolation is the database's job; this read must not
  // become a second, wider door onto the org table.
  const orgIds = [...new Set(connectorRows.map((c) => c.organization_id))];
  let orgRows: OrgRow[] = [];
  if (orgIds.length > 0) {
    const orgs = await supabase
      .from('organizations')
      .select('id, name, kind')
      .in('id', orgIds);
    // A failed org lookup degrades to showing the id — it must not take the
    // whole console down, because the connector data is already in hand.
    orgRows = (orgs.data ?? []) as unknown as OrgRow[];
  }

  return (
    <IntegrationsConsole
      connectors={connectorRows}
      health={(health.data ?? []) as unknown as ConnectorHealthRow[]}
      entitySync={(entitySync.data ?? []) as unknown as EntitySyncRow[]}
      messages={(messages.data ?? []) as unknown as MessageRow[]}
      deadLetters={(deadLetters.data ?? []) as unknown as DeadLetterRow[]}
      versions={(versions.data ?? []) as unknown as MappingVersionRow[]}
      fieldMappings={(fieldMappings.data ?? []) as unknown as FieldMappingRow[]}
      canonicalEntities={
        (canonicalEntities.data ?? []) as unknown as CanonicalEntityRow[]
      }
      canonicalFields={
        (canonicalFields.data ?? []) as unknown as CanonicalFieldRow[]
      }
      links={(links.data ?? []) as unknown as RecordLinkRow[]}
      organizations={orgRows}
    />
  );
}
