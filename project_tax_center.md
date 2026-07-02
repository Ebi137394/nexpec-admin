---
name: project_tax_center
description: "Step 4 Tax Center — in-house pgcrypto PII vault + tax-info-before-money payout gate + admin override; web+mobile wizard. Built, HELD from prod."
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

Tax Center is built end-to-end (backend + web + mobile), suite 84/84, but the backend migrations are HELD from prod — they ship together with a single `supabase db push` when going live, because the gate freezes all payouts until payees are verified/exempt. Extends [[project_money_perimeter_hardened]] / [[project_money_flow]].

**Architecture decision (changed mid-build):** owner rejected tokenize/vendor → chose IN-HOUSE pgcrypto vault and accepted the PII liability. Raw SSN/SIN/TIN encrypted at rest; only last-4 (masked_tax_id) in the clear.

**Key management (critical):** TAX_VAULT_KEY lives ONLY in the `tax-vault` edge function (Supabase secret) — never in the DB, never in web/mobile client. pgcrypto is in the `extensions` schema (NOT public) — always qualify `extensions.pgp_sym_encrypt/decrypt`.

**Migrations (held, supabase/migrations/):** 151000 tax_profiles + gate + upsert/admin_set_tax_status; 152000 admin exemption (is_tax_exempt boolean + admin_set_tax_exemption, audited); 153000 in-house vault (tax_id_cipher bytea + vault_store_tax_id + admin_decrypt_tax_id, audited tax.pii_decrypted). Gate = `tax_can_withdraw(uid)` = verified OR exempt, enforced in request_withdrawal (TAX_NOT_VERIFIED P0001) AFTER idempotency+open-request, BEFORE balance.

**Edge fn:** supabase/functions/tax-vault (verify_jwt=true) — actions submit (vault_store_tax_id) + reveal (admin_decrypt_tax_id); caller JWT drives owner/admin guards; key injected server-side. DEPLOYED.

**UI:** web /inspector/tax-center (wizard) + /admin/tax-center (verify/reveal/exempt) + trigger gate in lib/actions/inspectorWallet.ts; mobile app/(inspector)/tax-center.tsx + withdraw.tsx pre-check (outbox can't surface the specific error, so client pre-checks; DB is the hard backstop). Forms: US W-9 / non-US W-8BEN(-E) / CA T4A / EU DAC7.

**Tests:** money_flow_test (gate, plan 25), tax_gate_test (exemption, plan 3), tax_vault_test (pgcrypto round-trip + wrong-key 39000 + non-admin deny, plan 4).

Gotchas burned: pgcrypto schema (extensions); pgTAP throws_ok(sql,text) treats 2nd arg as expected MESSAGE not errcode — use 4-arg with SQLSTATE; held migrations applied via psql -f don't ADD columns on re-run (CREATE TABLE IF NOT EXISTS skips) — additive ALTER migrations or db reset. Still in scope for the privacy/SSN-protection/breach legal review on [[reference_finance_suite_drift]]'s roadmap.
