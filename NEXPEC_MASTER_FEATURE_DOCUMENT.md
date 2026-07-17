# NEXPEC — Master Feature Document

> **The complete capability reference for the NEXPEC platform.**
> Two‑sided industrial NDT / compliance‑inspection marketplace: a native mobile field app + a web operations dashboard, sharing one type‑safe core and one Postgres backend.
> Compiled July 2026 as the pre‑publish master reference. Grounded in the live codebase (272 mobile route files, 139 web pages, 6 web API routes, 147 RLS‑governed tables, 165 backend RPCs).

---

## 1. What NEXPEC Is

NEXPEC connects **clients** who need industrial inspection / non‑destructive‑testing (NDT) work (welds, corrosion, coatings, structural compliance) with **inspectors** and **inspection agencies** who perform it, plus **suppliers** who service the ecosystem — all under **admin/super‑admin** operational governance and optional **enterprise** org structures.

The platform is built around three hard product principles that show up everywhere in the code:

1. **Offline‑first field reality.** Inspectors work on oil rigs, refineries, and remote sites with no connectivity. Every field write goes through a durable local **outbox** and syncs later. AI runs **on‑device**, fully offline.
2. **Marketplace integrity / anti‑poaching.** The platform sits between client and inspector. Inspector identity and payout/margin economics are **structurally hidden** from client surfaces until an admin explicitly forwards a proposal — enforced in the database and re‑checked by a CI guard.
3. **Provable AI.** Every AI finding is cryptographically bound to a signed, versioned model artifact; a separate human‑in‑the‑loop channel harvests corrections for retraining without ever polluting the provable record.

---

## 2. Architecture at a Glance

| Layer | Stack | Location |
|---|---|---|
| **Mobile app** | Expo / React Native, expo‑router (file‑based routing), Reanimated + Gesture Handler, Skia, react‑native‑fast‑tflite, react‑native‑svg | `app/` (routes) + `src/` (core logic, UI) |
| **Web dashboard** | Next.js App Router, React Server/Client components, Tailwind, TensorFlow.js + tfjs‑tflite (self‑hosted WASM) | `apps/web/` |
| **Shared core** | Framework‑agnostic TypeScript: ML decoder, AI‑assist contracts, domain types | `packages/shared-core/` (consumed as source → zero‑rebuild parity) |
| **Backend** | Supabase / Postgres: RLS, SECURITY DEFINER RPCs, triggers, Edge Functions | `supabase/migrations/` |
| **Quality gates** | Custom CI guards (DB‑ref integrity, outbox routing, RLS‑admin coverage, price‑blindness) + scoped `tsc` projects | `scripts/qa/` |

**Parity guarantee:** the web app imports `@nexpec/shared-core` directly from source, so the mobile and web apps run the *same* ML decoder and the *same* AI‑assist contract code — there is physically only one implementation to keep in sync.

---

## 3. Roles & Access Model

NEXPEC is deeply role‑aware. Routing, dashboards, data visibility, and RLS all branch on role:

| Role | What they do |
|---|---|
| **Client** | Post jobs, fund/approve work, review reports, rate inspectors, manage budgets/invoices, run teams & org structure |
| **Inspector** | Discover & apply to jobs, negotiate, capture evidence (with on‑device AI), submit sealed reports, manage wallet/earnings/tax |
| **Agency** | Multi‑inspector organizations posting and managing jobs on behalf of a team |
| **Supplier** | Bid on opportunities, manage contracts/documents/finance, onboarding |
| **Enterprise** | Large‑org dashboards and structured team missions |
| **Admin / Super‑admin** | Job moderation, dispatch, approvals, payouts, disputes, verification, org management, live radar, integrity tooling |
| **Senior** | Senior‑inspector coordination surfaces (inbox/profile) |

Access is enforced in three concentric rings: **route guards** (expo‑router groups / Next middleware) → **role‑scoped data layers** → **Postgres RLS** (147 governed tables; a CI guard proves every one grants admin access or is explicitly allow‑listed).

---

## 4. Cross‑Cutting Architectural Wins

### 4.1 Offline‑First Sync (the field backbone)
- Durable **outbox** (`src/core/offline/`) with typed enqueue operations, network detection, and background sync.
- Field writes never block on connectivity; they queue locally and reconcile on reconnect.
- A CI guard (`qa:outbox`) scans **689 field‑screen files** and proves **all 209 mutating writes** route through the outbox (227 grandfathered, zero new bypasses). Direct DB writes from field screens are structurally prevented.
- Legacy import paths (`@/lib/offline`) are transparent re‑export stubs of the canonical `@/src/core/offline` — one implementation, backward‑compatible call sites.

