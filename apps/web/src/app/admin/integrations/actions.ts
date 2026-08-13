'use server';

// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrations/actions.ts — the only write path for the ERP console
//
//  ── RPC FIRST, ALWAYS ──────────────────────────────────────────────────────
//  Every mutation that HAS an nx_integration_* RPC goes through it, because the
//  RPC carries the authority check and the contract:
//    • nx_integration_replay_message      — org-admin authority; REFUSES to
//      replay a completed message, so an operator cannot reprocess a processed
//      external id and quietly double-apply it
//    • nx_integration_bind_record         — org-admin authority; refuses any
//      target outside the six operational tables (proof P2), refuses cross-org
//    • nx_integration_register_secret     — refuses anything that is not a
//      sha256 hex digest, so plaintext cannot reach Postgres through this path
//    • nx_integration_revoke_secret       — org-admin authority, idempotent
//
//  ── WHERE THERE IS NO RPC, AND WHY A DIRECT WRITE IS STILL CORRECT ─────────
//  20260801474000 ships no RPC for connector pause/resume or for the mapping
//  version lifecycle. It does ship the GRANTs for them:
//    integration_connectors          → SELECT, UPDATE to authenticated
//    integration_mapping_versions    → SELECT, INSERT, UPDATE, DELETE
//    integration_field_mappings      → SELECT, INSERT, UPDATE, DELETE
//  and RLS gates each one on nx_is_admin() or nx_user_is_org_admin(). Those
//  writes therefore go direct, each one narrowed to the exact columns it needs.
//  They are marked NO-RPC below so a future migration knows what to absorb.
//
//  Deliberately ABSENT, and none of these is an oversight:
//   • CREATE CONNECTOR — `authenticated` has no INSERT grant on
//     integration_connectors. A create form would be a dead button.
//   • ANY EXPORT / PUSH — this lane has no outbound ledger at all. There is
//     nothing to export to and no table to record an export in, so no ERP sync
//     driven from here can mark anything paid or settled. Manual Admin
//     settlement remains the only settlement path, untouched.
//   • DISCARD / DELETE A MESSAGE — "there is no code path that discards a
//     message" is an invariant of the ledger: no DELETE grant on
//     integration_inbound_messages, and no discard RPC. Requeue is the only
//     recovery, and it moves the SAME row so the idempotency key survives.
//   • ANY READ OR WRITE OF integration_connector_secrets — REVOKEd from
//     `authenticated` entirely. Secrets are touched only through the two RPCs.
//   • CLAIM / COMPLETE / FAIL / PROCESS — service_role only by GRANT. Those are
//     the connector's lifecycle, not an operator's, and an action here would
//     fail every time.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ROUTE = '/admin/integrations';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function fail(e: unknown, fallback: string): ActionResult {
  const msg =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : fallback;
  return { ok: false, error: msg };
}

// ── Failure handling: requeue ───────────────────────────────────────────────

/**
 * Requeue a dead-lettered, rejected or retryable message.
 *
 * Resets the SAME row to `received` with attempts=0 — it does not create a
 * second message — so the (connector_id, external_id) idempotency key is
 * preserved and a requeue can never fork one message into two. The RPC refuses
 * a `completed` message outright, which is why this console shows a completed
 * message's replay verdict as "refused" rather than offering a button the
 * server would reject.
 */
export async function requeueMessage(messageId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_integration_replay_message', {
    p_message_id: messageId,
  });
  if (error) return fail(error, 'Could not requeue the message.');
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── The adapter seam: bind an external reference to an internal record ──────

/**
 * The six targets are the complete allowlist in
 * integration_record_links_table_allowlist (proof P2). No wallet, transaction,
 * payout, funding stage or price-bearing table is reachable, and the RPC
 * refuses anything outside this set before the CHECK even fires.
 */
export type BindableTable =
  | 'jobs'
  | 'projects'
  | 'reports'
  | 'supplier_profiles'
  | 'deal_nonconformances'
  | 'inspection_events';

