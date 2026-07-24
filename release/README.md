# NEXPEC — Release Package

Everything needed to QA, deploy, and (if needed) roll back this release. Work through them in order.

| File | Use it for |
|------|-----------|
| **MANUAL_QA_CHECKLIST.html** | Open in your browser. Interactive checklist — checkboxes, PASS/FAIL/N/A, notes, live progress bar, filter, print, export/import results JSON. Progress is saved in that browser. Use this **while testing**. |
| **MANUAL_QA_CHECKLIST.md** | Same cases in Markdown (for PRs, printing, or offline copy). |
| **RELEASE_CHECKLIST.md** | The phased release runbook: Local QA → Dev backup → Dev deploy → Dev smoke → Prod backup → Prod deploy → Prod smoke → Build → Store. Each phase has a gate. |
| **ROLLBACK_CHECKLIST.md** | Exactly how to stop and recover if any phase fails (paths A/B/C + the rollback SQL). |
| **RELEASE_NOTES_TEMPLATE.md** | Fill in for the changelog / stakeholder notes. |
| **DEPLOYMENT_LOG_TEMPLATE.md** | Record every phase, timestamps, ref confirmations, and any incident. |

## Scope of this release
Selective inspector **identity disclosure** (Protected / Professional / Full) + **inspector replacement** (client‑reapproval / admin‑authorized) + `audit_events_public` own‑read fix. Migrations `20260801282000`→`20260801290000`. (AI/ML WDA decoder changes are also in the tree — decide whether to co‑ship; see the release notes.)

## The only remaining steps
1. **Run Manual QA** locally (`npm run qa:local`, then the HTML checklist).
2. **Deploy Development** (backup first).
3. **Smoke test** Development.
4. **Backup Production**.
5. **Deploy Production**.
6. **Build & release**.

## Start command
```bash
npm run qa:local      # local Supabase + web app → prints http://localhost:3000
```

## Non‑negotiables
- Confirm the linked Supabase project ref **before every** `db push` (Dev vs Prod).
- Back up before every migration.
- Do not deploy Production before Development QA passes.
- Keep `supabase/rollback/rollback_identity_replacement.sql` at hand; leave its destructive column‑drop commented unless intentional.
