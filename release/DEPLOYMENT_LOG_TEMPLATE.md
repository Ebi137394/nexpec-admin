# NEXPEC — Deployment Log

**Release:** ______   **Owner:** ______   **Git commit/tag:** ______

| # | Phase | Env | Command / action | Started | Finished | Result (PASS/FAIL) | Evidence / notes |
|---|-------|-----|------------------|---------|----------|:------------------:|------------------|
| 0 | Preconditions | Local | committed, validation green, refs recorded |  |  |  |  |
| 1 | Local Manual QA | Local | ran MANUAL_QA_CHECKLIST |  |  |  | results JSON: ____ |
| 2 | Dev backup | Dev | snapshot / db dump |  |  |  | snapshot id/time: ____ |
| 3 | Dev deploy | Dev | `supabase db push` + gen types + app deploy |  |  |  | migrations 282000→290000 |
| 4 | Dev smoke | Dev | reduced smoke |  |  |  |  |
| 5 | Prod backup | Prod | snapshot / db dump |  |  |  | snapshot id/time: ____ |
| 6 | Prod deploy | Prod | confirm ref=PROD, `supabase db push` |  |  |  |  |
| 7 | Prod smoke | Prod | reduced smoke + 15–30 min watch |  |  |  |  |
| 8 | Build | — | web build + EAS build |  |  |  | versions: ____ |
| 9 | Store submit | — | TestFlight / Play Internal |  |  |  | build ids: ____ |

## Ref confirmation (fill before each push — protects against wrong target)
- Before Dev push, `supabase status`/link echoed ref = ____________ (must be DEV).
- Before Prod push, link echoed ref = ____________ (must be PROD).

## Incidents / rollbacks
| Time | Phase | What failed | Rollback path (A/B/C) | Snapshot restored | Restored‑good time | Root cause |
|------|-------|-------------|-----------------------|-------------------|--------------------|------------|
|  |  |  |  |  |  |  |

## Sign‑off
- Dev QA passed by: ______  (date/time)
- Prod deploy approved by: ______  (date/time)
- Release closed by: ______  (date/time)
