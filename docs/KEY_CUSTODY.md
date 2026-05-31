# NEXPEC Model-Signing Key Custody

The model-signing key is the root of trust for the entire Provable-AI moat. A
device only runs an on-device model after the model's **canonical attestation**
(`{kind, slug, version, sha256, runtime, tier}`) verifies against NEXPEC's
public key (Ed25519). Whoever holds the **private** key can forge a valid
signature over any attestation and defeat on-device verification. Treat it like
a code-signing certificate.

## The canonical key

| Field | Value |
|---|---|
| Algorithm | Ed25519 (EdDSA, RFC 8032) |
| Key id | `nexpec-model-2026-v1` |
| Public key fingerprint | sha256(SPKI) = `95177212d877ffc0c53a…` |
| Private key file | `nexpec_model_signing.pem` — **gitignored, signing box only** |
| Public key file | `nexpec_model_signing.pub.pem` — committed (safe) |
| Pinned in app | `src/core/ml/flags.ts` → `NEXPEC_ML_SIGNING_PUBLIC_KEY_PEM` |

The public key is **pinned in the app binary** so a missing/empty
`EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM` env can never silently disable authenticity
checks. The env var still overrides the pin, for emergency rotation between
releases. A public key can only *verify*, never *sign* — embedding it is safe.

## Custody rules

1. The private key lives **only** on the signing box (your in-house GPU/registration
   machine) or in a secret manager (1Password, AWS Secrets Manager, EAS secret).
   It is never committed, never shipped in the app, never placed on a device.
2. `.gitignore` ignores every private-key form (`*.pem`, `*.key`, `*.p8`,
   `*.p12`, …) and re-allows only `*.pub.pem`. Do not override this.
3. Signing happens offline via `scripts/ml/register-model.mjs --sign …`. The
   produced signature + sha256 + attestation are all public and may be committed
   (see `scripts/ml/corrosion-detector.v1.signed.json`).
4. Only **student** (distilled) models are ever signed/published. The registry
   refuses to publish a **teacher** artifact (schema CHECK + RPC guard).

## ⚠ Incident: `nexpec_signing_v1.pem` was committed (burned key)

A *different*, earlier private key — `nexpec_signing_v1.pem` (fingerprint
`45362274f3299a01bcd0…`) — was accidentally committed in `314e4e7`
("fix: remove legacy triggers … add Voice Recorder"). It has been **untracked**
(`git rm --cached`) and is now gitignored.

Blast radius is **low**: this key was never wired as the trust anchor (the app
pins the *canonical* key above; `.env` carried no `EXPO_PUBLIC_ML_*` var) and the
ML runtime ships **off** by default, so it never signed a published, distributed
model. Nonetheless a committed private key must be treated as **compromised and
permanently retired**. Do not ever use `nexpec_signing_v1` to sign anything.

### Required remediation (run on your machine — rewrites history)

```bash
# 1) Purge the key blob from ALL git history (pick ONE tool):
#    git-filter-repo (recommended):
pip install git-filter-repo
git filter-repo --invert-paths --path nexpec_signing_v1.pem --path nexpec_signing_v1.pub.pem
#    …or BFG:
#    bfg --delete-files 'nexpec_signing_v1.*' && git reflog expire --expire=now --all && git gc --prune=now --aggressive

# 2) Force-push the rewritten history (coordinate with any collaborators):
git push --force-with-lease origin --all
git push --force-with-lease origin --tags

# 3) Delete the local burned key files (no longer needed):
rm -f nexpec_signing_v1.pem nexpec_signing_v1.pub.pem
```

Because the burned key never anchored a published model, **no model re-signing
is required** — the canonical `nexpec-model-2026-v1` key remains valid and is
what everything already uses.

## Rotation procedure (when you do need a new key)

1. Generate: `openssl genpkey -algorithm ed25519 -out nexpec_model_signing_vN.pem`
   then `openssl pkey -in …vN.pem -pubout -out nexpec_model_signing_vN.pub.pem`.
2. Add the new public key to the app's key map (ship `signingKeys[new-id] = PEM`
   in `runtime.ts`; keep the old id so already-signed artifacts still verify).
3. Re-sign current models with the new key + new `--key-id`, re-`ml_register_model`.
4. Once all live artifacts carry the new signature, retire the old key.
