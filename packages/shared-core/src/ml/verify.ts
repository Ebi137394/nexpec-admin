// ════════════════════════════════════════════════════════════════════════════
//  ml/verify.ts — integrity + authenticity gate (fail-closed)
//
//  Two independent checks before a model is ever handed to an inference backend:
//    1. CONTENT INTEGRITY — sha256(downloaded bytes) === artifact.sha256
//       (catches corruption / a swapped file).
//    2. AUTHENTICITY      — the artifact's signature verifies against NEXPEC's
//       public key over the canonical attestation (catches a compromised
//       registry row / MITM that swaps both file and its recorded hash).
//
//  Policy is fail-closed: if a signature is required but cannot be verified,
//  the model is rejected. A rejected model means the feature reports
//  "unavailable" — it NEVER means an unverified model runs.
// ════════════════════════════════════════════════════════════════════════════

import type { ModelArtifact, SignatureAlg } from './types';
import { artifactAttestation } from './canonical';
import type { SignatureVerifier } from './providers';

export interface VerifyOptions {
  /** When true (production default), an artifact with no verifiable signature
   *  is REJECTED. Set false only for local development of unsigned models. */
  requireSignature: boolean;
  /** Default public key (PEM) when an artifact has no signing_key_id. */
  publicKeyPem?: string;
  /** Optional key registry: signing_key_id → PEM. */
  signingKeys?: Record<string, string>;
  verifier?: SignatureVerifier;
  /** Injectable for environments without a global TextEncoder (rare). */
  textEncoder?: { encode(input: string): Uint8Array };
}

export type VerifyReason =
  | 'ok'
  | 'sha256_mismatch'
  | 'verifier_unavailable'
  | 'bad_signature'
  | 'signature_required'
  | 'unsigned_allowed'
  | 'signature_skipped';

export interface VerifyResult {
  ok: boolean;
  reason: VerifyReason;
  signatureChecked: boolean;
}

export async function verifyDownloadedArtifact(params: {
  artifact: ModelArtifact;
  actualSha256Hex: string;
  options: VerifyOptions;
}): Promise<VerifyResult> {
  const { artifact, actualSha256Hex, options } = params;

  // 1) content integrity
  if (actualSha256Hex.toLowerCase() !== artifact.sha256.toLowerCase()) {
    return { ok: false, reason: 'sha256_mismatch', signatureChecked: false };
  }

  // 2) authenticity
  const hasSig = Boolean(artifact.signature && artifact.signatureAlg);
  if (hasSig) {
    const pub =
      (artifact.signingKeyId && options.signingKeys?.[artifact.signingKeyId]) ||
      options.publicKeyPem;
    const verifier = options.verifier;
    const verifierReady = verifier ? await Promise.resolve(verifier.available()) : false;

    if (!verifier || !verifierReady || !pub) {
      // Can't check a signature that exists → only proceed if signatures aren't required.
      return options.requireSignature
        ? { ok: false, reason: 'verifier_unavailable', signatureChecked: false }
        : { ok: true, reason: 'signature_skipped', signatureChecked: false };
    }

    const enc = options.textEncoder ?? new TextEncoder();
    const message = enc.encode(artifactAttestation(artifact));
    let valid = false;
    try {
      valid = await verifier.verify({
        message,
        signatureB64: artifact.signature as string,
        publicKeyPem: pub,
        alg: artifact.signatureAlg as SignatureAlg,
      });
    } catch {
      valid = false;
    }
    return valid
      ? { ok: true, reason: 'ok', signatureChecked: true }
      : { ok: false, reason: 'bad_signature', signatureChecked: true };
  }

  // 3) no signature on the artifact
  return options.requireSignature
    ? { ok: false, reason: 'signature_required', signatureChecked: false }
    : { ok: true, reason: 'unsigned_allowed', signatureChecked: false };
}
