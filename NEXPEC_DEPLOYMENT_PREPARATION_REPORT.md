# NEXPEC — Deployment Preparation Report (Pre‑Deploy / Release Checkpoint / Staging)

*Generated 2026‑07‑19. Read‑only audits + local verification + safe local commit + staging artifacts. No remote push, no `supabase db push`, no deploy, no credentials used. Values of secrets are never shown.*

## 1. Executive verdict — **PASS (staging‑ready)** with 2 WARNINGs

Locally verifiable release gates are green; no tracked secrets; migration is additive/non‑destructive; models verified. Two WARNINGs are environment‑bound, not code defects (production `next build` + live runtime need env/deploy).

## 2. Repository status
- Branch: `release/account-deletion-launch-readiness`. `git diff --check`: **clean**.
- 12 modified files (AI integration) + 17 untracked groups (reports, `ai-platform/`, `api/`, `services/`, `aiops/`, decoders, registry, scripts, migration, `public/models/`).
- No accidental edits to frozen modules (finance/jobs/marketplace/auth untouched); changes are confined to AI integration + AI‑Ops + AI Platform.

## 3. Secrets audit — **PASS**
- Tracked + untracked scan for service‑role/JWT/DB‑URL‑creds/tokens/passwords/private‑keys/provider‑keys: **no matches**.
- `.env`, `.env.local`, `.env.*.local`: **git‑ignored + untracked** (`.gitignore:32‑34`). `.env.local` exists locally (safe, ignored).
- No secret behind a `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix. Service‑role used server‑only.

## 4. Third‑party / paid AI dependency audit — **PASS (independent)**
- **No** OpenAI/Anthropic/Google/Azure/AWS‑Bedrock/HuggingFace/Cohere/Replicate dependency in any manifest or import.
- Core AI inference remains **local/offline TFLite** (mobile bundled via Metro; web via self‑hosted tfjs‑tflite WASM). Repo owns the models + decoders + registry. Supabase/Vercel are infra (usage‑metered), **not** AI providers.

## 5. Migration execution order (new work)
Latest three, chronological: `…276000_ai_detection_feedback` → `…278000_account_deletion_hardening` → **`20260801280000_ai_ops_foundation`**. The new migration orders **last**, deterministically.

**Contents of `20260801280000`:** 22 tables (dataset/versions/lifecycle, curation, training, snapshots, ops‑history, storage, statistics, immutable audit); 1 enum (`ai_image_lifecycle`, 9 states); 3 functions (`ai_ops_create_monthly_snapshot` SECURITY DEFINER + `SET search_path=public`; `ai_ops_guard_lifecycle`; `ai_ops_audit_immutable`); 2 triggers (lifecycle guard, audit immutability); RLS enabled on all 22 with literal `*_admin_all` overlays + own‑row read/insert for prediction/correction + self‑insert for audit; indexes on lifecycle/version/sha/model/priority/history; storage‑provider seed (1 default); self‑tests.

## 6. Destructive‑operation analysis — **PASS (additive, idempotent)**
- **No** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, unfiltered `DELETE`, `ALTER … TYPE`, or RLS‑disable.
- `ON DELETE CASCADE` appears only on **FKs of the new child tables** (referential cleanup of new data — safe).
- `DROP … IF EXISTS` only on the migration's **own** policies/triggers before recreating them (idempotent).
- One self‑test `DELETE … WHERE … AND false` = matches zero rows (no‑op).
- Rollback note: additive; to undo, drop the `ai_*` objects (no data‑loss to existing schema). Single‑run‑safe **and** re‑runnable (guards present).

## 7. `20260801280000` finding — **PASS (valid, no rename)**
Real filename. The repo's convention is `YYYYMMDD` + a 6‑digit **sequence** (not literal HH:MM:SS) — e.g. `…270000`, `…278000`. `280000` follows it and sorts after `278000`, so ordering is deterministic. **No rename required.** Not applied anywhere yet (staging pending).

## 8. Tests & exit codes (run this pass)
| Command | Exit | Result |
|---|---|---|
| `apps/web tsc --noEmit` | 0 | PASS |
| `packages/shared-core tsc` | 0 | PASS |
| `tsc -p tsconfig.ai.json` (mobile ML) | 0 | PASS |
| `next lint --dir …/ai-platform …` | 0 | PASS (0 warnings) |
| `npm run qa:db-refs` | 0 | PASS |
| `npm run qa:rls-admin` | 0 | PASS |
| `npm run qa:outbox` | 0 | PASS |
| `npm run qa:gr2` | 0 | PASS |
| `npm run qa:model-shas` | 0 | PASS |
| AI‑Ops engine unit tests | 0 | PASS (18/18) |
| Production `next build` | — | **BLOCKED** (see §16) |

## 9. Local commit
See §last — one local commit `feat: complete NEXPEC AI platform release candidate`. **Not pushed.**

## 10. Staging Supabase command sequence (RUN ON YOUR MACHINE)
> CLI not installed in this sandbox. Commands use the actually‑supported modern `supabase` CLI. Replace `YOUR_STAGING_PROJECT_REF`. **Never** run these against production.

```bash
# 0. repo root
cd /path/to/nexpec

# 1. CLI present  [READ-ONLY]
supabase --version

# 2. auth  [REQUIRES CREDENTIALS — interactive or SUPABASE_ACCESS_TOKEN]
supabase login