### 4.2 Role‑Based Access + RLS
- 147 RLS‑governed tables; 140 carry explicit policies; admin coverage proven by `qa:rls-admin`.
- Data layers are role‑scoped so a client query can never select inspector‑private columns.

### 4.3 Database Contract Integrity
- The frontends talk to Postgres almost entirely through **RPCs** (SECURITY DEFINER functions with in‑function authorization), not ad‑hoc table writes.
- `qa:db-refs` proves **165 RPCs + 132 relations** referenced anywhere in web/mobile are all defined in migrations (or allow‑listed) — no “function does not exist” surprises at runtime.

### 4.4 Anti‑Poaching / Price‑Blindness
- **Identity redaction:** inspector identity is anonymized in the client‑facing audit trail and proposal surfaces.
- **Forward‑to‑Client gating:** client proposals are hidden until an admin explicitly forwards them (DB‑enforced + frontend‑gated).
- **Price‑blindness:** a CI guard (`qa:gr2`) scans **51 buyer‑surface files** and forbids selecting inspector‑payout / margin columns on any client‑visible surface.

### 4.5 Notifications
- Server‑side **deduplication** (no more double “Job approved” alerts) and structured **tap payloads** so every notification routes to a real destination (no dead taps).
- In‑app notification centers per role plus push.

### 4.6 Payments (Stripe Connect, Stripe‑held escrow)
- Stripe Connect (Express) onboarding for inspectors/suppliers/agencies; client funds each Job upfront; invoicing flows.
- The legal framework (`ESCROW-001` Payment & Escrow Rider, in `src/legal/`) defines **Stripe‑held escrow** across three compensation models (fixed / milestone / recurring), a **7‑day client acceptance window** with **Day‑3 / Day‑5 reminders** and **Day‑7 auto‑release**, plus admin payout / pending‑payout / treasury oversight surfaces. Stripe is the licensed money‑handler; **NEXPEC is explicitly not a bank, MSB, or remitter.** A flat **10% Platform Facilitation & Technology (PFT) Fee** is withheld at source.
- ⚠️ **Terminology reconciliation needed:** the code and legal documents use *escrow* throughout (402 references), whereas the earlier investor matrix deliberately avoided the term ("manual payouts"). Reconcile with counsel before external materials ship — see the audit report's Business‑Consistency finding. This document follows **code as source of truth**.

### 4.7 Legal / Compliance Gateway
- Terms & Privacy acceptance gateway with dedicated document list + detail screens; consent is sourced from an authoritative record and gates entry.

### 4.8 Provable AI + the HITL Data Flywheel
The AI story has **two independent channels** (see §7 for full depth):
- **Provable findings** — `ai_detections` + `pi_record_ai_detection`: each accepted finding is bound to a **published, signed, SHA‑pinned** model version. Tamper‑evident.
- **Training corrections** — `ai_detection_feedback` + `pi_record_ai_feedback`: human edits (including corrected polygon geometry) are harvested for the next training cycle **without** touching the provable record. Reuses the outbox on mobile; direct RPC on web.

---

## 5. Mobile App — Feature Inventory

Native Expo app, file‑routed under `app/`. Grouped by role. (Route groups in `(parens)` don’t add URL segments — they organize by audience.)

### 5.1 Auth & Onboarding — `app/(auth)/`
- Sign‑in, sign‑up, OAuth callback, reset‑password.
- **Role selection** (`choose-role`) including Enterprise + Supplier.
- **MFA challenge** screen with an escape‑hatch label.
- “Use web portal” hand‑off for desktop‑best flows.

### 5.2 Client — `app/(client)/`
- **Home / explore / network** — discover inspectors and work.
- **Job creation** — `create-job`, `create`, plus compliance job posting.
- **Approvals** (`approve`) — the approve → auto‑publish workflow (structurally, an approved job opens to the marketplace “once and for all,” all accounts).
- **Jobs** — job detail, **applicants/applications**, **review‑report**, **rate‑inspector / rate**.
- **Finance suite** — budget, **budget envelopes**, **budget policies**, invoices (+ detail), compliance (+ detail), reports.
- **Projects & teams** — project detail, team, team‑missions, structure, branding‑settings.
- **Mission chat**, **vault** (secure document store), disputes.

