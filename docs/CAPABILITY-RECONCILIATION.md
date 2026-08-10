# NEXPEC Capability Reconciliation

Evidence-based inventory of what already exists, produced before any further
feature work. Regenerate the raw evidence at any time:

```bash
npm run qa:reconcile          # summary table
npm run qa:reconcile -- --full   # + sample file paths
node scripts/qa/capability-reconciliation.mjs welding   # filter one capability
```

**Scale of the existing product:** 120 migrations · ~544 database functions ·
38 Edge Functions · 276 mobile screens · 166 web routes · 348 web components ·
28 SQL test suites.

**Headline result across 62 capabilities:**

| classification | count |
|---|---|
| WIRED (backend **and** UI evidence) | 47 |
| UI ONLY | 8 |
| BACKEND ONLY | 2 |
| NO EVIDENCE (by keyword) | 4 |

The premise was correct: the overwhelming majority of the capability list
already exists. The valuable work is connection and completion, not
construction.

> A caution on reading the table: counts are *files containing a keyword match*.
> They are evidence to follow up, not proof of completeness. Several entries
> below were reclassified **after** manual inspection contradicted the keyword
> result — that is the intended workflow, and the reason "NO EVIDENCE" never
> means "missing" until a human has looked.

---

## Confirmed complete — preserve, do not rebuild

Verified present on both a backend and a UI surface:

- **Enterprise**: organizations, agencies, teams, departments, invitations,
  org roles, `/admin/orgs/[id]/structure`
- **Projects** (14 db / 92 mobile / 32 web files)
- **Supplier / procurement**: suppliers, RFQs, quotes, deals, supplier payouts,
  vendor bridge auth, supplier operational chat
- **Scheduling / availability / conflict detection** (20 db / 79 mobile / 56 web)
- **Reporting**: `report_templates` with `scope`, `client_id`, `org_id`,
  `header_template`, `footer_template`, `template_spec`, `spec_sha256`,
  versioning and locking; PDF generation; revisions; client approval
- **Cryptographic evidence**: SHA-256 sealing, `pi_report_seals`,
  `inspection_seal_anchors`, `anchor-inspection-seals` and
  `confirm-inspection-anchors` Edge Functions, OpenTimestamps/Bitcoin anchoring,
  AI model SHA binding (`qa:model-shas`)
- **Local AI**: TFLite on-device inference (`react-native-fast-tflite`), welding
  and coating models, a full `/admin/ai-platform` console (17 routes: datasets,
  training, deployments, golden sets, hard examples, drift monitoring, storage,
  audit)
- **Offline field execution**: `src/core/offline/{outbox,operations}.ts`, sync
  queue, idempotent replay — and the compliance capture flow is already wired
  through it
- **NCR / Flash Reports**: complete state machine
  `open → acknowledged → in_remediation → resolved → closed → disputed`,
  attachments, correlation ids
- **Structured inspection (compliance path)**: `inspection_scope_templates` →
  `inspection_evidence_requirements` (ordered, typed, required, min/max,
  `constraints_json`) → `inspection_captures` → sealing

---

## Findings acted on this phase

### 1. Admin report review — dormant since the baseline ⚠️ → fixed
`inspection_reports` has carried `technical_approved` / `financial_approved`
(each with a `*_by` FK to `auth.users`) since baseline:23087.
`submitReport.ts` states outright that it *never* sets them;
`inspectorReport.ts` reads and **displays** all six. **Nothing wrote them.**
Inspectors were shown an approval state that could never become true.

Fixed in `20260801364000` + `/admin/reports`. Publishing remains the client's
decision; `financial_approved` authorises **no** payment.

### 2. Seven admin pages were unreachable 🟠 → connected
`budget`, `communications/direct`, `communications/operational`, `diagnostics`,
`invoices`, `tax-center`, `vault` — all built and working, none linked from the
sidebar. Now linked, and `qa:admin-routes` prevents recurrence.

### 3. Failed inspection items went nowhere 🟡 → connected
Structured inspection and the NCR system both existed; nothing joined them.
`20260801366000` bridges them by **delegating** to the existing
`flash_report_create` — no second NCR system.

