# NEXPEC Contract Engine — Production Release Runbook

Ships the brokered-deal contract engine: MSA-grade templates, milestone escrow, the
three inspector-routing models, and the paid Named-Disclosure VIP engine.

**Batch:** migrations `20260801124000` → `20260801128000` (the user-facing ask is
`125000 → 128000`; `124000`–`124800` are the spine prerequisites — `supabase db push`
applies whatever is still pending, in timestamp order, so confirm state first).

**Safety profile:** every migration is additive + idempotent. The batch contains **no
`DROP TABLE`, `TRUNCATE`, `DELETE`, or `DROP COLUMN`** at apply time. The only `DROP`s
are `VIEW` / `TRIGGER` / `POLICY` / `CONSTRAINT` / `FUNCTION` immediately recreated, and
the two `CHECK` widenings only *add* allowed values (existing rows always still satisfy
them). Money remains a **ledger** (no live Stripe capture in this batch).

---

## 0. Apply order (what `supabase db push` will run)

| # | Migration | What it lands |
| - | --- | --- |
| 1 | `124000_brokered_deal_spine` | deals / agreements / signatures + price-blind views |
| 2 | `124500_brokered_deal_p1_saga` | award_and_dispatch, sign_agreement, money legs, contract-before-money |
| 3 | `124600_brokered_deal_p1_adopt_legacy` | adopt legacy job/supplier contracts into the spine |
| 4 | `124700_brokered_deal_p2_gates` | present/assign/accept-goods + per-leg release gates |
| 5 | `124800_brokered_deal_p3p4_trust` | A/B/C dossier, D review gate, F identity escrow + client view |
| 6 | `125000_brokered_agreement_notifications` | notify_safe + push on agreement → presented |
| 7 | `125500_unified_contracts_consolidation` | MSA+Schedule templates + unified_contracts_view |
| 8 | `126000_autocontract_supplier_on_award` | auto supplier_supply on quote award |
| 9 | `126100_fix_supplier_contract_amount` | correct $0 supplier cost via _quote_raw_cents |
| 10 | `126200_autocontract_client_leg` | auto client_supply leg + backfill |
| 11 | `127000_msa_grade_contracts_and_milestone_escrow` | Quebec/ADRIC MSAs, 30/30/30+10 hybrid escrow, NCR/deemed-acceptance |
| 12 | `127500_inspector_routing_engine` | matcher + auto-match + blinded client-selection shortlist |
| 13 | `128000_named_disclosure_vip_engine` | sealed amendment + tiered Administrative Amendment Fee + early reveal |

Each migration ends in a `DO $$ … RAISE NOTICE 'OK' … END $$` self-test that **aborts the
transaction on any failed invariant** — so a successful `db push` *is* the proof that all
self-tests passed.

---

## 1. Pre-flight checks (do not skip)

1. **Backup.** Confirm Supabase PITR is on (Dashboard → Database → Backups) and take a
   fresh snapshot / note the restore point. Optionally `pg_dump` the schema.
2. **Migration state.** `supabase migration list` — confirm exactly which of the 13 are
   `Local` (pending) vs `Remote` (applied). Nothing else should be pending.
3. **Staging dry-run (mandatory).** Link a staging project and
   `supabase db push` there first. Watch the CLI output for all 13 `OK` NOTICEs and zero
   `EXCEPTION`. This is the real gate.
4. **Re-run idempotency.** On staging, run `supabase db push` a second time → it must be a
   no-op (migrations tracked; bodies are `IF NOT EXISTS` / `CREATE OR REPLACE`).
5. **App builds green.** Web: `cd apps/web && npm run typecheck && npm run lint` → 0.
   Mobile: scoped `tsc` clean (only the 4 pre-existing `core/supabase/supabase.ts` errors).