# 3. link to STAGING  [REQUIRES CREDENTIALS — will prompt for the DB password]
supabase link --project-ref YOUR_STAGING_PROJECT_REF

# 4. list local vs remote migrations  [READ-ONLY — shows divergence]
supabase migration list

# 5. preview the schema delta before applying  [READ-ONLY]
supabase db diff --linked --schema public | head -200

# 6. APPLY migrations to STAGING  [MODIFIES STAGING]
supabase db push

# 7. confirm history afterward  [READ-ONLY]
supabase migration list

# 8. structural verification  [READ-ONLY] — via SQL Editor or psql:
#    paste scripts/ops/verify-ai-ops-staging.sql into the STAGING SQL Editor.
```

## 11. Staging verification SQL
`scripts/ops/verify-ai-ops-staging.sql` — **read‑only**, grouped checks (tables/count, RLS, policies, indexes, FKs, functions, triggers, audit‑immutability, lifecycle enum, storage default, migration history, ml registry). Run in the STAGING SQL Editor or `psql "$STAGING_DB_URL" -f …`.

## 12. Model file / SHA verification — **PASS**
| Model | File (assets/, tracked) | Registry SHA (prefix) | Actual | Match |
|---|---|---|---|---|
| corrosion‑detector v2 | `corrosion_yolo26s_seg_1024_fp32.tflite` | `21c98fd8…` | recomputed | ✅ |
| wda‑fissure‑detector v1 | `wda_fissures_yolo26s_seg_1024_fp32.tflite` | `d0f086e0…` | recomputed | ✅ |
| yolov9t‑weld‑detector v1 | `yolov9t_2class_fp32.tflite` | `4da2665f…` | recomputed | ✅ |

`qa:model-shas` also confirms the `apps/web/public/models/` copies match. No file MISSING.

## 13. Model registration commands (RUN ON YOUR MACHINE — staging)
> Uses env vars (keeps the service key out of shell history/args). `--sign` needs `nexpec_model_signing.pem` present locally (git‑ignored). Omit `--sign` to register without a signature.

```bash
cd /path/to/nexpec
export SUPABASE_URL="https://YOUR_STAGING_PROJECT_REF.supabase.co"
read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY   # paste key (hidden), press enter
bash scripts/ml/register-nexpec-models.sh --sign     # registers all 3, independent, non-overwriting
unset SUPABASE_SERVICE_ROLE_KEY
```
Post‑registration **read‑only** check (SQL Editor):
```sql
select slug, version, sha256, status from ml_model_artifacts order by slug, version;
-- (or the registry table used by ml_resolve_models). Expect corrosion-detector v2,
-- wda-fissure-detector v1, yolov9t-weld-detector v1 with matching SHAs.
```

## 14. Environment checklist
`NEXPEC_STAGING_ENV_CHECKLIST.md` — names/scope/class/provenance for web, mobile, CLI. Verified: no secret behind a public prefix. One doc gap to add: `NEXT_PUBLIC_YOLOV9T_MODEL_URL` in `apps/web/.env.example`.

## 15. Completed automatically (this pass)
Read‑only repo/secrets/dependency/migration audits; TypeScript ×3 + lint + 5 QA guards + engine tests; SHA verification; **fix** of an unused `eslint-disable`; generated the verify SQL, env checklist, and this report; safe local commit (below).

## 16. Must be executed manually (BLOCKED locally — need env/creds)
- **Production `next build`** — needs full `NEXT_PUBLIC_*` + server env; exceeds sandbox time. Missing to supply: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VISION_MODEL_URL`, `NEXT_PUBLIC_WDA_MODEL_URL`, `NEXT_PUBLIC_YOLOV9T_MODEL_URL`.
- **Staging migrate** (§10), **register models** (§13), **live runtime smoke** — all need credentials/deploy.

## 17. Exact next steps (strict order)
1. `git push origin release/account-deletion-launch-readiness` *(you — remote push is out of scope for the sandbox)*.
2. `cd apps/web && npm run build` locally (or in CI) with staging env → confirm build PASS.
3. Staging DB: run §10 steps 1–8 → run `scripts/ops/verify-ai-ops-staging.sql`.
4. Register models: §13 → run the post‑registration SQL.
5. Set staging env from `NEXPEC_STAGING_ENV_CHECKLIST.md`; deploy web to a staging/preview URL.
6. Smoke as admin: `/admin/ai-platform` → each tab loads; create a snapshot; open a sample → review overlay + a lifecycle transition.

## 18. Final copy‑paste block (for you)
```bash
cd /path/to/nexpec
# A) build locally with staging env
( cd apps/web && npm run build )
# B) staging DB (replace REF; requires login + db password)
supabase --version && supabase login && supabase link --project-ref YOUR_STAGING_PROJECT_REF
supabase migration list && supabase db diff --linked --schema public | head -100
supabase db push && supabase migration list
# C) register models (paste key hidden)
export SUPABASE_URL="https://YOUR_STAGING_PROJECT_REF.supabase.co"; read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY
bash scripts/ml/register-nexpec-models.sh --sign; unset SUPABASE_SERVICE_ROLE_KEY
# D) then paste scripts/ops/verify-ai-ops-staging.sql into the STAGING SQL editor
```

*Every PASS is command‑backed. Everything needing credentials or a live environment is BLOCKED and delegated to you.*