### 4. Credential expiry targeted the wrong table ⚠️ → fixed
A whole expiry subsystem existed against `contractor_certifications` (1 app
file) while the canonical table is `certifications` (7 app files) — and its
status filter looked for `'active'` while the column defaults to `'valid'`, so
it could never have expired anything. Both systems preserved; the legacy one
repaired; the live one built on the canonical table (`20260801362000`).

---

## Genuinely missing, verified by manual inspection

- **Multi-inspector jobs** 🔴 — **zero** database evidence. No `lead_inspector`,
  `co_inspector`, `job_inspectors` or `inspection_team` object exists. (The
  reconciliation script initially reported this WIRED; that was a false positive
  from a loose regex, corrected on inspection.) A job carries exactly one
  `contractor_id`. Adding this must be **additive** so single-inspector jobs,
  contracts, payout and identity behaviour are unaffected.
- **ITP hold / witness / review / surveillance points** 🔴 — the only matches are
  prose inside document templates and seed data, not a structured stage model.
  `inspection_evidence_requirements` is the natural place to extend, since it
  already carries ordering and `constraints_json`.
- **QCP** 🔴 — no evidence anywhere. Low value relative to ITP; defer.

## Partial — worth completing next

- **`inspection_items` is nearly dormant** 🟡 — read by exactly one screen
  (`app/inspector/seal-report.tsx`). It is now NCR-connected, but no execution
  UI creates items. The compliance capture flow is the mature path; these two
  structured-inspection shapes should converge, preserving both.
- **Structured inspection is compliance-only** 🟡 — the constraint
  `jobs_compliance_requires_template` forces `scope_template_id` NULL for
  `quality` jobs, so quality jobs get no structured execution.
- **Enterprise / project / supplier analytics** 🟠 — dashboards exist; scoped
  aggregate RPCs are thin.
- **Report template branding is backend-rich, UI-thin** 🟠 — `header_template`,
  `footer_template`, `template_spec` and org/client scoping all exist; template
  selection surfaces are limited.

---

## AI — end-to-end verification (not inferred from routes)

The trained NEXPEC AI is real, intact, and reachable on **both** surfaces.
Verified against the model bytes, not against the presence of an admin console.

**Weights on disk — 93 MB, in two locations, byte-identical:**

| model | task | classes | size |
|---|---|---|---|
| `corrosion_yolo26s_seg_1024_fp32.tflite` | instance segmentation | 11 | 41 MB |
| `wda_fissures_yolo26s_seg_1024_fp32.tflite` | instance segmentation | 5 | 41 MB |
| `yolov9t_2class_fp32.tflite` | detection | 2 | 8.1 MB |
| `mobilenet_v2.tflite` | classification | — | 3.5 MB |

Metadata sidecars name them *"NEXPEC Corrosion YOLO26s Segmentation"* and
*"NEXPEC WDA Weld-Defect YOLO26s Segmentation (RAW head)"*, each recording its
`source_checkpoint` under `nexpec_ai/…/weights/best.pt`, `ultralytics_version`
8.4.95, export timestamp and `tflite_sha256`.

- **Registry / AI Core — already exists.**
  `@nexpec/shared-core/ml/modelRegistry` is the single source of truth shared by
  web and mobile. Each entry carries slug, semver, SHA-256, labels and an
  `outputParser` (`yolo-seg` / `yolo-seg-e2e` / `yolo-det`) describing exactly
  how to decode that model's tensors. **This is already the pluggable
  "NEXPEC AI Core"** — a new model is a registry entry plus a file, not an
  application rewrite. Nothing needs generalising.
- **Registered slugs:** `corrosion-detector` v2.0.0 (Corrosion / rust),
  `wda-fissure-detector` v1.0.0 (Welding / WDA defects),
  `yolov9t-weld-detector` v1.0.0 (**Coating pinhole / inclusion**).
- **Mobile:** `src/core/ml/vision/{segModelManager,tfliteVision,preprocess,SegOverlay}.ts`,
  runtime `react-native-fast-tflite`, weights bundled via `require()` → fully
  offline. Callers: `app/ai-coinspector.tsx`,
  `app/(inspector)/compliance/job/[id]/capture.tsx`.
