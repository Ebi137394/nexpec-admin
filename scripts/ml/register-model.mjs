#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/ml/register-model.mjs — publish a model to the NEXPEC registry
//
//  Runs on YOUR machine (or the in-house GPU box) — $0, no third-party service.
//  It hashes the model, uploads it to the private `ml-models` Storage bucket,
//  optionally SIGNS the canonical attestation with your private key, registers
//  the artifact via ml_register_model, and publishes it via ml_set_model_status.
//
//  The canonical attestation here is byte-identical to shared-core's
//  artifactAttestation() so the device signature check verifies.
//
//  Usage:
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//    node scripts/ml/register-model.mjs \
//      --file ./corrosion-detector.onnx \
//      --kind vision_defect --slug corrosion-detector --version 1 \
//      --runtime onnx --tier student --device-min-tier standard --os any \
//      --license Apache-2.0 \
//      --sign ./nexpec_model_signing.pem --alg ed25519 --key-id model-v1 \
//      --params '{"input":"rgb_224","labels":["corrosion","clean"]}'
//
//  Requires: @supabase/supabase-js (already in the repo), Node 18+.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i++, i)] : 'true';
      o[k] = v;
    }
  }
  return o;
}

// Must match packages/shared-core/src/ml/canonical.ts exactly.
function canonical(value) {
  const ser = (v) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite'); return JSON.stringify(v); }
    if (t === 'boolean' || t === 'string') return JSON.stringify(v);
    if (t === 'undefined') return 'null';
    if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
    if (t === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + ser(v[k])).join(',') + '}';
    }
    throw new Error('unsupported type ' + t);
  };
  return ser(value);
}

function attestation({ kind, slug, version, sha256, runtime, tier }) {
  return canonical({ kind, slug, version, sha256: sha256.toLowerCase(), runtime, tier });
}

function sign(privPem, alg, message) {
  const key = crypto.createPrivateKey(privPem);
  const msg = Buffer.from(message, 'utf8');
  if (alg === 'ed25519') return crypto.sign(null, msg, key).toString('base64');
  if (alg === 'rsa-pss-sha256')
    return crypto.sign('sha256', msg, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  if (alg === 'ecdsa-p256-sha256')
    return crypto.sign('sha256', msg, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
  throw new Error('unsupported alg ' + alg);
}

async function main() {
  const a = args(process.argv);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
  }
  for (const req of ['file', 'kind', 'slug', 'version', 'runtime']) {
    if (!a[req]) { console.error(`Missing --${req}`); process.exit(1); }
  }

  const tier = a.tier || 'student';
  if (tier === 'teacher') {
    console.error('Refusing to publish a TEACHER artifact — teachers never leave your infrastructure (Law 3).');
    process.exit(1);
  }

  const bytes = readFileSync(a.file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const version = parseInt(a.version, 10);
  const storagePath = `${a.kind}/${a.slug}/v${version}/${basename(a.file)}`;

  let signature = null, signatureAlg = null, signingKeyId = null;
  if (a.sign) {
    signatureAlg = a.alg || 'ed25519';
    signingKeyId = a['key-id'] || null;
    signature = sign(readFileSync(a.sign, 'utf8'), signatureAlg, attestation({ kind: a.kind, slug: a.slug, version, sha256, runtime: a.runtime, tier }));
    console.log(`✓ signed attestation (${signatureAlg})`);
  } else {
    console.warn('⚠ no --sign: artifact will be UNSIGNED (devices must run with ML_ALLOW_UNSIGNED to load it).');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log(`↑ uploading ${(bytes.length / 1e6).toFixed(1)} MB → ml-models/${storagePath}`);
  const up = await sb.storage.from('ml-models').upload(storagePath, bytes, { contentType: 'application/octet-stream', upsert: true });
  if (up.error) { console.error('upload failed:', up.error.message); process.exit(1); }

  const reg = await sb.rpc('ml_register_model', {
    p_kind: a.kind, p_slug: a.slug, p_version: version, p_runtime: a.runtime,
    p_storage_path: storagePath, p_size_bytes: bytes.length, p_sha256: sha256,
    p_tier: tier, p_semver: a.semver || null,
    p_signature: signature, p_signature_alg: signatureAlg, p_signing_key_id: signingKeyId,
    p_device_min_tier: a['device-min-tier'] || 'standard',
    p_min_app_version: a['min-app'] || null, p_os_constraint: a.os || 'any',
    p_license: a.license || null, p_params: a.params ? JSON.parse(a.params) : {}, p_notes: a.notes || null,
  });
  if (reg.error) { console.error('register failed:', reg.error.message); process.exit(1); }
  const id = reg.data;
  console.log(`✓ registered artifact ${id}`);

  const pub = await sb.rpc('ml_set_model_status', { p_id: id, p_status: 'published' });
  if (pub.error) { console.error('publish failed:', pub.error.message); process.exit(1); }
  console.log(`✓ PUBLISHED ${a.kind}/${a.slug} v${version}  (sha256 ${sha256.slice(0, 12)}…)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