export async function bindRecord(
  linkId: string,
  internalTable: BindableTable,
  internalId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_integration_bind_record', {
    p_link_id: linkId,
    p_internal_table: internalTable,
    p_internal_id: internalId,
  });
  if (error) return fail(error, 'Could not bind the record.');
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Credentials: digests only, never plaintext ──────────────────────────────

export interface RegisterSecretResult extends ActionResult {
  secretId?: string;
  tokenPrefix?: string;
}

/**
 * Register an ALREADY-HASHED connector credential.
 *
 * `digest` must be a lowercase sha256 hex digest. This function refuses
 * anything else BEFORE the round trip, and nx_integration_register_secret
 * refuses it again server-side against
 * integration_connector_secrets_digest_shape. A plaintext bearer token cannot
 * satisfy ^[0-9a-f]{64}$, so it cannot be stored even by mistake — which is
 * the difference between "we do not store plaintext" and "plaintext is
 * unstorable".
 *
 * Returns the new secret's id and its non-secret prefix. The prefix is derived
 * from the DIGEST, not from the token, so it identifies a credential without
 * leaking any part of one.
 */
export async function registerConnectorSecret(
  connectorId: string,
  digest: string,
  label: string | null,
  secretKind: 'inbound_token' | 'signing_key',
): Promise<RegisterSecretResult> {
  const normalized = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return {
      ok: false,
      error:
        'Expected a lowercase sha256 hex digest (64 characters). Never paste a plaintext token — hash it locally and submit the digest.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_integration_register_secret', {
    p_connector_id: connectorId,
    p_token_hash: normalized,
    p_label: label,
    p_secret_kind: secretKind,
  });
  if (error) return fail(error, 'Could not register the credential.');

  const payload = (data ?? {}) as { secret_id?: string; token_prefix?: string };
  return {
    ok: true,
    secretId: payload.secret_id,
    tokenPrefix: payload.token_prefix,
  };
}

/**
 * Revoke a credential. Takes effect on the very next inbound request, because
 * nx_integration_resolve_connector filters on revoked_at. Idempotent.
 */
export async function revokeConnectorSecret(
  secretId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_integration_revoke_secret', {
    p_secret_id: secretId,
  });
  if (error) return fail(error, 'Could not revoke the credential.');
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Connector state.  NO-RPC: direct UPDATE under GRANT UPDATE + RLS ────────

/**
 * Pause or resume a connector.
 *
 * Pausing is a total stop, not a UI nicety: nx_integration_claim_message
 * refuses any connector whose status is not 'active', so a paused connector
 * accepts nothing at all.
 *
 * 'revoked' is deliberately NOT offered here. The
 * integration_connectors_revoked_coherent CHECK couples status='revoked' to
 * revoked_at, making revocation a materially different and near-terminal act
 * from pausing; it belongs behind its own RPC rather than a status dropdown.
 */
export async function setConnectorStatus(
  connectorId: string,
  status: 'active' | 'paused',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('integration_connectors')
    .update({ status })
    .eq('id', connectorId)
    // Never touch a revoked connector: reviving one by writing 'active' would
    // leave revoked_at set and violate integration_connectors_revoked_coherent.
    .in('status', ['active', 'paused']);
  if (error) return fail(error, 'Could not change the connector status.');
  revalidatePath(ROUTE);
  return { ok: true };
}

/**
 * Retry policy. Ranges mirror the CHECKs exactly
 * (attempts 1–50, base 1–86400, max 1–604800, max >= base) so the form cannot
 * submit something the database will refuse.
 */