- **Web:** `apps/web/src/lib/ai/visionModel.ts` runs the **same** `.tflite`
  in-browser on TFLite WASM. Weights served from `apps/web/public/models/`
  (89 MB present), WASM from `public/tf`. Caller:
  `/inspector/ai-coinspector`, linked from the inspector sidebar.
- **Integrity:** `npm run qa:model-shas` → *3 models × 2 locations verified
  against the shared registry*. Web additionally re-verifies SHA-256 at load and
  throws `MODEL_SHA_MISMATCH` before handing bytes to the runtime.
- **Tests — actually executed:** `npm run qa:ml-tests` → **43 assertions, 5
  suites, 0 failures** (decode, coordinate handling, clustering, refinement,
  finding validation, canonical attestation). Proven non-vacuous by fault
  injection.
- **Paid API dependency: NONE.** All inference is local/on-device. The only
  hits for hosted-AI vendor names were false positives — `statusBadgeMini`
  contains the substring "geMini". No hosted-AI package in any `package.json`.

**Verdict: ✅ COMPLETE on mobile and web. Do not rebuild, do not replace.**
The one honest caveat is licensing, not function: the weights were exported with
Ultralytics 8.4.95, which is **AGPL-3.0**. That is a pre-existing decision on
your own trained models and nothing here changes it — flagged only so it is a
deliberate choice rather than an accident.

---

## Payment — frozen, observed only

Two defects recorded, **not** acted on, pending explicit direction:

1. **`stripe_complete_job` does not exist** in `supabase/migrations/`. The
   webhook calls it (`stripe-payments-webhook/index.ts:401`); the only copy is
   an unapplied orphan at the repo root. Card payments would 500 and retry.
2. **Inverted prepay ordering** — `payment_mode='prepay'` credits the
   inspector's withdrawable balance at `admin_confirmed_at`, while
   `create-payment-intent` blocks payment until that same timestamp.
   Separately, `create-wallet-deposit-intent` charges buyers but credits
   `inspector_earnings`.

Both need architectural decisions inside the frozen domain.

---

## Final matrix

✅ **COMPLETE — leave alone**

| capability | evidence |
|---|---|
| Welding AI (WDA) | 41 MB trained seg model, registry slug `wda-fissure-detector`, SHA-verified, mobile + web |
| Coating AI | `yolov9t-weld-detector` = "Coating pinhole / inclusion", 2-class detector, both surfaces |
| Corrosion AI | `corrosion-detector` v2.0.0, 11 classes, both surfaces |
| AI Core / registry | `shared-core/ml/modelRegistry` with per-model `outputParser` — already pluggable |
| Local/offline inference | fast-tflite (mobile, bundled) + TFLite WASM (web, same files) |
| AI tests | 43 assertions executed, 0 failures |
| Cryptographic sealing | SHA-256, `pi_report_seals`, chain-of-custody, seal screens |
| Blockchain / OpenTimestamps / Bitcoin anchoring | `inspection_seal_anchors` + `anchor-inspection-seals` / `confirm-inspection-anchors` Edge Functions |
| NCR / Flash Reports | full state machine, attachments, correlation ids |
| Supplier / RFQ / quotes / deals | 29 db / 68 mobile / 88 web files |
| Offline field execution | outbox, sync queue, idempotent replay; compliance capture already offline |
| Scheduling / availability / conflict detection | 20 db / 79 mobile / 56 web |
| Enterprise orgs / departments / invitations | `organizations`, `org_members`, `departments`, `org_invitations`, `/admin/orgs/[id]/structure` |
| Report templates + branding | `report_templates` with client/org scope, header/footer, `template_spec`, versioning, locking |
| PDF generation, revisions, client approval + delivery | working end to end |
| Structured inspection (compliance path) | scope template → evidence requirements → captures → seal |
| Admin report review | activated `20260801364000` + `/admin/reports` |
| Credential expiry | activated `20260801362000` |
| Smart matching / targeted notifications | `20260801358000` / `20260801360000` |

🟡 **PARTIAL — finish**

