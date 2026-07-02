---
name: reference-ots-and-release
description: OpenTimestamps confirmation loop (anchor→confirm) + EAS/Apple release config for NEXPEC 1.0
metadata: 
  node_type: memory
  type: reference
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

**OTS Bitcoin timestamping is two-phase.** `anchor-inspection-seals` (existing) POSTs a seal's `root_sha256` to a free OTS calendar (`a.pool.opentimestamps.org`) and stores a **pending** proof → `inspection_seal_anchors.status='submitted'`. `confirm-inspection-anchors` (NEW, 2026-05-30) upgrades it: it walks the proof with the pure reader `supabase/functions/_shared/ots.ts` to recover each pending calendar commitment, GETs `<calendar>/timestamp/<commitment-hex>`, and once the response carries a **Bitcoin attestation** flips the anchor to `bitcoin_confirmed` + records `bitcoin_block_height`. Migration `20260716120000_ots_confirmation.sql` adds `bitcoin_block_height` + `upgraded_at` and surfaces the height in `get_inspection_passport`. $0 (OTS calendars are a public good; no Bitcoin node).

**`_shared/ots.ts`** is a dependency-free OTS reader: injected sync `hash(name,bytes)` (Deno passes `node:crypto` createHash), walks the timestamp tree tracking the running message through ops (sha256/ripemd160/append/prepend/…), collects pending {uri,commitment} + bitcoin {height}. Proven by `scripts/ml/prove-ots.mjs` (9/9: builds spec-correct synthetic pending + bitcoin proofs, asserts URI/commitment(op-replay)/height; garbage throws — no false confirmations). Schedule via pg_cron: anchor ~every 10 min, confirm hourly (Bitcoin is slow).

**Release config.** `eas.json` already had dev/preview/production profiles (channels, autoIncrement, `appVersionSource: remote`, submit placeholders). Added to `app.config.js`: `runtimeVersion {policy:'appVersion'}` + `updates.url = https://u.expo.dev/${EAS_PROJECT_ID}` (inert until EAS_PROJECT_ID set). Full runbook `docs/RELEASE.md` — EAS init/secrets, **Apple App Store Connect API key** path (recommended over manual certs), Android keystore + Play service-account, build/submit, OTA, OTS cron, model registration, pre-flight checklist. Apple/Play credential creation is account-level (user's hands); everything else is config. See [[project-provable-ai-loop]].
