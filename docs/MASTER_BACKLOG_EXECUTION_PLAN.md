# NEXPEC — Master Backlog Execution Plan (pre-launch hardening)

Holistic strategy for the 10-item board from the forensic audit. Sequencing principle: **security → money → product completeness → intelligence**, each phase ending in a verification gate. Lower phase number = more launch-blocking.

## Phase map

| # | Item | Phase | Status |
|---|------|-------|--------|
| 1 | God-mode gap (admin ≡ super_admin) | 1 | ✅ done |
| 7 | Geo-data integrity (lat/lng CHECK) | 1 | ✅ done |
| 8 | Storage hygiene (bucket drift + chat TTL) | 1 | ✅ done (bucket-merge ops step if non-empty) |
| 9 | Misplaced `.sql` in functions dir | 1 | ✅ done |
| 10 | `DEV_SSO_BYPASS` eradication | 1 | ✅ done |
| 5 | Financial / Stripe integrity | 2 | planned |
| 6 | Notification mutes ignored | 2 | planned |
| 2 | Mobile routing defragmentation | 3 | planned |
| 4 | Coordination Bridge UI completion | 3 | planned (parked here per decision) |
| 3 | AI inference → seal binding | 4 | planned |

---

## Phase 1 — DB Security & Backend Hygiene ✅ (shipped)

Artifacts:
- `supabase/migrations/20260801120000_godmode_admin_rls_live_sweep.sql` — canonicalizes `nx_is_admin()` / `_actor_is_super_admin()` and sweeps the **live** `pg_policies` catalog, widening every residual `= 'super_admin'` RLS predicate to `ANY(ARRAY['super_admin','admin'])`. Additive, idempotent, negation-safe, atomic, logged.
- `supabase/migrations/20260801120100_jobs_geo_check_constraints.sql` — `latitude ∈ [-90,90]`, `longitude ∈ [-180,180]`, lat/lng paired; added `NOT VALID` (enforced on new writes immediately) + guarded `VALIDATE`.
- `supabase/migrations/20260801120200_storage_bucket_hygiene.sql` — retires the duplicate `inspection_photos` bucket **only when empty** (drops orphan policies + bucket); otherwise warns with a count + remediation. Full bucket-inventory verification query included; certificates/certifications left for data-driven review (not blind-merged).
- `src/utils/syncEngine.ts` — offline photo bucket `inspection_photos` → canonical `inspection-photos`.
- `src/core/chat/messages.ts` — chat-attachment signed URL **365 days → 7 days** persisted, + `getChatAttachmentSignedUrl()` mint-on-read helper (1h), + `path` returned for the durable reference.
- `app/(admin)/_layout.tsx` + `app/_layout.tsx` — admin no longer locked out of the `(admin)` group; admin treated identically to super_admin in routing.
- `app/(auth)/sign-in.tsx` — DEV SSO bypass branch + hardcoded `'devtest1234'` password removed entirely.
- `.github/workflows/security-guards.yml` — CI fences against reintroduction (bypass, long chat TTL, stray `.sql`).
- `scripts/ops/merge-bucket.mjs` — Storage-API object mover for the non-empty bucket case.

**Deploy order:** ship the code → apply `…120000` + `…120100` (pure DB, any order) → if `inspection_photos` holds objects, run `merge-bucket.mjs` then apply `…120200` (else apply directly). Run the verification queries at the foot of each migration.

**Residual (tracked):** ~RPC bodies (Bridge) still inline `super_admin` — folded into Phase 3. Full chat mint-on-read reader refactor (drop persisted URLs entirely, 1h everywhere) — fast-follow once the two chat screens are confirmed. Remove the now-dead `EXPO_PUBLIC_DEV_SSO_BYPASS=1` from `.env` and confirm `.env` is gitignored.

---

## Phase 2 — Financial Integrity & Delivery Correctness

**#5 Stripe (the launch gate for real money).** Treat the 12 edge functions as one surface and harden uniformly:
1. **Signature verification** — every webhook (`stripe-connect-webhook`, `stripe-payments-webhook`) verifies the `Stripe-Signature` header against the endpoint secret *before* parsing. Reject unsigned.
2. **Idempotency everywhere** — route every webhook through the existing `claim_stripe_webhook_event → complete/release` pattern keyed on Stripe `event.id`; every money-mutating RPC keyed on `client_op_id`/event id so retries can't double-charge or double-pay.
3. **State-machine reconciliation** — Connect onboarding + payout states (`sync-stripe-connect-status`, `create-stripe-payout`, `process-payout`, `release-payment`) reconciled to a single source of truth; no client-trusted amounts (amounts derived server-side from `job_contracts`/fee schedule).
4. **Secrets** — keys only from env; CI guard that no `sk_`/`whsec_` literal is committed.
5. **Audit + tests** — every transition writes `audit_events`; add a webhook-replay + double-spend integration harness as the gate.

**#6 Notification mutes.** Introduce one server-side predicate `should_deliver(recipient, kind, channel)` over `notification_settings`, enforced at **enqueue time** inside `enqueue_notification` and the dispatch edge functions (`notify-job-event`, `dispatch-notification-emails`) so muted push/email is never queued. In-app bell is always delivered (mutes suppress push/email only). Ship sensible defaults + a backfill migration.

---

## Phase 3 — Product Completion & UX

**#2 Mobile routing defragmentation.** One canonical route per role via a single `roleHome(role)` map; retire `(senior)`, `(super-admin)`, `(agency)`, `(organization)` to redirect stubs (one release), then delete. Close the parity gaps surfaced in the audit: client evidence vault + admin domain management screens. Mechanical but wide — do behind a route-map module so the redirects are declarative.

**#4 Coordination Bridge UI** (parked here by decision). The four gaps from the deep-dive:
1. **Web inspector workspace** — port `app/inspector/coordination-bridge.tsx` to `apps/web/src/app/inspector/coordination-bridge` (RPCs are platform-agnostic), or short-term repoint the notification `link_href`. Today those notifications 404 on web.
2. **Entry point** — a "Coordinate with vendor" action on the inspector job/assignment screen (the workspace is currently deep-link-only and effectively unreachable).
3. **Schedule counter loop** — add an inspector-side `bridge_accept_counter_schedule` so a vendor-countered time can be locked in one action (today it can only complete when the vendor accepts an inspector proposal).
4. **`pre_inspection_ack`** — add a vendor RPC + portal UI to complete it, or drop it from the required seed (today it can never reach `completed`, so `bridge_complete` always reports an unresolved required slot).

---

## Phase 4 — Intelligence

**#3 AI inference → seal binding.** Stand up the server worker that closes the loop: pull the signed model from the `ml-models` bucket (verify signature), run inference on new `inspection_captures`, write results **idempotently** via `pi_record_ai_detection`, and bind detections into the evidence pack / seal (the schema + `assemble_evidence_pack` vendor-coordination precedent already exist). Model versioning via `ml_model_registry`; teacher/student + in-house GPU per the $0-API strategy. Lowest launch-blocking risk, so last.

---

## Cross-cutting

- **Verification gate per phase** — each phase ends with the relevant checks (RLS census query, payments replay harness, route-map smoke test, detection-binding prove script) before it's "done."
- **CI fences grow with each phase** — extend `security-guards.yml` as gaps close (e.g., "no unsigned Stripe webhook handler", "no notification dispatch without should_deliver").
- **Migrations apply via the Supabase dashboard** (SQL editor), code ships via the normal build; keep the code-first / migration-second ordering where a migration narrows what code relies on.
