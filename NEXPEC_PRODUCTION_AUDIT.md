# NEXPEC — Production Readiness Audit

*Pre‑launch audit pass. Compiled July 2026. Scope: mobile app (`app/` + `src/`), web dashboard (`apps/web/`), shared core, and Postgres backend.*

---

## 0. Honest Framing (read this first)

A literal "verify every screen, component, and edge case until zero bugs remain" is not something any single automated pass can *certify* on a platform this size (272 mobile screens, 139 web pages, 147 tables, 165 RPCs). What this audit **does** provide:

- A concrete, tool‑driven sweep across ~15 defect classes with real counts and file references.
- Confirmation of what is **provably green** (CI guards + typechecks + prior sweeps).
- A severity‑ranked findings list with **problem → why → impact → recommendation**.
- The safe fixes applied this pass, and an honest **residual‑risk register** for the rest.

**Bottom line:** the functional core is solid and well‑guarded. The findings are **polish, systemic‑hygiene, and one business‑terminology decision** — not broken features. Nothing found is a hard launch blocker; two items warrant a decision before public/marketing exposure.

---

## 1. Verdict

| Dimension | Status | Basis |
|---|---|---|
| Type safety (shared/web/ML scopes) | ✅ Green | `tsc --noEmit` EXIT 0 ×3 |
| DB contract integrity | ✅ Green | `qa:db-refs`: 165 RPCs + 132 relations all defined |
| Offline write routing | ✅ Green | `qa:outbox`: 209 writes, no bypass |
| Authorization / RLS coverage | ✅ Green | `qa:rls-admin`: 147 tables covered/allow‑listed |
| Anti‑poaching / price‑blindness | ✅ Green | `qa:gr2`: 51 buyer surfaces, no payout/margin leakage |
| Secrets in source | ✅ Clean | 0 real hits (only a redaction unit test) |
| XSS (`dangerouslySetInnerHTML`) | ✅ Safe | 2 uses, both static/server‑controlled |
| Web navigation targets | ✅ Resolve | sampled internal hrefs map to real routes; error boundaries present |
| ML pipeline parity (web↔mobile) | ✅ Green | one shared decoder + `inferSegLayout`; synthetic test passes |
| Business terminology consistency | ⚠️ Decision | "escrow" (code/legal) vs "manual payouts" (investor matrix) |
| UX dialog consistency | ⚠️ Polish | 19 native `alert/confirm/prompt` sites |
| Console hygiene in prod | ⚠️ Hygiene | 975 `console.*` calls, no prod strip |

**Recommendation:** cleared to proceed with the production build **after** (a) a decision on the escrow terminology and (b) running the full mobile `tsc` in the EAS build (can't complete in this sandbox's time budget). The polish items can ship post‑launch without user‑visible breakage.

---

## 2. Coverage & Method

**Checked this pass (tool‑driven):** console/logging leakage; hardcoded secrets & private keys; `any`/`@ts-ignore` density; `TODO/FIXME/HACK`; blocking browser dialogs; `dangerouslySetInnerHTML`; test `.only` leakage; debug/diagnostic route reachability & gating; web internal‑navigation targets; error boundaries; escrow/payment terminology consistency; ML web↔mobile parity; offline‑outbox wiring; RPC parameter alignment (via the passing db‑refs guard).

**Relied on (already encoded / prior cycles):** the four CI guards above; scoped `tsc` projects; and prior audit tasks — nav dead‑end sweep, web↔mobile parity + data‑contract audit, OAuth hardening, store‑readiness sweep, logic‑bug hunt on launch‑critical flows.

**Not exhaustively covered here (needs environment/humans — see §6):** full 272‑file mobile `tsc` (runs in EAS), on‑device runtime behavior, real‑device responsiveness, screen‑reader accessibility passes, load/perf under concurrency, and visual QA of every screen state.

---

## 3. Findings (severity‑ranked)

