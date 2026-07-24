# NEXPEC — Rollback Checklist

Use this the moment any release phase fails. **Principle: stop forward motion, restore to the last known‑good state, verify, then diagnose.** Never "fix forward" on Production under pressure.

**Rollback assets:**
- DB rollback script: `supabase/rollback/rollback_identity_replacement.sql` (lossless steps 1–6; destructive column‑drop is commented — leave it commented unless you truly want the columns gone).
- Environment backups: the snapshots recorded in Phases 2 and 5 of the Release Checklist.

---

## Decision matrix — what to do when a step fails
| Where it failed | Do NOT | Do |
|---|---|---|
| Phase 1 Local QA | proceed to Dev | fix locally, re‑run `validate-identity-replacement.sh`, re‑QA |
| Phase 3 Dev `db push` (mid‑apply error) | push to Prod | see **A. DB apply failed** |
| Phase 4 Dev smoke | push to Prod | see **B. App/behaviour regression** (on Dev) |
| Phase 6 Prod `db push` (mid‑apply error) | run app on partial schema | see **A** against Prod, then **C. Restore from backup** if unclear |
| Phase 7 Prod smoke | leave broken build live | see **B**, then **C** if data‑level |
| Phase 8/9 build/submit | ship a broken binary | halt submission; previous store build stays live |

---

## A. Database migration failed to apply (Dev or Prod)
1. **Stop.** Do not run the app against a half‑applied schema.
2. Capture the exact failing statement + error from the CLI output.
3. Because migrations are transactional per file, a failed file leaves that file **not applied**; earlier files are applied. Identify the last applied migration.
4. If you must revert this feature's objects (without a full restore), run the **feature rollback** against the linked project (confirm the ref first):
   ```bash
   supabase link --project-ref <REF>            # confirm DEV vs PROD
   psql "$SUPABASE_DB_URL" -f supabase/rollback/rollback_identity_replacement.sql
   ```
   This restores `send_message`, `audit_events_public`, the sign RPCs, and the client view to pre‑feature state, drops the new RPCs/policies/trigger/cron, and (optionally, commented) the columns.
5. Re‑run `supabase gen types typescript --linked` so types match the reverted schema.
6. Verify: the reduced smoke's login + job flow works on the reverted schema.
7. Diagnose the migration locally (`supabase db reset` + `supabase test db`) before re‑attempting.

## B. App/behaviour regression (smoke fails, schema is fine)
1. Roll the **application** back to the previous deployment (web: redeploy prior build; mobile: keep prior store build).
2. Leave the DB as‑is **only if** the new columns/policies are backward‑compatible with the old app (they are additive + default‑protected). If unsure, also run **A** feature rollback.
3. Reproduce on Dev with the exact role + steps; capture console/network + SQL.
4. Fix with the smallest safe change; re‑run affected pgTAP + guards + typecheck; re‑QA; restart the Release Checklist from Phase 1.

## C. Restore from backup (data‑level problem or unclear state)
1. Put the app in maintenance mode.
2. Restore the environment from the snapshot recorded in Phase 2 (Dev) or Phase 5 (Prod) via Dashboard → Backups → Restore (or PITR to just before the deploy time).
3. Redeploy the previous known‑good app build.
4. Verify login + core flows; confirm no data loss beyond the maintenance window.
5. Only then diagnose.

---

## Post‑rollback (always)
- [ ] Confirm current state = last known‑good (login + create→sign→in_progress works).
- [ ] Record in the deployment log: what failed, which rollback path (A/B/C), snapshot used, time restored.
- [ ] Do **not** re‑attempt the release until the root cause is fixed and re‑validated locally.
- [ ] Communicate status to stakeholders.

**Safety reminders:** confirm the linked project ref before any command; keep the destructive column‑drop in the rollback script commented unless intentional; never `git push`/deploy a fix straight to Prod without local validation.
