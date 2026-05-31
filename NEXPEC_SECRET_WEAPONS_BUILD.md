# NEXPEC — Secret Weapons Build (B.3 + VIP + Predictive Integrity + Field Black-Box/Copilot)

**Date:** 2026-05-29 · **Status:** foundations **built & type-clean** (shared-core `tsc` exit 0; new mobile files 0 errors) · additive + $0 + zero-breakage.

This is the engineering record for the build the CEO greenlit: Phase B.3 plus the three secret weapons, laid down as **additive foundations** (SQL + pure-TS shared-core + unwired mobile scaffolds), with the remaining device/DB-dependent wiring listed honestly.

---

## What shipped this build

| File | Layer | Purpose |
|---|---|---|
| `supabase/migrations/20260705120000_coinspector_weapons.sql` | DB | `ai_detections`, `inspection_seal_anchors`, `assets`, `asset_defect_observations` + RPCs `pi_record_ai_detection`, `record_seal_anchor`, `get_inspection_passport` (public), `get_asset_timeline`; RLS + audit; idempotent |
| `shared-core/ml/aiAssist.ts` | shared | Provable-AI payload (`buildAiAssist`, `aiAssistToRpcArgs`) carrying model slug/version/sha256 |
| `shared-core/passport/index.ts` | shared | VIP contract: `parseInspectionPassport`, `passportTrustVerdict`, `anchorLabel`, `passportUrl` |
| `shared-core/integrity/rbi.ts` | shared | Deterministic Risk-Based Inspection: `computeRiskScore`, `projectProgression` |
| `shared-core/voice/transcriptToDefects.ts` | shared | $0 taxonomy-driven NLU: transcript → defect suggestions |
| `src/core/ml/useDefectAnalysis.ts` | mobile | Run the universal model on an image → `DefectAnalysis` |
| `src/core/ml/voice/useVoiceFindings.ts` | mobile | On-device STT (guarded) + NLU → voice findings (unwired) |
| `src/shared-ui/ai/DefectFindingsCard.tsx` | mobile | Generic multi-defect AI card (built earlier this session) |

All references confirmed against the real schema (`pi_report_seals`, `organizations`, `is_member_of_org(uuid)`, `nx_is_admin()`, `inspector_certifications/equipment`).

---

## 1. Provable AI (B.3)

- **Store:** `ai_detections` — one immutable, RLS-gated row per AI suggestion, carrying `model_slug + model_version + model_sha256` and `accepted_by_human`. Written via `pi_record_ai_detection` (inspector-on-own-job, audited).
- **Flow:** `useDefectAnalysis(imageUri)` → `DefectAnalysis` → `DefectFindingsCard` → inspector taps *Add as finding* → `aiAssistToRpcArgs(buildAiAssist(detection, {slug,version,sha256}))` → `pi_record_ai_detection`.
- **Seal binding (the masterstroke) — exact follow-up:** because `pi_seal_inspection_report` already hashes the inspection items into `items_root_sha256`, the cleanest binding is to (a) include the accepted `ai_detections` for the report in the canonical items payload, **or** (b) add a 5th component `ai_root_sha256` (SHA-256 over the ordered accepted detections incl. each `model_sha256`) to the seal composition. Either makes the AI attestation **tamper-evident under the existing seal**. This is a deliberate, reviewed edit to `pi_seal_inspection_report` + `assemble_evidence_pack` — *not* done blindly here; the contract + payload (`model_sha256`) are already in place to support it.

## 2. Verifiable Inspection Passport (VIP)