### 5.3 Inspector — `app/(inspector)/`
- **Dashboard / super‑dashboard**, assignments, calendar, negotiations, notifications.
- **Job flow** — apply, contract, expenses, index, **submit‑report**.
- **Field capture** — `compliance/job/[id]/capture.tsx`: camera capture with **on‑device dual‑model AI segmentation** and the **gesture‑driven polygon editor** overlaid invisibly on the preview (see §7.4).
- **Wallet** — cert‑wallet, statement, **withdraw**, wallet index.
- **Earnings / tax‑center**, disputes, **CCI application** (competency/credential intake).
- **Legal / verification** screens, profile verification.

### 5.4 Admin & Super‑admin — `app/(admin)/`, `app/(super-admin)/`
- **Dashboards, live‑radar, diagnostics, integrity.**
- **Job moderation, pending‑assignments, pending‑hires, jobs.**
- **Financial console** — active‑jobs, clients, inspectors, **pending‑payouts**, pipeline, payouts.
- **Governance** — users, org‑management, verification, reviews‑moderation, disputes.
- **Compliance templates**, inspection‑domains, CCI applications, audit‑trail, vault.
- **Communications** — admin inbox, support inbox, support chat, contracts.

### 5.5 Agency — `app/(agency)/`
- Create‑job and manage jobs (`jobs/[id]`) on behalf of a multi‑inspector organization; agency job‑details surface.

### 5.6 Supplier — `app/suppliers/`
- Opportunities, **bids**, contracts (+ detail), documents, finance, **onboarding**.

### 5.7 Enterprise & Senior
- Enterprise dashboard (in the tabs shell); Senior coordination — inbox & profile (`app/(senior)/`).

### 5.8 Shared field surfaces
- **Messaging** (`messages/`, `chat/[job_id]`, `inbox/`), **notifications** + settings.
- **Contracts** — editor modal, **signature pad**, agreement signing, job contracts, create/view.
- **RFQs** — list, new, detail. **Agreements / deals** signing.
- **Reports** — flash‑reports (list/new/detail), submit‑findings, seal‑report, submit‑report (+ enhanced).
- **Profile** — certifications, skills, experience, rates, payments, security, language, legal (+ compliance‑notices), terms, documents.
- **Tools** hub (`tools/`), certificate viewer (`cert/[slug]`), verification (`verify/[token]`), payment screen, maps (`browse-jobs-map`, `map`), PDF viewer.

> **Housekeeping note for publish (see §10):** the mobile tree still contains developer/diagnostic screens — `debug.tsx`, `supabase-test.tsx`, `diagnostics.tsx`, `ml-pipeline-check.tsx`, `ml-vision-check.tsx`, `job-details-example.tsx`. These should be gated out of (or confirmed unreachable in) the production build.

---

## 6. Web Dashboard — Feature Inventory

Next.js App Router under `apps/web/src/app/` — **139 pages, 6 API routes**. Grouped by area.

### 6.1 Public / Marketing / Marketplace
- Landing (`page.tsx`), **discover**, inspector directory (`inspectors/`, `(marketplace)/directory/`), public profiles (`p/[userId]`, `talent/[handle]`, `agency/[handle]`).
- **Public inspection pages** (`inspections/[slug]`), **seal passport** (`passport/[sealId]`), **verify**.
- **Syndication feeds** — `feed.json`, `feed.xml` (RSS), inspector calendar `feed.ics` (real API routes).
- **RFQ marketplace** — list, new, detail. **Deal signing** (`(marketplace)/deals/[id]/sign`).

### 6.2 Auth — `apps/web/src/app/(auth)/`
- Sign‑in, sign‑up, forgot/reset password; OAuth `auth/callback` route; **coordination bridge** token entry (`bridge/[token]`).

### 6.3 Client Dashboard — `client/`
- Dashboard, **jobs** (list, detail, **applications**, chat, internal thread, **release**, review, new).
- **Approvals**, **finance** (+ invoice PDF route `finance/invoice/[jobId]`), invoices (+ detail), **budget** (envelopes, policies), compliance, reports, documents, disputes.
- **Contracts** (job contracts), **vault**, **team / team‑missions / structure**, branding‑settings, messages, settings.

### 6.4 Inspector Dashboard — `inspector/`
- Dashboard, assignments, **calendar** (+ ICS feed), negotiations, jobs (apply, detail, review, **submit‑report**, flash‑reports).
- **AI Co‑inspector** (`inspector/ai-coinspector/page.tsx`) — the browser‑side twin of the field AI (see §7).
- **Contracts** (job + agreement), coordination‑bridge, compliance, experience, **wallet** (+ statement period route), **tax‑center**, **tools** hub, messages, settings, disputes.