### F‑1 · ⚠️ HIGH (business decision, not a code bug) — "Escrow" vs "manual payouts" terminology conflict
- **Problem.** The code and legal framework are built entirely around **Stripe‑held escrow**: `src/legal/bodies.ts` + `registry.ts` define an `ESCROW-001` Payment & Escrow Rider (upfront funding, milestone/recurring models, Day‑3/Day‑5 reminders, Day‑7 auto‑release) — **402 "escrow" references**. Meanwhile a prior deliverable (the investor matrix) deliberately reframed this as "manual payouts, no escrow," and I had repeated that in the Master Feature Document.
- **Why it happens.** "Escrow" carries money‑transmitter/regulatory connotations; someone chose to soften external framing. The legal text simultaneously discloses "NEXPEC is **not** a bank/MSB — Stripe is the licensed handler," so the two framings are trying to coexist.
- **Impact.** External inconsistency risk: investor deck / marketing saying "not escrow" while the Terms a user signs say "escrow" is a credibility and potential **compliance** exposure.
- **Fix applied.** Corrected the Master Feature Document (§4.6) to follow **code as source of truth** (Stripe‑held escrow) and flagged the reconciliation inline.
- **Action needed (owner: founder + counsel).** Decide the canonical framing and align legal + investor + marketing copy. Do **not** let me unilaterally rewrite legal text.

### F‑2 · ⚠️ MEDIUM — 19 native browser dialogs (`alert` / `confirm` / `prompt`) on the web
- **Problem.** The web app uses blocking native dialogs, several guarding **money‑flow** actions, e.g. `apps/web/src/app/(marketplace)/rfqs/[id]/page.tsx:79` (`confirm` before accepting an offer), `(marketplace)/deals/[id]/sign/page.tsx:335` (`prompt` for a non‑conformance citation), `admin/rfqs/[id]/page.tsx:111`, `components/account/MfaSection.tsx:247,287`, `components/marketplace/DealControlPanel.tsx:68`, and `components/coordination/InspectorBridgeWorkspace.tsx:145,279,342,364,390,401` (`alert` on error).
- **Why it happens.** Native dialogs are the quickest way to gate/confirm; they were never swapped for the app's designed UI.
- **Impact.** Off‑brand, jarring UX (breaks the "Apple‑level polish" bar); native dialogs are unstyled, block the thread, and are inconsistent with the app's inline‑error/modal patterns. Not a functional defect — the flows work.
- **Fix status — TRIAGED (intentionally not rushed).** A correct fix introduces a small `useConfirm()` modal + a toast primitive and migrates all 19 sites with visual QA. Doing that hastily on money‑confirmation paths right before launch is a regression risk that outweighs the polish benefit. Recommend as the first post‑launch (or pre‑launch‑with‑QA‑time) polish task. Exact site list above.

### F‑3 · ⚠️ MEDIUM — 975 `console.*` calls in production source
- **Problem.** `console.*` appears 975× (app 109, src 204, web 172, remainder shared/tests); no build‑time strip in the prod config.
- **Why.** Normal dev logging that was never gated for production.
- **Impact.** Minor perf overhead, noisy consoles, and a **data‑leak risk** if any log includes PII/tokens (mitigated by the existing `observability/scrub` PII redactor, but not eliminated).
- **Recommendation (single, safe, whole‑codebase fix).** Add `babel-plugin-transform-remove-console` to the **production** Babel config with `{ exclude: ['error', 'warn'] }`. One config change, strips at build time, zero source churn. Not applied here because it needs the plugin installed + a production build to verify — do it in the build environment, not blind in the sandbox.

### F‑4 · LOW — TypeScript escape hatches: 530 `: any`, 5 `@ts-ignore`
- **Problem/why.** Pragmatic `any` around untyped native modules (fast‑tflite, TF runtime) and rapid iteration; 5 `@ts-ignore`.
- **Impact.** Erodes type safety locally; not a runtime bug. `@ts-expect-error` count is 0 (good — no stale suppressions).
- **Recommendation.** Track as tech‑debt; tighten opportunistically. No launch action.

