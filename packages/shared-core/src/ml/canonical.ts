// ════════════════════════════════════════════════════════════════════════════
//  ml/canonical.ts — deterministic serialization for signing/verification
//
//  The signature on a model artifact is computed over a CANONICAL string so the
//  signer (Node tool) and the verifier (device) agree byte-for-byte regardless
//  of key ordering or whitespace. Mirrors the discipline of the Provable
//  Inspection Engine's pi_canonical_json().
// ════════════════════════════════════════════════════════════════════════════

/** Stable JSON: object keys sorted, undefined dropped, no incidental whitespace. */
export function canonicalJSONStringify(value: unknown): string {
  return ser(value);
}

function ser(v: unknown): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) throw new Error('canonical: non-finite number');
    return JSON.stringify(v);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(v);
  if (t === 'undefined') return 'null';
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  if (t === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + ser(o[k])).join(',') + '}';
  }
  throw new Error('canonical: unsupported type ' + t);
}

/** The exact fields that are signed. Binds identity + hash together so a valid
 *  signature attests "NEXPEC authorized THIS file (sha256) as THIS model". */
export interface ArtifactAttestationInput {
  kind: string;
  slug: string;
  version: number;
  sha256: string;
  runtime: string;
  tier: string;
}

export function artifactAttestation(a: ArtifactAttestationInput): string {
  return canonicalJSONStringify({
    kind: a.kind,
    slug: a.slug,
    version: a.version,
    sha256: a.sha256.toLowerCase(),
    runtime: a.runtime,
    tier: a.tier,
  });
}
