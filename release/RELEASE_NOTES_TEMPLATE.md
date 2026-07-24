# Release Notes — NEXPEC v____  (____-__-__)

> Fill the blanks. Keep an internal (full) version and, if needed, a customer‑facing (trimmed) version.

## Summary
One‑paragraph description of what shipped and why.

## Highlights (user‑facing)
- **Selective inspector identity disclosure** — projects can be set to **Protected**, **Professional**, or **Full**, controlling how much of the assigned inspector's identity the client sees.
- **Inspector replacement** — admins can replace an assigned inspector via void‑and‑reissue, with **client re‑approval** or **admin‑authorized** modes, without restarting the job.
- (If shipping together) **AI Co‑Inspector** — WDA weld‑defect model + decoder updates.

## Changes (technical)
### Database migrations
- `20260801282000` — `pi_record_ai_detection` RPC contract (`p_client_op_id`) + idempotency.
- `20260801284000` — `jobs.identity_mode`/`replacement_mode`; `job_contracts` approval + snapshot columns; constraints; immutable execution‑time snapshot trigger; helper functions.
- `20260801286000` — `admin_set_project_policy`, `admin_void_contract`, `admin_replace_inspector`; RFQ‑exclusion trigger; sign‑RPC audit events.
- `20260801288000` — extended `client_job_contracts_view` (DB‑resolved disclosure); operational/historical RLS; `send_message` former‑inspector cutoff; informational `pg_cron` reminder.
- `20260801290000` — `audit_events_public` own‑read fix (restores non‑admin own/job‑party/org‑member read; keeps redaction + inspector anonymization; raw table stays admin‑only).

### Application
- Web: admin job page (Inspection controls), client contract page (identity panel), `jobContracts.ts`, `inspectionAdmin.ts`, `InspectionMarketplaceAdminPanel.tsx`.
- (If included) shared‑core ML decoders + WDA model artifacts.

## Security / privacy
- Client price‑blindness preserved (no payout/spread on buyer surfaces).
- Identity disclosure resolved server‑side; execution‑time snapshot is immutable.
- Former‑inspector operational cutoff (write + messaging); audit redaction/anonymization intact.

## Backward compatibility
- New columns default to `protected` / `client_signature`; legacy executed contracts resolve fail‑closed to `protected`. No destructive backfill.

## Migration / ops notes
- Requires `supabase db push`; regenerate types. `nx_identity_replacement_reminders` cron is informational (schedule manually if the role lacks `pg_cron`).

## Rollback
- `supabase/rollback/rollback_identity_replacement.sql` (lossless steps 1–6). See `ROLLBACK_CHECKLIST.md`.

## Known issues / follow‑ups
- Pre‑existing: some web surfaces read raw `audit_events` directly (admin‑only since 230000) — owner decision, out of this release's scope.
- Decide whether AI/ML ships in this release or a separate one.

## Validation
- Local: 174/174 db tests, 114/114 unit tests, web+mobile typecheck, lint, QA guards — all green.
- Manual QA: see attached results JSON from `MANUAL_QA_CHECKLIST.html`.

## Credits / approvals
- Engineering: ______  QA: ______  Release owner: ______
