# NEXPEC — AI Platform (Web Admin Module) Report

*Generated 2026‑07‑19. Web‑only. Built INSIDE the existing admin application — reusing its layout, sidebar manifest, admin auth gate, routing conventions, and ink/violet design tokens. No mobile code touched. No existing admin module rebuilt. Consumes the Phase‑1/1B backend (services + `/api/ai-ops/*`); the shipped inference stack (registry, decoders, SHA verify) remains untouched PASS code.*

---

## Module Status

| # | Module | Status | Notes |
|---|---|---|---|
| — | Navigation + module shell | **PASS** | New "AI Platform" item in the existing `Sidebar` manifest (Intelligence group); `ai-platform/layout.tsx` sub‑nav (14 tabs) inside the admin shell |
| 1 | Overview | **PASS** | `/api/ai-ops/overview` — models, lifecycle, queue/hard/golden, storage, latest snapshot/export/deployment + real actionable alerts; every card links to its page |
| 2 | Models (+ detail) | **PASS** | `/api/ai-ops/models` registry cards (always populated — code‑defined) + `models/[slug]` detail via `/api/ai-ops/versions/[slug]` (deployment + rollback history) |
| 3 | Dataset Manager | **PASS** | `AiTable` over `images` — server pagination/sort/search + lifecycle filter chips + deep‑links; preserves provenance semantics in copy |
| 4 | Sample Detail / Review | **NOT IMPLEMENTED** | Needs image + AI/corrected overlay rendering (reuse `SegEditorOverlay`) over real `ai_dataset_images` rows; documented as the primary next slice |
| 5 | Active Learning | **PASS** | `queue` ranked by real stored priority; shows the actual score components (uncertainty/disagreement/novelty/rarity) — no vague explanations |
| 6 | Hard Examples | **PASS** | `hard-examples` table grouped by model + failure reason |
| 7 | Golden Dataset | **PASS** | `golden` list with locked/unlocked state (new read resource added) |
| 8 | Dataset Health | **PASS** | Lifecycle distribution bars (real) + quality‑stats table; class‑level breakdowns render as data grows |
| 9 | Training Center | **PASS** | Candidate/version/run stats + `dataset-versions` & `training-runs` tables; honestly framed as prep (no fake trainer) |
| 10 | Deployments | **PASS** | `deployments` immutable history; rollback/activate framed as audited backend actions |
| 11 | Export Center | **PASS (read)** | `exports` history + honest "server run required" framing; **export wizard build action = NOT IMPLEMENTED** (needs a worker) |
| 12 | Monthly Snapshots | **PASS** | `snapshots` list **+ working "Create this month" mutation** (POST → `ai_ops_create_monthly_snapshot` RPC, confirm dialog, idempotent) |
| 13 | Storage Center | **PASS** | `/api/ai-ops/storage` provider cards with truthful connected/configured/unconfigured status; no secrets shown |
| 14 | Monitoring | **PASS** | `inference-stats` + `sync-stats` tables (real rollups) |
| 15 | Statistics & Comparison | **PASS** | Model picker → `statistics?view=compare` deployment/run lineage |
| 16 | Audit Log | **PASS** | `audit` table with an explicit append‑only badge; UI never implies editability |
| — | Authorization | **PASS** | Route group under admin layout (server redirect for non‑admins) **and** every API route calls `assertAdmin` (`nx_is_admin` RPC) → 403; not button‑hiding alone |
| — | Data integrity | **PASS** | No mock data anywhere; empty DB → honest empty states; the `not_provisioned` case renders a clear "run the migration" panel, not a crash |

**Honesty:** two write‑heavy pieces are marked NOT IMPLEMENTED rather than faked — the **Sample Review** drill‑down (needs image+overlay over real rows) and the **Export build** executor (needs a server/worker). Their backends exist; only the UI action + a POST route remain. Every visible page is backed by a real endpoint or an honest empty/blocked state.

---

## Verification actually run