### 6.5 Admin Console — `admin/`
- Dashboard, **dispatch**, **jobs** (+ detail, flash‑reports), **job/marketplace moderation**, **disputes**, **reviews**.
- **Financials** — invoices (+ detail), **payouts**, **supplier‑payouts**, **treasury**, budget, tax‑center.
- **Governance** — users (+ detail, specialties‑bulk), **orgs** (+ structure), **domains** (+ readiness), **compliance templates** (list/new/detail), **integrity** (+ internal threads), **audit**, **diagnostics**, documents, vault, settings.
- **Contracts**, **messages**, **RFQs**.

### 6.6 Suppliers — `suppliers/`
- Dashboard, **opportunities** (+ detail), **bids**, contracts (+ detail, agreement), documents, finance, messages, **onboard**, profile, support, settings.

### 6.7 Legal & Contact
- `legal/terms`, `legal/privacy`, `legal/compliance-notices` (dedicated legal layout).
- **Contact** form with server‑side **Resend** email dispatch (hardened; cards scroll to the form rather than raw `mailto:`).

---

## 7. The AI / ML Pipeline (in depth)

This is NEXPEC’s technical crown jewel: a **fully offline, on‑device instance‑segmentation engine** with a **human‑in‑the‑loop retraining flywheel**, identical across mobile and web.

### 7.1 Dual YOLO26‑seg Engine (mobile) — `src/core/ml/vision/segModelManager.ts`
- Two custom‑trained 1024² fp32 segmentation models (**Weld** / **Corrosion**), **bundled** into the app via Metro (`assetExts` includes `tflite`) → zero network, works on a dead‑zone rig.
- **Single‑resident slot:** the two ~40 MB models never sit in RAM together. Acquiring one evicts the other.
- **Race‑safe lifecycle:** toggles are serialized on a promise chain and guarded by a monotonic **generation token** — a slow load that resolves after the inspector switched modes is discarded (last‑write‑wins → no OOM, no stale result).
- Inference runs native/async via `react-native-fast-tflite`; the heavy decode is deferred with `InteractionManager.runAfterInteractions` so it never blocks the capture→preview transition.

### 7.2 The Shared Pure‑TS Decoder — `packages/shared-core/src/ml/segDecode.ts`
- Zero‑dependency TypeScript, so it is both **unit‑testable** and **workletizable**, and it is the **single source of truth** for web + mobile.
- Pipeline: confidence filter → **per‑class NMS** → box‑cropped **mask matmul** (coeffs · prototypes) → numerically‑stable sigmoid → **Moore‑neighbor contour trace** → ring simplification → **normalized polygon** + normalized xyxy box.
- **`inferSegLayout(out0Len, out1Len)`** — self‑configures the entire tensor contract (input size, anchor count, vector length, **class count**, channels‑first order) from just the two output tensor lengths. This future‑proofs the pipeline against dataset/label drift and YOLO export quirks: when the corrosion export shipped as `(1, 47, 21504)` channels‑first with **11 classes** instead of the planned 2, the decoder adapted with zero code changes. Verified by synthetic tests for both 11‑class and 2‑class shapes.

### 7.3 Web Inference — `apps/web/src/lib/ai/visionModel.ts`
- Runs the **same `.tflite`** in‑browser via self‑hosted TensorFlow.js + tfjs‑tflite WASM (no external CDN; enterprise‑CSP‑friendly).
- Transposes to NCHW (tfjs is NHWC‑native), disambiguates the two outputs **by length**, and hands them to the *same* `decodeYoloSeg` + `inferSegLayout`. The `segment()` path returns `[]` for classifier models, so it’s a safe no‑op until a seg model is registered.

### 7.4 The Gesture‑Driven Polygon Editor (the signature micro‑UX)
> **“The polygon *is* the toolbar.”** Zero new UI, zero layout change — every editing affordance lives on the SVG mask itself.

- **Mobile** (`src/core/ml/vision/SegOverlay.tsx`): `Gesture.Exclusive(longPress, pan, tap)`.
  - **Tap** a polygon → select (vertex handles appear, stroke thickens).
  - **Drag** a vertex → adjust the mask (marks it user‑corrected).
  - **Long‑press** a polygon → delete a hallucination (records a hard‑negative).
  - Contain‑fit math maps normalized geometry onto the displayed image; editing is enabled only when a job + mode are in context.
