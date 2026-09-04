# Production promotion — COMPLETE (2026-08-21)

Target: `sxqpjxhslzzcdrdctatm` (asserted before every write).
Backup: `/Users/ebrahimfeyzi/nexpec-prod-backups/20260821T122040Z` — 5 SQL artefacts (SHA-256 verified, schema hash identical to prior) + 34/34 storage objects.

## Execution

| Step | Result |
|---|---|
| Pre-flight gates (target, backup, pre-state, repo parity) | all pass |
| Pre-steps 586000, 588000 applied standalone | effects verified live |
| First chain attempt | halted after 11 at a **CLI ledger-INSERT** permission blip — no migration failed; 522000/586000/588000 executed but 3 ledger rows missing |
| Official repair: `supabase migration repair --status applied 20260801522000 20260801586000 20260801588000` | "Migration history repaired" |
| Dry run | exactly 31 remaining (524000→584000); 3 repaired versions excluded |
| Resume chain | **31/31 applied, 0 errors** |

## Post-promotion evidence

- **Migration parity: EXACT** — Production ledger 232, local repo 232, 0 divergent either way, newest `20260801588000`.
- **Data preserved:** auth.users 18, profiles 18, jobs 23, super_admin **1**, storage 34 — identical to pre-state.
- **pgTAP:** 81/81 suites, 1336 assertions, 0 not ok, 0 SQL errors, 0 vacuous.
- **Feature presence (live):** email-verification gate (5 triggers), pending-verification (5 triggers + `marketplace_activated` col + admin RPC), `marketplace_hidden` col + visibility RPC, manual_payment_records table + admin RPC, 14 engineering tools, 0 accounts left deactivated by backfill.
- **Live signup smoke: 9/9** — signup trigger now creates profiles (was broken pre-promotion), role honoured, arrives pending, gated write refused with ACCOUNT_PENDING_VERIFICATION, anon blocked from jobs, reviewer job invisible, zero residue.
- **Commercial privacy (live):** admin sees price=340000/payout=230000; `authenticated` and `anon` price-column grant both **false**.
- **Payment posture (live):** `nx_online_payments_enabled()` = **false**; manual payment table + admin RPC present.
- **Reviewer job `00000000-0000-4000-8000-000000000a11`:** `marketplace_hidden=true` via audited `admin_set_job_marketplace_visibility` (actor super_admin, 1 audit row); invisible on public inspector surface; owner `apple_tester@nexpec.com` still sees own job.

No Production data deleted, no history rewritten, no reset.