6. **Edge function secrets.** Confirm `notify-agreement` secrets are set on the project
   (`supabase secrets list`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and Expo push
   credentials. The disclosure + routing flows emit in-app/email via the DB `notify_safe`
   trigger regardless; device push needs this function deployed.
7. **Dependency presence.** These must already exist on prod (pre-`124000` or in-batch):
   `nx_is_admin`, `nx_set_updated_at`, `extensions.digest`, `_quote_raw_cents`,
   `award_quote`, `jobs.admin_confirmed_at`, `profiles.specialty_slugs/certifications`.
   The staging dry-run proves this.
8. **Confirm fee table** (already in code): Base `<$10k` $100 · Standard `$10k–$100k` 1% ·
   Enterprise `$100k–$1M` $350 · Elite `>$1M` $500.

---

## 2. Deployment sequence (production)

Run in this order. Halt on any error.

```bash
# 2.1 — Point CLI at PROD (use your linked prod ref)
supabase link --project-ref <PROD_REF>
supabase migration list                 # final confirmation of pending set

# 2.2 — DATABASE: apply the batch (transactional per migration; self-tests gate it)
supabase db push
#   → watch for 13 "... OK ..." NOTICEs, e.g.
#     "Named-Disclosure VIP engine OK: sealed rider + fee leg + tier upgrade + early identity reveal."

# 2.3 — EDGE FUNCTIONS (device push for presented agreements / disclosure)
supabase functions deploy notify-agreement

# 2.4 — CODE: push the branch (triggers Vercel prod build for apps/web)
git push origin HEAD

# 2.5 — WEB: confirm the Vercel production deployment succeeded (or `vercel --prod`)

# 2.6 — MOBILE
#   OTA (`eas update`) only reaches an installed build that already bundles
#   expo-updates. It is not installed yet and no production build is live, so this
#   release ships as a full build (which also bakes in the EAS project link):
npx expo install expo-updates            # one-time: enables OTA for FUTURE JS releases
eas build --profile production           # cloud build = expo-updates + current JS + projectId
eas submit --profile production          # to the stores (or distribute the artifact for internal)
#   AFTER that build is installed, future JS-only changes ship over the air:
#   eas update --branch production --message "..."
```

---

## 3. Post-deploy verification (smoke, ~15 min)

**Price-blindness invariant (do first):** as each party, confirm you see exactly one money
figure — client sees price, supplier sees cost, inspector sees payout, never the spread.

Per persona:

- **Client / Agency / Enterprise:** create RFQ → (admin presents offer) → Award & sign →
  30% deposit holds, deal dispatched → payment schedule (30/30/30+10) renders →
  Fund 70% balance works.
- **Admin (web Deal Control):** present supplier leg; assign inspector via all three —
  Broker pick, Auto-match (ranked preview), Offer shortlist; mark delivered; accept goods;
  release supplier + inspector payouts (gates hold).
- **Client (routing):** when a shortlist is offered, the blinded A/B/C certificates render
  (no name/photo); Select one → engagement executes, name stays escrowed.
- **VIP (Layer E):** on an assigned deal, open the gate → Continue → the fee matches the
  tier (spot-check a `<$10k`, a mid `$10k–$100k`, and a `>$100k` deal) → sign the sealed
  amendment → name reveals + gold "Named disclosure" ribbon appears.
- **Supplier / Inspector:** sign your own leg; receive the notification; identity stays
  sealed until report admin-confirmed (or VIP unlock).

DB spot-check (optional):
```sql
select kind, status, amount_cents from agreements order by created_at desc limit 10;
select kind, status, amount_cents from deal_money_legs order by created_at desc limit 10;
```

---

## 4. Rollback

The batch is additive, so prefer an **app-level rollback** — the new tables/RPCs go inert
if nothing calls them:

1. **Web:** redeploy the previous Vercel production build (instant rollback in the Vercel
   dashboard).
2. **Mobile:** `eas update --branch production` re-pointing to the prior commit (OTA
   revert).

A **database rollback is only needed** if a migration corrupted data (none are destructive,
so this is unlikely). If required: restore the PITR snapshot from step 1.1. Leaving the
schema additions in place is safe even if the app is rolled back.

---

## 5. Notes & follow-ups

- **Fees are ledger entries** (`vip_disclosure_fee`, `client_escrow_in`) exactly like all
  money in the platform today. Wiring live Stripe capture/settlement is the one remaining
  cross-cutting integration and is intentionally out of this batch.
- **Tiered fee tuning:** the tier thresholds + amounts live in
  `request_named_disclosure` (migration `128000`). Changing them = one follow-up migration.
- **Deemed-acceptance** ignores statutory holidays (weekday count only) — acceptable v1;
  note for a future holiday-calendar refinement.
