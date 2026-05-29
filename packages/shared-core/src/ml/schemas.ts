// ════════════════════════════════════════════════════════════════════════════
//  ml/schemas.ts — runtime validation of the ml_resolve_models RPC payload
//
//  The DB returns snake_case JSON; we validate its shape with Zod and map to the
//  camelCase ModelArtifact the rest of the app uses. Uses only the Zod surface
//  shared by v3 and v4 (no z.record / z.enum) so it is version-agnostic.
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import type { DeviceTier, ModelArtifact, OsConstraint, ResolveResponse, ModelRuntime, ModelTier, SignatureAlg } from './types';

const zRawArtifact = z.object({
  id: z.string(),
  kind: z.string(),
  slug: z.string(),
  version: z.number(),
  semver: z.string().nullable().optional(),
  runtime: z.string(),
  tier: z.string(),
  storage_bucket: z.string(),
  storage_path: z.string(),
  size_bytes: z.number(),
  sha256: z.string(),
  signature: z.string().nullable().optional(),
  signature_alg: z.string().nullable().optional(),
  signing_key_id: z.string().nullable().optional(),
  device_min_tier: z.string(),
  min_app_version: z.string().nullable().optional(),
  os_constraint: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  params: z.unknown().optional(),
});

const zRawResolve = z.object({
  generated_at: z.string(),
  device: z.object({ tier: z.string(), os: z.string() }),
  app_version: z.string().nullable().optional(),
  models: z.array(zRawArtifact),
});

type RawArtifact = z.infer<typeof zRawArtifact>;

function mapArtifact(r: RawArtifact): ModelArtifact {
  return {
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    version: r.version,
    semver: r.semver ?? undefined,
    runtime: r.runtime as ModelRuntime,
    tier: r.tier as ModelTier,
    storageBucket: r.storage_bucket,
    storagePath: r.storage_path,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    signature: r.signature ?? undefined,
    signatureAlg: (r.signature_alg ?? undefined) as SignatureAlg | undefined,
    signingKeyId: r.signing_key_id ?? undefined,
    deviceMinTier: r.device_min_tier as DeviceTier,
    minAppVersion: r.min_app_version ?? undefined,
    osConstraint: (r.os_constraint ?? 'any') as OsConstraint,
    license: r.license ?? undefined,
    params: (r.params ?? {}) as Record<string, unknown>,
  };
}

/** Validate + normalize the raw RPC response. Throws on a malformed payload. */
export function parseResolveResponse(data: unknown): ResolveResponse {
  const r = zRawResolve.parse(data);
  return {
    generatedAt: r.generated_at,
    device: { tier: r.device.tier as DeviceTier, os: r.device.os as OsConstraint },
    appVersion: r.app_version ?? undefined,
    models: r.models.map(mapArtifact),
  };
}