export async function setConnectorRetryPolicy(
  connectorId: string,
  maxAttempts: number,
  retryBaseSeconds: number,
  retryMaxSeconds: number,
): Promise<ActionResult> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50) {
    return { ok: false, error: 'Max attempts must be a whole number from 1 to 50.' };
  }
  if (
    !Number.isInteger(retryBaseSeconds) ||
    retryBaseSeconds < 1 ||
    retryBaseSeconds > 86400
  ) {
    return { ok: false, error: 'Base backoff must be 1–86400 seconds.' };
  }
  if (
    !Number.isInteger(retryMaxSeconds) ||
    retryMaxSeconds < 1 ||
    retryMaxSeconds > 604800
  ) {
    return { ok: false, error: 'Max backoff must be 1–604800 seconds.' };
  }
  if (retryMaxSeconds < retryBaseSeconds) {
    return { ok: false, error: 'Max backoff cannot be below base backoff.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('integration_connectors')
    .update({
      max_attempts: maxAttempts,
      retry_base_seconds: retryBaseSeconds,
      retry_max_seconds: retryMaxSeconds,
    })
    .eq('id', connectorId);
  if (error) return fail(error, 'Could not update the retry policy.');
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Mapping versions.  NO-RPC: direct writes under GRANT + RLS ──────────────

/**
 * Open a new DRAFT mapping version for (connector, entity).
 *
 * Drafts are inert: nx_integration_map_payload only ever reads the ACTIVE
 * version, so editing a draft cannot disturb traffic in flight. The version
 * number is max+1 for the pair, which the
 * integration_mapping_versions_uq UNIQUE then confirms.
 */
export async function createMappingDraft(
  connectorId: string,
  entityType: string,
  notes: string | null,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: readErr } = await supabase
    .from('integration_mapping_versions')
    .select('version')
    .eq('connector_id', connectorId)
    .eq('entity_type', entityType)
    .order('version', { ascending: false })
    .limit(1);
  if (readErr) return fail(readErr, 'Could not read existing mapping versions.');

  const head = (existing ?? [])[0] as { version: number } | undefined;
  const nextVersion = (head?.version ?? 0) + 1;

  const { error } = await supabase.from('integration_mapping_versions').insert({
    connector_id: connectorId,
    entity_type: entityType,
    version: nextVersion,
    status: 'draft',
    notes,
  });
  if (error) return fail(error, 'Could not create the mapping draft.');
  revalidatePath(ROUTE);
  return { ok: true };
}

/**
 * Add one external -> canonical field mapping to a draft.
 *
 * The database refuses a canonical field the entity does not have
 * (nx_integration_guard_mapping_target), refuses two external fields
 * collapsing onto one canonical field (which would be silent last-writer-wins
 * data loss), and cannot accept a money field at all because none can be
 * registered in the first place (proof P1).
 */
export async function addFieldMapping(
  versionId: string,
  externalField: string,
  canonicalField: string,
  transform: 'none' | 'trim' | 'upper' | 'lower',
  defaultValue: string | null,
): Promise<ActionResult> {
  const external = externalField.trim();
  if (external.length === 0) {
    return { ok: false, error: 'External field cannot be blank.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('integration_field_mappings').insert({
    version_id: versionId,
    external_field: external,
    canonical_field: canonicalField,
    transform,
    default_value: defaultValue && defaultValue.length > 0 ? defaultValue : null,
  });
  if (error) return fail(error, 'Could not add the field mapping.');
  revalidatePath(ROUTE);
  return { ok: true };
}

export async function removeFieldMapping(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('integration_field_mappings')
    .delete()
    .eq('id', id);
  if (error) return fail(error, 'Could not remove the field mapping.');
  revalidatePath(ROUTE);
  return { ok: true };
}

/**
 * Make a draft the LIVE mapping for its (connector, entity).
 *
 * integration_mapping_versions_one_active_uq permits exactly one active version
 * per pair, so the incumbent must be retired FIRST — activating first would
 * collide with the partial unique index. The window between the two statements
 * is a state with no active mapping, and that window is safe by design: a
 * message arriving in it fails with 'no_active_mapping', which
 * nx_integration_process_message treats as RETRYABLE, keeps the full payload,
 * and leaves replayable. Nothing is lost; the operator finishes the switch and
 * requeues.
 */
export async function activateMappingVersion(
  versionId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();

  const { data: target, error: readErr } = await supabase
    .from('integration_mapping_versions')
    .select('id, connector_id, entity_type, status')
    .eq('id', versionId)
    .limit(1);
  if (readErr) return fail(readErr, 'Could not read the mapping version.');

  const version = (target ?? [])[0] as
    | { id: string; connector_id: string; entity_type: string; status: string }
    | undefined;
  if (!version) return { ok: false, error: 'That mapping version no longer exists.' };
  if (version.status === 'active') return { ok: true };
  if (version.status === 'retired') {
    return {
      ok: false,
      error:
        'A retired version cannot be re-activated. Open a new draft — history stays readable, and the version that mapped each past message is stamped on that message forever.',
    };
  }

  const now = new Date().toISOString();

  const { error: retireErr } = await supabase
    .from('integration_mapping_versions')
    .update({ status: 'retired', retired_at: now })
    .eq('connector_id', version.connector_id)
    .eq('entity_type', version.entity_type)
    .eq('status', 'active');
  if (retireErr) {
    return fail(retireErr, 'Could not retire the current live mapping version.');
  }

  const { error: activateErr } = await supabase
    .from('integration_mapping_versions')
    .update({ status: 'active', activated_at: now })
    .eq('id', versionId)
    .eq('status', 'draft');
  if (activateErr) {
    return {
      ok: false,
      error: `The previous version was retired but the new one could not be activated: ${activateErr.message}. No mapping is live for this entity right now — messages arriving will fail as 'no_active_mapping', which is RETRYABLE and keeps their payload. Activate a version, then requeue them.`,
    };
  }

  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Read-only diagnostics ───────────────────────────────────────────────────

export interface MappingPreviewResult {
  ok: boolean;
  error?: string;
  /** The canonical record. Money-free by construction — proof P1. */
  canonical?: Record<string, unknown>;
  mappingVersionId?: string | null;
  validationOk?: boolean;
  validationErrors?: string[];
}

/**
 * Dry-run a payload through the connector's ACTIVE mapping and the canonical
 * validator. Writes NOTHING — no ledger row, no link, no history.
 *
 * Two properties worth stating:
 *  • The raw input is never echoed back. Only the CANONICAL result is returned,
 *    and a canonical record cannot contain money because no money field can be
 *    registered (integration_canonical_fields_money_free). So a preview cannot
 *    become a way to render a price through a side door.
 *  • Authority is checked first. nx_integration_map_payload is SECURITY DEFINER
 *    with no caller check of its own, so gating on
 *    nx_integration_can_administer here stops this console being used to probe
 *    the mapping shape of a connector the operator may not administer.
 */
export async function previewMapping(
  connectorId: string,
  entityType: string,
  rawPayload: string,
): Promise<MappingPreviewResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'An inbound payload must be a JSON object.' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: mayAdminister, error: authErr } = await supabase.rpc(
    'nx_integration_can_administer',
    { p_connector_id: connectorId },
  );
  if (authErr) return { ok: false, error: authErr.message };
  if (mayAdminister !== true) {
    return {
      ok: false,
      error: 'You do not have authority over this connector.',
    };
  }

  const { data: mapped, error: mapErr } = await supabase.rpc(
    'nx_integration_map_payload',
    {
      p_connector_id: connectorId,
      p_entity_type: entityType,
      p_payload: parsed,
    },
  );
  if (mapErr) return { ok: false, error: mapErr.message };

  const mapResult = (mapped ?? {}) as {
    ok?: boolean;
    reason?: string;
    errors?: string[];
    canonical?: Record<string, unknown>;
    mapping_version_id?: string | null;
  };

  if (mapResult.ok !== true) {
    return {
      ok: false,
      error:
        mapResult.reason === 'no_active_mapping'
          ? 'No active mapping version for this entity on this connector. Activate one, then preview again.'
          : (mapResult.errors ?? []).join('; ') || 'Mapping failed.',
    };
  }

  const canonical = mapResult.canonical ?? {};

  const { data: validated, error: valErr } = await supabase.rpc(
    'nx_integration_validate_canonical',
    { p_entity_type: entityType, p_canonical: canonical },
  );
  if (valErr) return { ok: false, error: valErr.message };

  const valResult = (validated ?? {}) as { ok?: boolean; errors?: string[] };

  return {
    ok: true,
    canonical,
    mappingVersionId: mapResult.mapping_version_id ?? null,
    validationOk: valResult.ok === true,
    validationErrors: valResult.errors ?? [],
  };
}
