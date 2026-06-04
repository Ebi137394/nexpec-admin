# NEXPEC — Genius Final Audit
### Microscopic pre-golden-path sweep · Vendor Custody ↔ RFQ Engine ↔ Supplier Dashboard ↔ Admin Command Center

Every finding below was verified against the actual code, not asserted. Severity is real-world impact in a high-stakes industrial deployment.

---

## P0 — Data integrity (FIXED in this sweep)

**1. Double-spawn race on award → duplicate inspection dispatch.**
`_spawn_inspection_for_award()` (trigger) and `award_quote()` both read the RFQ row *without a lock* and gate on `spawned_job_id IS NULL`. Two near-simultaneous awards on the same RFQ (realistic with multiple admins brokering) both pass the gate → **two source/FAT jobs for one RFQ.** A duplicate inspector dispatch and a corrupted RFQ↔job link.
**Patch (applied — migration `122500`):** a UNIQUE partial index on `jobs(source_rfq_id)`. The invariant becomes physically impossible to violate; the losing transaction rolls back, exactly one job survives. No trigger rewrite, no behavior change on the happy path.
*Optional follow-up:* add `FOR UPDATE` to the RFQ `SELECT` in `award_quote` so the rare loser gets a clean `rfq_not_awardable` instead of a unique-violation error.

---

## P1 — Architecture & real-world robustness (your call — ready to execute)

**2. Web/mobile parity gap — the entire ecosystem is mobile-only.**
A grep of `apps/web` for `supplier_rfqs | supplier_quotes | vendor_documents | create_rfq | award_quote` returns **zero files.** The RFQ engine, Supplier Directory, Supplier Dashboard, Vendor Custody, and `DocumentField` exist only in the Expo app. Against the stated 100%-parity north-star, this is the single largest gap between "great" and "masterpiece." The good news: the data + RLS + RPC layer is entirely platform-agnostic, so this is a **pure web-UI build** — Next.js pages mirroring the five mobile surfaces, reusing the same Supabase calls. Biggest lever for the platform's completeness.

**3. RFQ lifecycle has no notifications.**
Award spawns a job and auto-declines losing quotes — silently. No supplier learns they won or lost; no admin is pinged that a source job hit the moderation queue. The notification spine already exists (`notification_consent`, `coordination_bridge_notifications`). Wiring three events (quote awarded → winner; quote declined → losers; job spawned → admin) into the trigger/`award_quote` turns the turnkey loop from "works" to "feels alive."

**4. Large-file hashing is a device memory bottleneck.**
`DocumentField` reads the whole file as base64 then hashes the string. A 50 MB vendor data book → a ~67 MB JS string held in memory plus the hash pass — real jank/OOM risk on low-end field devices, exactly where inspectors work. Add an on-device size guard (warn/stream above ~25 MB) or chunked hashing.

**5. Orphaned upload on seal failure.**
`DocumentField` uploads to Storage *then* calls `vendor_document_seal`. If the seal RPC fails (auth blip, network), the bytes linger in the bucket with no `vendor_documents` row. Add a cleanup-on-failure (delete the just-uploaded object) or a periodic reconciler that prunes bucket objects with no matching row.

**6. Vendor-document client visibility (forward-looking).**
`vendor_documents` RLS is vendor-or-admin only. Correct for Phase 1, but the moment a document binds to a quote/contract, the buying client must be able to read *that* document (and only that one). Add a binding-aware SELECT policy when the quote/contract binding ships — mirror the price-blind pattern so a client sees docs on their own RFQ, never a competitor's.

---

## P2 — Polish (cheap, high perceived quality)

**7. Suppliers see tabs that aren't theirs.** The `(tabs)` layout shows Jobs / Finance / Docs to every role. A supplier's "Jobs" tab is empty/irrelevant. Tailor the tab set per role (suppliers → Dashboard / RFQs / Profile).

**8. `finance.tsx` role label is supplier-blind.** Cosmetic leftover — same fix as the Profile labels.

**9. Quote amounts are freeform float dollars.** The platform standardizes on integer `price_cents` everywhere else (zero client-trusted float pricing was a Phase 2 hardening). Quotes should normalize to cents to avoid rounding drift and stay consistent with escrow/payout math.

**10. `content_sha256` hashes the base64 representation, not raw bytes.** Deterministic and fully verifiable *inside* NEXPEC, but it won't match a vendor running `sha256sum file.pdf`. Fine today; note it for any "bring-your-own-hash" legal scenario, and consider raw-byte hashing when a native module is available.

---

## Verified NOT bugs (audited, cleared — for your confidence)

- **Scopeless source inspections are intentional.** `create_rfq` allows `requires_source_inspection = true` with `scope_template_id = NULL`; the trigger maps that to a `quality` job (no compliance template). That's a legitimate path, not a gap — the frontend asks for a discipline for clarity, the backend correctly supports quality-only source inspection.
- **DynamicForm infinite loop** is fixed (signature-keyed init effect); no other unstable-dep effects in the new screens.
- **Admin → `/rfqs` / `/suppliers` navigation** passes the AuthGate (both are in `allowedStandaloneRoutes`, so the strict admin-route enforcement doesn't bounce them).
- **Price-blindness holds** across `submit_quote` / `award_quote` / quote RLS; the new supplier-RFQ read widening (`122300`) exposes RFQ rows, never competitors' quotes.

---

## Hygiene

**11. `brokerage_setup.sql` has no timestamp prefix.** It sorts *after* every `2026…`-prefixed migration in `supabase db reset`, so it runs last regardless of its real dependencies. Rename it with a proper timestamp or confirm it's an obsolete dev one-off and remove it — otherwise it's a latent ordering landmine on a clean rebuild.

---

## Golden-path migration apply order (confirm all are in before testing)

```
20260801121800_turnkey_procurement_qaqc.sql          (RFQ inspection dimension + auto-spawn)
20260801121900_rfq_scope_aware_create.sql            (scope-aware create_rfq)
20260801122000_supplier_onboard_headline.sql         (headline persistence)
20260801122100_submit_quote_multi_supplier.sql       (many suppliers + resubmit)
20260801122200_handle_new_user_supplier_role.sql     (supplier signup role)
20260801122300_rfq_supplier_quoted_visibility.sql    (My Bids titles)
20260801122400_vendor_custody_core.sql               (vendor_documents + bucket + seal)
20260801122500_turnkey_concurrency_hardening.sql     (one job per RFQ — NEW)
```

Plus the LinkedIn provider config in the Supabase dashboard, and a Metro reload.

---

## The one move that makes it a masterpiece

Everything above is hardening. The leap from "great platform" to "category-defining" is **#2 — web parity.** A buyer's procurement team lives on a desktop; a vendor's contracts office lives on a desktop. Bringing the RFQ engine and the Vendor Custody dossier to the web — on the platform-agnostic backend you already built — is what turns NEXPEC from a great mobile app into the industrial procurement *system of record*.