- **Web `tsc --noEmit`** → **EXIT 0** (all 16 pages + kit + 7 routes + the snapshot mutation).
- **`qa:db-refs`** → clean (every new `.from()`/RPC in overview/storage/golden resolves to a migration).
- **`qa:rls-admin`** → clean (171 RLS tables, admin‑covered).
- **`qa:model-shas`** → clean (shipped inference stack untouched).
- **Production `next build`** → **BLOCKED** locally: a full build needs the `NEXT_PUBLIC_*` + Supabase env and exceeds the sandbox time cap; not honestly runnable here. `tsc` + guards are the local proof; run `next build` in CI.
- **Runtime (HTTP) tests** → **BLOCKED**: need the Phase‑1B migration applied to a live DB + a served instance. The pages are written to degrade to the honest "not provisioned" state until then.

## Routes added

Pages: `/admin/ai-platform` (Overview) + `models`(+`/[slug]`), `datasets`, `active-learning`, `hard-examples`, `golden`, `health`, `training`, `deployments`, `exports`, `storage`, `monitoring`, `statistics`, `snapshots`, `audit` + `layout.tsx`.
API: `/api/ai-ops/overview`, `/api/ai-ops/models`, `/api/ai-ops/storage`, `/api/ai-ops/snapshots/create` (POST) + the `golden` resource added to `/api/ai-ops/[resource]`.

## Components added

`components/admin/ai-platform/kit.tsx` — `useAiOps` hook, `AiTable` (server pagination/sort/search/filter/empty/loading/error), `StatCard`, `StatusBadge`, `Card`, `SectionHeader`, `EmptyState`, `ErrorState` (with provisioned‑vs‑error detection), `TableSkeleton`, and `nf/pct/dt/dOnly/short` formatters.

## Existing components / systems reused

Admin `layout.tsx` (auth gate + shell), `Sidebar` manifest, `cn`, `createSupabaseServerClient`, `AppDialog` (`confirmDialog`/`alertDialog` for the snapshot mutation), lucide‑react icons, and the ink/violet Tailwind tokens — no new theme, no duplicate shell.

## Files modified

`components/admin/Sidebar.tsx` (+`AI Platform` nav item + `BrainCircuit` import); `app/api/ai-ops/[resource]/route.ts` (+`golden` resource).

## Backend additions (minimal, documented)

`lib/services/aiops/overview.ts` (`aiOverview`, `aiModelsWithStats`) + 3 read routes + 1 mutation route + the `golden` read spec. No new tables, no duplicate services/models — all layered on Phase‑1B.

## Backend endpoints consumed

`/api/ai-ops/[resource]` (images, dataset‑versions, training‑runs, queue, hard‑examples, snapshots, exports, deployments, inference‑stats, quality‑stats, sync‑stats, audit, golden), `/api/ai-ops/statistics` (dataset‑lifecycle, compare, health), `/api/ai-ops/versions/[slug]`, `/api/ai-ops/overview`, `/api/ai-ops/models`, `/api/ai-ops/storage`, `POST /api/ai-ops/snapshots/create`.

## Authorization checks

Admin layout redirect (server) + `assertAdmin` on all 7 route handlers (read and write) → 403 for non‑admins; RLS is the ultimate gate. Mutations additionally re‑check inside the SECURITY DEFINER RPC.

## Known limitations

- Sample Review drill‑down + Export build executor are backend‑ready but UI‑pending (see NOT IMPLEMENTED).
- Charts are intentionally minimal (distribution bars, sparbars) — no charting lib added to avoid a decorative dependency; can be upgraded if desired.
- Bulk‑action toolbars (approve‑as‑candidate, add‑to‑golden) are described in copy but not wired as buttons yet — deferred with Sample Review since they act on real image rows.

## External actions required (BLOCKED locally)

1. **Apply the Phase‑1B migration** so the pages have tables to read: `supabase db push` (needs the service key). Until then every page shows the honest "AI‑Ops backend not provisioned yet" panel.
2. **Deploy** (Vercel) to runtime‑test the pages as an admin, then optionally run `next build` in CI to flip the build row to PASS.