| capability | what is missing |
|---|---|
| `inspection_items` execution UI | table + NCR bridge exist; no screen creates items (one screen reads them) |
| Structured inspection for `quality` jobs | `jobs_compliance_requires_template` restricts it to compliance jobs |
| Projects | `projects` + `project_documents` exist; job/supplier linkage is thin |
| Report template selection UI | backend is rich (org/client scope, header/footer); selection surfaces are limited |
| Enterprise / project / supplier analytics | dashboards exist; scoped aggregate RPCs are thin |
| Web/mobile/admin parity | broadly consistent; report review is now web-only (mobile pending) |

🔴 **GENUINELY MISSING — build (verified absent, not just unfound)**

| capability | proof of absence |
|---|---|
| Multi-inspector jobs | no `lead_inspector` / `co_inspector` / `job_inspectors` / `inspection_team` object anywhere; a job has one `contractor_id` |
| Multi-visit / recurring inspections | no visit table of any kind |
| ITP hold / witness / review / surveillance points | only prose in document templates and seed data |
| Supplier scorecards | no scorecard / vendor-rating / performance table |
| Programs | no `programs` table (`projects` exists) |
| Enterprise SSO (SAML/OIDC/SCIM) | OAuth exists; no enterprise SSO |

⚪ **FUTURE / LOW PRIORITY** — QCP (no evidence; low value until ITP lands),
ERP connectors (keep integration-ready, build on demand).

---

## Addendum — the 42703 defect family (found via the Predictive Integrity report)

The reported "column d.job_id does not exist" was **one of nine**. Root cause of
the dispute pair: there are two dispute tables and two functions reach for the
wrong one. `public.disputes` is work-order scoped (`project_id` FKs to
`work_orders`, no `job_id`); `public.job_disputes` is job scoped. **Both are
preserved**; the two job-scoped functions were repointed.

**Fixed (`20260801368000`, `20260801370000`):**

| function | defect | reachable from |
|---|---|---|
| `inspector_integrity_analytics` | joined `disputes.job_id` | web `/admin/integrity` **and** mobile `app/(admin)/integrity.tsx` |
| `file_dispute` | inserted 5 columns that don't exist | live mobile disputes screens |
| `invite_inspector_to_job` | `audit_events.event_kind`/`payload` phantom + 3 NOT NULLs unsupplied | `app/inspector-directory.tsx:281` |

Each was repaired by reproducing the baseline body **byte-for-byte** and
substituting only the defective line(s) — no behaviour, weight, threshold or
authorization rule was altered.

**Still live, recorded in `scripts/qa/known-sql-schema-defects.json`:**
`accept_offer` and `create_organization` (non-payment, fixable, callers to be
traced first); `get_or_create_wallet`, `handle_job_cancellation`,
`handle_job_completion` ×2, `request_milestone_release`, `wallet_credit_topup`
(**frozen payment domain — reported, not fixed**).

`npm run qa:sql-schema` now scans the baseline too — the blind spot that let
these survive — with supersession awareness (21 findings correctly skipped as
dead code) and a known-defect register so it fails on anything **new**.

## Addendum — AI Platform: unpopulated, not disconnected

Confirmed: **24+ AI lifecycle tables exist** (`ai_dataset_versions`,
`ai_training_runs`, `ai_golden_datasets`, `ai_hard_examples`,
`ai_active_learning_scores`, `ai_monthly_snapshots`, `ai_export_history`,
`ai_model_deployment_history`, `ai_rollback_history`, `ai_storage_quotas`,
`ai_inference_statistics`, `ai_quality_statistics`, …), each with writers in the
migrations and web pages reading them.

**Dataset Versions = 0 and Training Runs = 0 mean the tables are UNPOPULATED,
not unwired.** Training happens externally — the model sidecars record
`source_checkpoint` paths under `nexpec_ai/…` and the Training page itself says
to *"record a run when you train a new model version externally; attach its
exported .tflite SHA."* So the zeros reflect a process not yet performed, not a
missing subsystem.

**Real gap (small, operational):** nothing back-fills a training-run or
dataset-version record from the metadata sidecars that already ship beside each
`.tflite` (`*_model_info.json` carries name, task, classes, input size,
`source_checkpoint`, `tflite_sha256`, `exported_at_utc`). Registering the three
existing models as historical training runs would populate the console from data
already on disk. Additive, no new dependency.
