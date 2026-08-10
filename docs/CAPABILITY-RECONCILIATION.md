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
