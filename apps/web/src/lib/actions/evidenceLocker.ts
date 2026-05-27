'use server';

// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/evidenceLocker.ts — Compliance Evidence Locker actions
//
//  Sequence of assembleEvidencePackAction(jobId):
//    1. Call RPC `assemble_evidence_pack(job_id)` — returns the seven
//       artifact groups + a correlation_id, also writes the audit row.
//    2. Compute SHA-256 over canonical JSON of each artifact → manifest.
//    3. Compute the root_hash over the canonical JSON of the manifest
//       artifacts array.
//    4. Build the envelope (export_id, exported_at, exporting identity).
//    5. Return the complete pack — envelope + manifest + artifacts.
//
//  The client serialises this to a downloadable .json file. An auditor
//  verifies by re-running the export against unchanged DB state and
//  comparing the root_hash values.
// ════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canonicalJson, sha256OfCanonical } from '@/lib/server/canonicalJson';
import {
  assembleEvidencePackInput,
  type EvidencePack,
  type EvidenceManifest,
  type EvidenceManifestEntry,
  type EvidencePackEnvelope,
} from '@nexpec/shared-core';

interface ActionResult<TPayload = Record<string, unknown>> {
  ok: boolean;
  error: string | null;
  payload?: TPayload;
}

/** Bill-of-materials count for the manifest. */
function countOf(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return 1;
  return 0;
}

const GENERATOR_VERSION = '1.0.0';

/** Names of the artifacts in the canonical manifest order. */
const ARTIFACT_NAMES = [
  'audit_events',
  'approvals',
  'contracts',
  'department',
  'invoices',
  'job',
  'parties',
] as const;

export async function assembleEvidencePackAction(input: {
  jobId: string;
}): Promise<ActionResult<EvidencePack>> {
  const parsed = assembleEvidencePackInput.safeParse({ p_job_id: input.jobId });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid job id.',
    };
  }

  const supabase = await createSupabaseServerClient();

  // ── 1. Identify the actor for the envelope ───────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', user.id)
    .maybeSingle();

  const actorLabel =
    profile?.full_name?.trim() ||
    profile?.email ||
    user.email ||
    'Unknown';

  // ── 2. Call the RPC ──────────────────────────────────────────────
  const { data, error } = await supabase.rpc(
    'assemble_evidence_pack',
    parsed.data,
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    correlation_id?: string;
    artifacts?: Record<string, unknown>;
  };
  if (!result.ok || !result.artifacts) {
    return {
      ok: false,
      error: 'assemble_evidence_pack returned a non-ok response.',
    };
  }

  const artifacts = result.artifacts;

  // ── 3. Build the manifest ─────────────────────────────────────────
  const manifestEntries: EvidenceManifestEntry[] = ARTIFACT_NAMES.map((name) => {
    const value = artifacts[name];
    return {
      name,
      hash: sha256OfCanonical(value ?? null),
      count: countOf(value),
    };
  });

  const rootHash = sha256OfCanonical(manifestEntries);

  const manifest: EvidenceManifest = {
    algorithm: 'SHA-256',
    artifacts: manifestEntries,
    root_hash: rootHash,
  };

  // ── 4. Envelope ──────────────────────────────────────────────────
  const envelope: EvidencePackEnvelope = {
    export_id: randomUUID(),
    exported_at: new Date().toISOString(),
    exported_by_id: user.id,
    exported_by_label: actorLabel,
    exported_by_role: (profile?.role as string | null) ?? 'authenticated',
    generator_version: GENERATOR_VERSION,
    platform: 'NEXPEC',
    job_id: input.jobId,
    correlation_id: result.correlation_id ?? '',
  };

  const pack: EvidencePack = {
    envelope,
    manifest,
    artifacts,
  };

  return { ok: true, error: null, payload: pack };
}

/**
 * Suggested filename for the download. Deterministic given a pack.
 */
export async function filenameForEvidencePack(
  pack: EvidencePack,
): Promise<string> {
  const jobShort = pack.envelope.job_id.slice(0, 8);
  const exportShort = pack.envelope.export_id.slice(0, 8);
  return `nexpec-evidence-${jobShort}-${exportShort}.json`;
}

/**
 * Convenience helper for the UI to serialize the pack the same way it's
 * downloaded (pretty-printed JSON for human readability). Verification
 * scripts MUST re-canonicalise via `canonicalJsonForVerification` —
 * the file's whitespace has no security relevance.
 */
export async function serializeEvidencePackForDownload(
  pack: EvidencePack,
): Promise<string> {
  return JSON.stringify(pack, null, 2);
}

/**
 * Re-exports the canonical-JSON helper so a future verification page
 * can recompute hashes without importing from lib/server (which is
 * action-only by convention).
 */
export async function canonicalJsonForVerification(
  value: unknown,
): Promise<string> {
  return canonicalJson(value);
}
