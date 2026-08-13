// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrations/contract.ts — the pure, testable half of the console
//
//  Everything here mirrors a rule that migration 20260801474000 already
//  enforces in the database. Nothing here IS the enforcement — the database is
//  — but the console must not render something the server would refuse, and
//  must not render something the server deliberately keeps out of reach.
//
//  The three rules that matter most:
//
//   1. PAYLOAD PREVIEW IS ALLOWLISTED, NOT DENYLISTED.
//      A raw inbound payload is the SENDER's vocabulary, not ours. SAP's net
//      value is NETWR and Oracle's is Amount; neither matches the money
//      vocabulary that integration_canonical_fields_money_free screens, because
//      that CHECK screens OUR canonical field names, which we control. So the
//      preview renders only keys the connector's ACTIVE mapping actually maps
//      to a canonical field. Canonical fields are money-free by construction
//      (proof P1), therefore an allowlisted preview is money-blind by the same
//      proof that protects the ledger — not by a denylist someone must remember
//      to extend every time an ERP invents a new word for "price".
//
//   2. COMMERCIAL PRIVACY IS DIRECTIONAL.
//      A payload on a BUYER organisation's connector must never render
//      inspector_payout_cents or the platform spread; a SUPPLIER organisation's
//      must never render client_price_cents. organizations.kind ('enterprise' |
//      'agency') is the real, schema-grounded direction — not a guess.
//
//   3. NO PLAINTEXT CREDENTIAL, EVER — not rendered, not accepted, not typed
//      into a form. nx_integration_register_secret takes a sha256 hex digest
//      and refuses anything else; isSecretDigest() is the same refusal, moved
//      one hop earlier so the operator gets told before the round trip.
// ════════════════════════════════════════════════════════════════════════════

import fixturesJson from './adapter-fixtures.json';

// ── Shapes of the fixture file ──────────────────────────────────────────────

export type Transform = 'none' | 'trim' | 'upper' | 'lower';
export type OrgKind = 'enterprise' | 'agency';

export interface FixtureFieldMapping {
  external_field: string;
  canonical_field: string;
  transform: Transform;
  default_value?: string | null;
}

export interface FixtureMapping {
  entity_type: string;
  version: number;
  fields: FixtureFieldMapping[];
}

export interface AdapterFixture {
  name: string;
  entity_type: string;
  external_id: string;
  expect: 'completed' | 'rejected' | 'already_completed';
  covers: string[];
  payload: Record<string, unknown>;
  replayOf?: string;
  expectedErrors?: string[];
  moneyKeysInPayload?: string[];
}

export interface AdapterFixtureSet {
  id: string;
  label: string;
  vendorVocabulary: string;
  registrable: boolean;
  registrableReason: string;
  mappings: FixtureMapping[];
  fixtures: AdapterFixture[];
}

export interface IdempotencyScenario {
  name: string;
  adapter: string;
  steps: string[];
  maxAttempts?: number;
  expect: Record<string, unknown>;
}

export interface AdapterFixtureFile {
  schemaBinding: {
    migration: string;
    registrableAdapterKinds: string[];
    moneyFreeConstraint: string;
    idempotencyConstraint: string;
    oneActiveMappingIndex: string;
    bindAllowlistConstraint: string;
    transforms: Transform[];
    terminalStatuses: string[];
  };
  guards: {
    moneyFieldPattern: string;
    erpMoneyKeys: string[];
    directionDenyKeys: Record<OrgKind, string[]>;
  };
  adapters: AdapterFixtureSet[];
  redactionCases: Array<{
    name: string;
    orgKind: OrgKind;
    mustNotRender: string[];
    payload: Record<string, unknown>;
  }>;
  idempotencyScenarios: IdempotencyScenario[];
}

export const FIXTURES = fixturesJson as unknown as AdapterFixtureFile;

/**
 * The SAME literal that integration_canonical_fields_money_free carries. The
 * contract test asserts these two are byte-identical, so a migration that
 * widened or narrowed the CHECK cannot leave this copy stale.
 */
export const MONEY_FIELD_RE = new RegExp(FIXTURES.guards.moneyFieldPattern, 'i');

// ── Credential handling ─────────────────────────────────────────────────────

/**
 * A lowercase sha256 hex digest — exactly what
 * integration_connector_secrets_digest_shape permits and
 * nx_integration_register_secret demands. A plaintext bearer token cannot
 * satisfy this, which is the whole point: refusing here means a plaintext
 * credential never leaves the operator's browser, let alone reaches Postgres.
 */
export function isSecretDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value.trim());
}

// ── Mapping, mirroring nx_integration_map_payload ───────────────────────────

export function applyTransform(raw: string, transform: Transform): string {
  switch (transform) {
    case 'trim':
      return raw.trim();
    case 'upper':
      return raw.trim().toUpperCase();
    case 'lower':
      return raw.trim().toLowerCase();
    default:
      return raw;
  }
}

/**
 * Applies a mapping set to a payload exactly as nx_integration_map_payload
 * does: present-and-non-null wins, otherwise default_value, otherwise the
 * canonical field is simply absent. An unmapped external field is NOT carried
 * — the canonical shape is the contract and a field with no canonical home has
 * nowhere to go.
 */
export function applyMapping(
  fields: readonly FixtureFieldMapping[],
  payload: Record<string, unknown>,
): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const f of fields) {
    const present =
      Object.prototype.hasOwnProperty.call(payload, f.external_field) &&
      payload[f.external_field] !== null &&
      payload[f.external_field] !== undefined;
    const raw = present
      ? String(payload[f.external_field])
      : (f.default_value ?? null);
    if (raw === null) continue;
    canonical[f.canonical_field] = applyTransform(raw, f.transform);
  }
  return canonical;
}