- **Public RPC `get_inspection_passport(seal_id)`** (anon-callable, like `/verify`) returns: seal root + `chain_verified` + counts + sealed-at, the inspector's name, **how many certifications/equipment were valid *as of the seal timestamp***, and the OpenTimestamps anchor status.
- **`inspection_seal_anchors`** stores the OTS proof + status; written by an Edge Function via `record_seal_anchor`.
- **shared-core `passport/`** parses the RPC payload and computes a trust verdict + anchor label, consumed identically by web + mobile.
- **OTS anchoring ($0) — Edge Function approach:** a scheduled function builds a daily Merkle root over new seal `root_sha256` values, submits it to the **free OpenTimestamps calendar servers** (no API key, no cost), stores the returned `.ots` proof, and later upgrades status to `bitcoin_confirmed`. Calendar submission is an HTTP call to a public good — **zero recurring third-party cost**.
- **Web `/passport/[sealId]` page (sketch):** a public Next.js route that calls the RPC, renders the seal hash + QR (`passportUrl()`), the credential/calibration validity, the trust verdict, and the anchor status with a "verify on Bitcoin" link. *(Provided as a sketch — not added to `apps/web` here to avoid any risk to the live web build; mirror the existing `/verify` page's Supabase client + styling when wiring.)*

## 3. Predictive Integrity (Risk-Based Inspection)

- **`assets` + `asset_defect_observations`** (org-scoped via `is_member_of_org`) record, per asset, every observed defect + severity over time.
- **`get_asset_timeline(asset_id)`** returns the observation history; **shared-core `integrity/rbi.ts`** turns it into a deterministic **Risk = Likelihood × Consequence** score, projects **defect progression** (least-squares slope per year), and outputs a **next-inspection-due** date. Pure TS, $0, no model.
- **Flow:** sealed AI/human findings → `asset_defect_observations` → `computeRiskScore({criticality, observations})` → an overdue heatmap + RBI schedule for the Enterprise Command Center.

## 4. Field Black-Box + Offline Voice Copilot

- **Field Black-Box** rides what already exists: the offline `SyncEngine` + `inspection_captures` (per-photo SHA-256 chain, EXIF/GPS/device-attestation). The "black-box" contract = **capture offline → run on-device AI offline → defer sealing, anchored to capture time** (the existing seal binds the capture chain + timestamps; GPS/attestation prove on-site presence). No new native dep required.
- **Voice Copilot:** `useVoiceFindings` does on-device STT via the OS recognizer (`@react-native-voice/voice`, free) **or** ingests a Whisper.cpp transcript, then maps it through `transcriptToDefects` → defect suggestions ($0, taxonomy-driven). Kept **unwired** (its STT dep isn't installed) so Metro is unaffected until you add it in a dev build.

---

## Verification

- `shared-core` full `tsc --noEmit`: **exit 0** (web + mobile gate) — validates taxonomy, defect contract, aiAssist, passport, RBI, NLU.
- Scoped mobile `tsc` over `src/core/ml/**` + `src/shared-ui/ai/**`: **0 errors** in the new files.
- SQL is additive + idempotent; **apply it on your DB (`supabase db push`)** to validate the PL/pgSQL RPC bodies against live tables (function bodies aren't checked at `CREATE` time).

---

## Remaining wiring (honest — each additive, device/DB-dependent)

1. **Publish the generalized universal model** (B.2): train/obtain a multi-label defect model, declare `params.defects.classes`, sign + publish as `vision_defect/universal-detector v1`.
2. **Wire the capture-review screen:** drop `<DefectFindingsCard>` + `useDefectAnalysis` in; on accept call `pi_record_ai_detection`. (One screen, additive.)
3. **Seal-binding edit** to `pi_seal_inspection_report` + `assemble_evidence_pack` (Provable AI) — the reviewed approach above.
4. **OTS Edge Function** (daily Merkle root → OpenTimestamps → `record_seal_anchor`) + the **web `/passport/[sealId]`** page.
5. **Asset linkage:** assign jobs/captures to `assets`; populate `asset_defect_observations` from sealed findings; build the client-facing **risk dashboard** on `computeRiskScore`.
6. **Voice:** install `@react-native-voice/voice` (dev build) + a voice-capture screen using `useVoiceFindings`; or wire Whisper.cpp → `ingestTranscript`.

---

## Terminal blocks

```bash
# Apply the backend backbone
supabase db push
#   …or: psql "$DATABASE_URL" -f supabase/migrations/20260705120000_coinspector_weapons.sql

# Publish the generalized universal defect model (signed), once trained/obtained
node scripts/ml/register-model.mjs --file ./universal-detector-int8.tflite \
  --kind vision_defect --slug universal-detector --version 1 \
  --runtime tflite --tier student --device-min-tier standard --os any --license Apache-2.0 \
  --sign ./nexpec_model_signing.pem --alg ed25519 --key-id model-v1 \
  --params '{"input":{"width":224,"height":224,"layout":"NHWC","normalize":{"scale":0.0078431,"offset":-1}},
             "defects":{"multiLabel":true,"threshold":0.5,
               "classes":["corrosion","pitting","crack","coating_flaking","weld_porosity","concrete_crack"]}}'
```

---

*Foundations are built and type-clean. The laws held: every object is additive, all intelligence is on-device/in-DB ($0), and nothing existing was altered. The remaining items are wiring + the model, each additive and flag-gated.*