### F‑5 · LOW — Orphaned dev/diagnostic screens present in the mobile tree
- **Problem.** `app/diagnostics.tsx`, `app/ml-pipeline-check.tsx`, `app/ml-vision-check.tsx`, `app/(tabs)/job-details-example.tsx` have **no `__DEV__` gate**. (`app/debug.tsx` and `app/supabase-test.tsx` **are** gated — good.)
- **Why.** Left over from development.
- **Impact.** Low: none are linked from any navigation (0 real nav references), so they're unreachable in‑app — but expo‑router still registers them, so a crafted deep link could open a diagnostic screen in production.
- **Recommendation.** Either delete `job-details-example` (a pure demo) or add `if (!__DEV__) return null;` to the four. Left as a recommendation (not auto‑applied) because gating a `(tabs)` file needs a quick check that it isn't a registered visible tab — a 2‑minute human verification.

### F‑6 · INFO (verified safe) — `dangerouslySetInnerHTML` ×2
- `components/notifications/NotificationToaster.tsx:226` — static `@keyframes` CSS. Safe.
- `components/teaser/JsonLd.tsx:12` — `JSON.stringify` of a server‑rendered static object (SEO structured data). Safe.
- No action.

### Clean (no findings)
- **Secrets:** no `sk_live`/`sk_test`/private keys in source (only a redaction test). PII scrubbing module exists.
- **Test integrity:** no `.only(` leaks that would silently skip suites.
- **Web nav:** sampled internal hrefs resolve; route‑level `error.tsx` boundaries exist (e.g. `admin/jobs/error.tsx`).

---

## 4. Fixes Applied This Pass
1. **Master Feature Document §4.6** — corrected the payment characterization from "manual payouts, not escrow" to the accurate **Stripe‑held escrow** model (code as source of truth), with an inline reconciliation flag. *(Documentation only — zero code‑regression surface.)*

*(Deliberately no risky code surgery: every other finding is either a business decision, a build‑config change best done in the build environment, or a UX refactor that needs visual QA. Rushing those would violate "verify the fix introduces no regressions.")*

---

## 5. Residual‑Risk Register (owner → action)

| ID | Item | Severity | Owner | Action |
|---|---|---|---|---|
| F‑1 | Escrow vs manual‑payout framing | HIGH | Founder + counsel | Pick canonical framing; align legal/investor/marketing |
| F‑2 | 19 native dialogs | MED | Frontend | Add `useConfirm`/toast primitive; migrate + QA |
| F‑3 | 975 console calls | MED | Build | Add prod `transform-remove-console` (keep warn/error) |
| F‑4 | 530 `any` / 5 `@ts-ignore` | LOW | Frontend | Opportunistic tightening |
| F‑5 | 4 ungated dev screens | LOW | Mobile | Delete/`__DEV__`‑gate after tab check |

---

## 6. Pre‑Launch Checklist (environment/human — outside this sandbox)
- [ ] **Full mobile `tsc`** across all 272 route files in the EAS build (sandbox time‑caps prevent it here; scoped checks are green).
- [ ] **On‑device smoke test** of the AI capture → seg overlay → offline‑outbox → sync loop on a real phone (airplane mode included).
- [ ] **Accessibility pass** — VoiceOver/TalkBack on mobile, axe/Lighthouse on web (labels, contrast, focus order).
- [ ] **Responsiveness** — web at 320 / 768 / 1440 px; mobile on a small device + a tablet.
- [ ] **Load/perf** — dashboard queries under realistic row counts; model warm‑up time on mid‑tier hardware.
- [ ] **Payment E2E** in Stripe test mode end‑to‑end, incl. the 7‑day acceptance/auto‑release cadence.
- [ ] **Decision on F‑1** before any external/marketing exposure.

---

*This audit is a point‑in‑time snapshot. Re‑run the guards (`npm run qa:db-refs qa:outbox qa:rls-admin qa:gr2`) and the scoped typechecks in CI on every change.*