- **Web** (`apps/web/src/components/inspector/SegEditorOverlay.tsx`): DOM‑SVG twin.
  - **Click** to select, **drag** a `<circle>` handle (pointer capture) to adjust, **Delete/Backspace** to remove.
  - `object-fit`‑aware (contain **and** cover) so polygons land pixel‑accurate on the cover‑cropped thumbnails; overlay is `pointer-events:none` when there are no detections so it never blocks existing buttons.
- Brand lock preserved throughout: background `#020420`, primary `#7C3AED`, AI accent amber `#FBBF24`.

### 7.5 The HITL Data Flywheel (end to end)
1. Inspector (mobile) or reviewer (web) corrects/deletes a polygon.
2. The correction is packaged as an `AiAssist` + a `raw` JSONB payload carrying the **geometry**: `is_user_corrected`, `source:'user'`, `class_id`, `ai_box`, `ai_polygon`, `corrected_box`, `corrected_polygon` (null = deleted), a stable `det_key`, and `mode`.
3. **Mobile** enqueues it through the offline outbox (`enqueueAiFeedback`); **web** calls `recordSegFeedback` directly.
4. Both land in `pi_record_ai_feedback` (SECURITY DEFINER, idempotent on `client_op_id`, authorized to the job’s contractor or an admin) → `ai_detection_feedback`.
5. Six months of corrections are harvestable via `raw->>'is_user_corrected'='true'` to retrain — **the product gets smarter from real inspector signal**, and the integer `class_id` in `raw` lets the next cycle consolidate the messy raw‑COCO corrosion labels into a clean taxonomy.
6. No database migration was needed to ship this — geometry rides inside the existing JSONB, and verdicts stay within the existing three (`accepted | false_positive | reclassified`).

### 7.6 Provable Findings (the parallel channel)
- When a suggestion is **accepted** as a real finding, `pi_record_ai_detection` binds it to the model’s **published + signed + SHA‑pinned** identity (`ml_resolve_models` resolves the live registry). The provable seal (`ai_detections`) is kept pure — training corrections never touch it.

---

## 8. Backend & Data Contracts

- **RPC‑first design:** ~165 RPCs encapsulate business logic and authorization server‑side (job approve→publish, proposal Forward‑to‑Client gating, notification dedup, AI record/feedback, contracts V3, payouts).
- **Job contracts V3** (`job_contracts`) is the current contract data model the web app is wired to.
- **Idempotency:** mutation RPCs take a `client_op_id` so retried offline‑outbox writes never double‑apply.
- **Triggers & invariants:** an approved job auto‑opens to the marketplace structurally (not via app code), so the state is consistent across client/inspector/admin views and all accounts.

---

## 9. Quality Gates (what proves it stays correct)

| Gate | What it proves | Latest result |
|---|---|---|
| `tsc` — shared‑core | ML decoder + contracts type‑clean | ✅ EXIT 0 |
| `tsc` — web workspace | Entire Next.js app type‑clean | ✅ EXIT 0 |
| `tsc` — mobile ML scope (`tsconfig.ai.json`) | Vision engine + overlays type‑clean | ✅ EXIT 0 |
| `qa:db-refs` | 165 RPCs + 132 relations all defined in migrations | ✅ clean |
| `qa:outbox` | 209 field writes all routed through the outbox, no bypass | ✅ clean |
| `qa:rls-admin` | Every RLS table admin‑covered or allow‑listed (147 tables) | ✅ clean |
| `qa:gr2` | No inspector‑payout/margin columns on 51 buyer surfaces | ✅ clean |
| Seg decoder synthetic test | Channels‑first + `inferSegLayout` correct for 11‑ and 2‑class | ✅ pass |

---

## 10. Pre‑Publish Status

**Everything touched this cycle is green and in sync.** Types, DB contracts, ML parity, offline routing, and marketplace‑integrity invariants are all proven by the gates above. The mobile and web apps run one shared ML decoder and one shared AI‑assist contract, so the two clients cannot silently drift.

**Two honest caveats before you hit publish:**
1. **Full mobile `tsc`** (all 272 route files at once) exceeds the sandbox’s time budget here — it is designed to run in your **EAS production build**. Every file changed this cycle is covered by a green scoped check, and the app‑wide QA guards scan hundreds of files, so this is a coverage‑of‑environment note, not a known failure.
2. **Developer/diagnostic mobile screens** (`debug`, `supabase-test`, `diagnostics`, `ml-pipeline-check`, `ml-vision-check`, `job-details-example`) still exist in the tree. Confirm they’re unreachable in production or strip them from the build.

Neither is a blocker to the systems we built — they’re the last two items on a pre‑flight checklist.

---

*This document is a living reference — regenerate it whenever a new role, route family, RPC surface, or model is added.*
