# NEXPEC — Marketing Claim Verification & Two-Package Split

**This file supersedes the claim wording in `LINKEDIN_LAUNCH_PACKAGE.md` and `APP_STORE_PLAY_LAUNCH.md`.** Where they conflict, use this. No claim about users, revenue, clients, accuracy, or market position appears (none is verified).

## 9. Feature → evidence matrix

| Public claim | Implemented feature | Source (files/tables) | Runtime verification needed | Safe to publish now? |
|---|---|---|---|---|
| "Vetted inspectors" | **Baseline administrative check only** (cert validity/expiration) + NEXPEC-verified competencies | TOS-001 §4; trust-card `verification_status`; `inspectors_directory` | n/a (legal text is explicit) | ❌ **Soften** — say "NEXPEC-verified credentials" / "baseline-checked", NOT "vetted" (TOS §4 disclaims vetting of competence) |
| "Cryptographically signed evidence" | Ed25519 signing + report seals | `signing_keys`, `pi_report_seals`, `nexpec_model_signing.pub.pem`, provable-AI loop | Verify a seal verifies on device in staging | 🟡 Yes if softened to "cryptographically signed evidence packs"; **avoid** specific "Bitcoin-anchored" unless the OTS confirm path is demoed |
| "Seven-language UI" | 7 dictionaries: en, fr, es, de, zh, ar, fa | `src/i18n/translations.ts` | zh/ar/fa are MT seeds pending native review (per project notes) | ❌ **Soften** — "multilingual (7 languages; several in preview)" |
| "Controller-grade DPA" | DPA-001 document exists | `src/legal/registry.ts` (DPA-001), `bodies.ts` | Status is `draft`; not counsel-activated | 🟡 "DPA available for enterprise" — not "in force" until activated |
| "Immutable audit history" | `audit_events` has INSERT+SELECT policies, **no UPDATE/DELETE policy** (RLS denies edits/deletes to authenticated, incl. admins) | baseline RLS policies on `audit_events` | Confirm no service-path mutation in normal ops | 🟡 **Soften** to "append-only, tamper-resistant audit trail (RLS-enforced)" — "immutable" overstates (service_role can still write) |
| "On-device AI co-inspector" | TFLite model + segmentation overlay, runs locally | `react-native-fast-tflite`, `mobilenet_v2.tflite`, seg overlay | Demo on device | ✅ Yes |
| "Offline capture" | Offline outbox queue + drain-on-reconnect | outbox routing (qa:outbox), `src/core/offline` | Airplane-mode capture→sync demo | ✅ Yes |
| "Database-enforced price blindness" | RLS + CI guard forbidding payout/margin cols on buyer surfaces | `qa:gr2` (check-price-blindness), buyer-surface RLS | n/a (guard passes) | ✅ Yes — strong, verified |
| "Admin-reviewed reports" | Reports gated to admin before client via `admin_confirmed_at` | reports flow, golden-rules | Flow test on staging | ✅ Yes |
| "All chats include platform staff" | Conversation `kind` DB-CHECK limits rooms to `job_client_admin`, `job_inspector_admin`, `help_support` — no client↔inspector room | `conversations_kind_shape` CHECK (baseline) | n/a (DB constraint) | ✅ Yes — verified, DB-enforced |
| "De-identified technical data" | **NOT implemented** — no GPS/EXIF/face/identifier stripping exists | (none) | Build the de-id job first | ❌ **Remove** — do not claim de-identified until the pipeline runs (see REVIEW_CORRECTIONS §8) |
| "Reviewed/manual payouts" | Manual Mark-as-Paid; no auto-Stripe transfer | money-flow, payout board | Flow test | ✅ Yes |
| "Anti-poaching pseudonymity" | Public surfaces emit zero PII; NX-handle + trust sigil | `/p`, `inspectors_directory`, price-blindness | n/a | ✅ Yes |

**Net corrections:** drop "de-identified"; soften "vetted" → "NEXPEC-verified/credential-checked"; soften "seven-language" → "multilingual (several in preview)"; soften "immutable" → "append-only/tamper-resistant"; DPA "available" not "in force"; keep Bitcoin anchoring out unless demoed.

---

## PACKAGE A — PRE-LAUNCH / EARLY ACCESS (safe to publish now)
Rules honored: no "live", no "available on App Store/Google Play", waitlist/early-access language only.

**Headline:** *NEXPEC — building the trust layer for industrial inspection. Early access opening soon.*

**Tagline:** *Verifiable inspection. Brokered, signed, reviewed.*

**LinkedIn (professional, pre-launch):**
> We're building NEXPEC: trust infrastructure for industrial inspection.
> • A brokered, contract-first marketplace with **database-enforced price blindness** — you see your price, the inspector sees their payout.
> • An **on-device AI co-inspector** that assists with defect detection and works **offline**.
> • **Cryptographically signed** evidence packs and **admin-reviewed** reports.
> • **All engagement chats include NEXPEC staff** — enforced in the database.
> Early access is opening for inspectors, clients, suppliers, and enterprise teams. Comment or DM to join the early-access list.
> #IndustrialInspection #NDT #AssetIntegrity #InspectionTech

**Inspector (pre-launch):**
> Inspectors — NEXPEC early access is opening. A brokered marketplace where you set your bid, an on-device AI co-inspector that works offline, protected payouts, and price-blindness that protects you. Join the early-access list. #NDT #FieldService

**Client / Enterprise (pre-launch):**
> Need inspections you can verify? NEXPEC brokers NEXPEC-verified specialists to your scope, reviews reports before delivery, and protects payment until sign-off — with a controller-grade DPA available for enterprise. Early access opening — request an invite. #AssetIntegrity #EPC

**Supplier (pre-launch):**
> Suppliers — bring procurement on-platform with NEXPEC: RFQs, confidential quotes, brokered contracts, protected payouts. Early access opening — join the list. #Procurement #SupplyChain

**CTA (pre-launch):** *Join the early-access list — comment or DM. Launching on web, iOS, and Android soon.*

**Hashtags:** `#IndustrialInspection #NDT #AssetIntegrity #InspectionTech #ConstructionTech #EarlyAccess`

**Visuals:** same list as the LinkedIn package, but label each "early access / preview"; every screenshot must be real shipped UI.

---

## PACKAGE B — POST-LAUNCH (publish ONLY after verification)
**Gate — all must be true before using Package B:** (1) production web app live and verified; (2) App Store listing live; (3) Google Play listing live; (4) reviewer/device smoke passed. Until then, use Package A.

Use the posts already drafted in `LINKEDIN_LAUNCH_PACKAGE.md` **with these substitutions applied:**
- "vetted inspectors" → "NEXPEC-verified inspectors" / "credential-checked"
- "seven-language" → "multilingual (7 languages, several in preview)"
- "immutable audit history" → "append-only, tamper-resistant audit trail"
- remove any "de-identified" wording
- "cryptographically signed evidence" OK; drop specific Bitcoin/anchoring claims unless demoed
- "Available now on the App Store, Google Play, and the web" — only after (1)-(3) verified.

**Post-launch headline:** *NEXPEC is live — the trust layer for industrial inspection.* (only after store + web verified)

---

## Do-not-say list (until verified/built)
- ❌ "de-identified" data (no pipeline yet)
- ❌ "vetted" (TOS says baseline check only)
- ❌ "immutable" (say append-only/tamper-resistant)
- ❌ user counts, revenue, client names, "X% accurate", "industry-leading", certifications
- ❌ "live" / store availability (until listings verified) — Package A avoids this by design
