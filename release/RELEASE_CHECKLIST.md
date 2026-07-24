# NEXPEC — Release Checklist

**Release:** Identity Disclosure + Inspector Replacement (+ audit own‑read fix, WDA AI decoders)
**Migrations in scope:** `20260801282000`, `20260801284000`, `20260801286000`, `20260801288000`, `20260801290000`
**Owner:** ______  **Date:** ______

> Rule: do **each** phase in order. Do not start a phase until the previous phase's gate is checked. If any step fails, go to `ROLLBACK_CHECKLIST.md`. Never `db push` to Production before Development QA passes. Always confirm the linked project ref before every push.

---

## Phase 0 — Preconditions (gate: all green)
- [ ] Working tree committed on the intended release branch (not `backup/pre-supabase-sync`).
- [ ] Last local validation green: `./scripts/qa/validate-identity-replacement.sh` → **ALL LOCAL VALIDATION PASSED** (174 db tests, 114 unit tests, typecheck, lint, QA guards).
- [ ] Rollback file present: `supabase/rollback/rollback_identity_replacement.sql`.
- [ ] `DEV_REF` and `PROD_REF` recorded (from `supabase projects list`) and confirmed distinct.

## Phase 1 — Local Manual QA (gate: no open FAILs)
- [ ] Start local: `npm run qa:local` → open the printed `http://localhost:3000`.
- [ ] Execute `MANUAL_QA_CHECKLIST.html` (or `.md`) end‑to‑end.
- [ ] Every case PASS or explicitly N/A; **zero open FAIL**. Export the results JSON and attach to the deployment log.

## Phase 2 — Development backup (gate: backup verified)
- [ ] `supabase link --project-ref <DEV_REF>` (confirm the ref echoed is DEV).
- [ ] Dashboard → Database → **Backups** → on‑demand snapshot **or** confirm PITR is on. Record snapshot id/time.
- [ ] (Optional CLI copy) `supabase db dump --linked -f backups/dev_$(date +%Y%m%d_%H%M)_schema.sql` and `--data-only` for data.
- [ ] Backup timestamp logged.

## Phase 3 — Development deployment (gate: migrations applied, types current)
- [ ] Confirm linked ref = `DEV_REF`.
- [ ] `supabase db push` — applies 282000→290000.
- [ ] `supabase gen types typescript --linked > src/types/database.types.ts` (commit if changed).
- [ ] If the deploy role lacks `pg_cron` privilege, schedule `nx_identity_replacement_reminders` manually (dashboard) — reminders are informational only.
- [ ] Deploy the web app to Dev (your web pipeline) and a Dev mobile build (EAS) as applicable.

## Phase 4 — Development smoke test (gate: all pass)
Run a **reduced** smoke against Dev (subset of the full checklist):
- [ ] Login (client/inspector/admin); no console/schema/RPC errors.
- [ ] Create → approve → apply → forward → contract → client sign → inspector sign → `in_progress`.
- [ ] Identity: Protected → Professional → Full on one job; payout/spread never shown.
- [ ] One replacement (client_reapproval) + one admin_authorized; one active contract; RFQ job replacement rejected.
- [ ] Former inspector cannot post/capture; can read own history.
- [ ] Audit: own‑read works; unrelated/anon see nothing; raw admin‑only.
- [ ] Supplier RFQ workflow still works; AI Co‑Inspector model loads.
- [ ] Gate: **all Dev smoke pass** before touching Production.

## Phase 5 — Production backup (gate: backup verified)
- [ ] `supabase link --project-ref <PROD_REF>` (confirm the ref echoed is PROD).
- [ ] Dashboard → Backups → on‑demand snapshot **or** confirm PITR. Record snapshot id/time.
- [ ] (Optional CLI) `supabase db dump --linked -f backups/prod_$(date +%Y%m%d_%H%M)_schema.sql`.
- [ ] Backup verified restorable (spot check) and timestamp logged.

## Phase 6 — Production deployment (gate: applied cleanly)
- [ ] **Re‑confirm** linked ref = `PROD_REF` (single most important check).
- [ ] Announce maintenance window if required.
- [ ] `supabase db push`.
- [ ] `supabase gen types typescript --linked > src/types/database.types.ts`.
- [ ] Handle `pg_cron` schedule as in Phase 3 if needed.

## Phase 7 — Production smoke test (gate: all pass)
- [ ] Same reduced smoke as Phase 4, against Production, with a low‑risk/test tenant.
- [ ] Verify no price/identity leak, audit own‑read works, replacement + former‑inspector cutoff behave.
- [ ] Watch logs/errors for 15–30 min. Gate: **clean**.

## Phase 8 — Build & app release
- [ ] Web: production build succeeds (`cd apps/web && npm run build`) and is deployed.
- [ ] Mobile: `expo`/EAS production build (`eas build`) for the changed screens.
- [ ] Version bump + changelog updated from `RELEASE_NOTES_TEMPLATE.md`.

## Phase 9 — Store submission (if applicable)
- [ ] iOS: submit build to **TestFlight** / App Store (`eas submit -p ios`) — only after Prod smoke passes.
- [ ] Android: submit to **Play Internal Testing** (`eas submit -p android`).
- [ ] Store metadata/screenshots updated if UI changed (contract identity panel, admin controls).

---
### Final sign‑off
- [ ] Deployment log completed (`DEPLOYMENT_LOG_TEMPLATE.md`).
- [ ] Rollback path confirmed available at every phase.
- [ ] Release owner sign‑off: __________  Date: ______