// ── Payload preview redaction ───────────────────────────────────────────────

export interface RedactedPayload {
  /** Only keys that survived every rule. Safe to render. */
  shown: Array<{ key: string; value: string }>;
  /** How many keys were withheld, and why — so "redacted" never reads as "empty". */
  withheldUnmapped: number;
  withheldCommercial: string[];
  /** True when no active mapping is known, so nothing can be allowlisted. */
  noMappingKnown: boolean;
}

/**
 * Redacts a raw inbound payload for operator display.
 *
 *  • ALLOWLIST — a key renders only if the connector's active mapping maps it
 *    to a canonical field. Canonical fields cannot be money (proof P1), so the
 *    allowlist is money-blind by construction rather than by vigilance.
 *  • DIRECTIONAL DENY — belt and braces. Even an allowlisted key is dropped if
 *    it is forbidden in this organisation's direction, or if it looks like
 *    money under the canonical money vocabulary, or if it is a known SAP /
 *    Oracle money attribute. None of these should ever fire on an allowlisted
 *    key; if one does, the canonical registry has drifted and the operator
 *    should see the withholding rather than the value.
 *
 * `mappedExternalFields` empty means no active mapping version exists for that
 * connector and entity — nothing is allowlisted, and the caller is told so
 * explicitly instead of being shown an empty object that looks like an empty
 * payload.
 */
export function redactPayload(
  payload: Record<string, unknown> | null | undefined,
  mappedExternalFields: ReadonlySet<string>,
  orgKind: OrgKind | null,
): RedactedPayload {
  const shown: Array<{ key: string; value: string }> = [];
  const withheldCommercial: string[] = [];
  let withheldUnmapped = 0;

  const denyList = orgKind ? FIXTURES.guards.directionDenyKeys[orgKind] : [];
  const deny = new Set((denyList ?? []).map((k) => k.toLowerCase()));
  const erpMoney = new Set(
    FIXTURES.guards.erpMoneyKeys.map((k) => k.toLowerCase()),
  );

  if (!payload || typeof payload !== 'object') {
    return {
      shown,
      withheldUnmapped: 0,
      withheldCommercial: [],
      noMappingKnown: mappedExternalFields.size === 0,
    };
  }

  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();

    if (deny.has(lower) || erpMoney.has(lower) || MONEY_FIELD_RE.test(key)) {
      withheldCommercial.push(key);
      continue;
    }
    if (!mappedExternalFields.has(key)) {
      withheldUnmapped += 1;
      continue;
    }
    shown.push({
      key,
      value: value === null || value === undefined ? '—' : String(value),
    });
  }

  return {
    shown,
    withheldUnmapped,
    withheldCommercial,
    noMappingKnown: mappedExternalFields.size === 0,
  };
}

// ── Idempotency, made legible ───────────────────────────────────────────────

export interface ReplayVerdict {
  /** What nx_integration_claim_message would return for a redelivery. */
  reason: string;
  /** Plain English, for an operator who needs to know a replay is safe. */
  explanation: string;
  /** Whether a redelivery would change stored state at all. */
  wouldChangeState: boolean;
  /** Whether the operator's replay RPC would accept this message. */
  operatorReplayable: boolean;
}

/**
 * The branch table of nx_integration_claim_message, rendered rather than
 * remembered. This is the "idempotency made visible" requirement: an operator
 * looking at a completed message can SEE that a redelivery of the same
 * external id returns already_completed and writes nothing — that a replay did
 * not double-apply — instead of having to trust that it did not.
 */
export function replayVerdict(status: string): ReplayVerdict {
  switch (status) {
    case 'completed':
      return {
        reason: 'already_completed',
        explanation:
          'A redelivery of this external id is refused by the idempotency key and changes nothing. It was applied exactly once. The operator replay RPC also refuses it — reprocessing a processed id is what this ledger exists to prevent.',
        wouldChangeState: false,
        operatorReplayable: false,
      };
    case 'processing':
      return {
        reason: 'in_flight_elsewhere',
        explanation:
          'A worker holds this message right now. A redelivery is refused rather than run twice in parallel.',
        wouldChangeState: false,
        operatorReplayable: false,
      };
    case 'dead_letter':
      return {
        reason: 'dead_letter',
        explanation:
          'Retries were exhausted or the failure was permanent. A sender redelivery is refused; only an operator requeue moves it, and it moves the SAME row so the idempotency key is preserved.',
        wouldChangeState: false,
        operatorReplayable: true,
      };
    case 'rejected':
      return {
        reason: 'rejected_invalid',
        explanation:
          'The payload does not satisfy the canonical shape. An identical body can never pass, so it went terminal immediately instead of burning the attempt budget. Fix the mapping, then requeue.',
        wouldChangeState: false,
        operatorReplayable: true,
      };
    case 'failed_retryable':
      return {
        reason: 'backoff_not_elapsed | reclaimed',
        explanation:
          'A redelivery is accepted once next_attempt_at has elapsed, and reuses this same row. Attempts increment; no second row is ever created.',
        wouldChangeState: true,
        operatorReplayable: true,
      };
    case 'received':
      return {
        reason: 'reclaimed',
        explanation:
          'Queued. The next delivery attempt claims this same row.',
        wouldChangeState: true,
        operatorReplayable: true,
      };
    default:
      return {
        reason: 'unknown_status',
        explanation: 'Unrecognised ledger status.',
        wouldChangeState: false,
        operatorReplayable: false,
      };
  }
}

/** Short, non-secret digest fragment for operator identification. */
export function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '—';
  return digest.slice(0, 12);
}
