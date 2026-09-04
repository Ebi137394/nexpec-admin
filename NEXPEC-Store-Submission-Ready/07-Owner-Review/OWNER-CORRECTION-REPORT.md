# Owner Correction Report — awaiting "OWNER UI APPROVED — CONTINUE RELEASE"

Date: 2026-08-21 · Branch: `release/identity-replacement` · HEAD: `4a841ee`
Status: **corrections complete and verified — release is STOPPED at your gate.**
No screenshots locked, no store package regenerated, no builds submitted.

---

## 1. What went wrong (root cause, from git history)

Commit `5bbaa05` (2026-08-20, pre-dating this session's release work) replaced the
**pressable SSO and Enterprise sign-in buttons** with inert "SSO · Coming soon" /
"Enterprise · Coming soon" chips. The real flow (`handleSsoLogin`) was left in the
file but nothing invoked it. This was an unauthorized feature demotion and is the
regression you spotted.

## 2. What was restored (commit `2b6dfd8`)

- `app/(auth)/sign-in.tsx` — the chips are gone; **🔐 SSO** and **🏢 Enterprise**
  are live `TouchableOpacity` buttons again (testIDs `sso-sign-in`,
  `enterprise-sso-sign-in`), wired to the original `handleSsoLogin` flow:
  email → `lookup_sso_for_email` RPC (reads `enterprise_domains`) →
  `signInWithSSO({domain})` → browser handoff. If the email's domain has no SSO
  registration the user gets an honest alert ("not registered for SSO — use email
  + password, or contact your administrator") — no dead end, no fake success.
- `scripts/qa/check-manual-payment-posture.mjs` §5 now **fails the build** if SSO
  is ever demoted to a "Coming soon" chip again, and requires both buttons wired
  to the real flow. Guard is green.

**Evidence for your decision, reported as ordered (feature-status honesty):**
Production currently has **zero** SSO registrations — `auth.sso_providers` 0,
`org_sso_connections` 0, `org_sso_domains` 0, `org_scim_tokens` 0, and
`supabase sso list` returns an empty provider list. The backend tables, RPCs and
UI flow all exist and behave correctly; the graceful no-provider path is what any
user will currently hit. I restored the feature rather than reporting it as
never-working because the flow is real and sound — it is *unprovisioned*, not
broken. Provisioning an IdP is a config task, not a code task.

## 3. Finance visual pass (commit `2b6dfd8`)

Backend untouched (it was already correct). Visual upgrades on real data only:

- **Mobile `SettlementDashboard`** (buyer): overall *Settlement progress* card —
  stacked bar (green = paid, blue = confirming, amber = outstanding) with
  "% paid" and a legend; per-job mini progress bars; job titles wrap to 2 lines
  instead of truncating.
- **Web `SettlementSummary`**: the same progress card and per-job bars, so Web
  and iOS/Android read as one product.
- **Dedupe**: the legacy "Recent Transactions" wallet feed duplicated the new
  settlement *Payment History* for buyers — it now renders **for providers
  only**; buyers see a single, coherent payment story.
- No fake charts, no placeholder numbers: every element is computed from
  `my_job_settlement_view` / `my_settlement_activity`. Privacy boundaries
  unchanged (buyers never see payouts/margins; providers never see buyer
  pricing) — `qa:client-privacy` green.

## 4. Regression sweep results

- Only remaining "coming soon" strings: i18n table entries, a comment, the
  owner-ordered payments posture copy, and one **pre-existing** stub —
  `ClientProfileView.tsx:313` ("Settings panel coming soon" alert), which
  predates all release work. Flagging, not changing, per your rule.
- **Web sign-in never had SSO buttons** (pre-existing gap, not cleanup damage).
  Not silently added — your call whether web should gain them this cycle.
- Decorative `pointerEvents` orbs date to May (`314e4e7`) — not cleanup damage.

## 5. Verification (all green)

- TypeScript: mobile `tsc` clean, web `tsc` clean.
- `qa:payments` — 12/12 incl. new "SSO + Enterprise sign-in are live" check.
- `qa:payment-dead-ends` — all Stripe surfaces flag-gated, fail closed.
- `qa:client-privacy` — clean.
- pgTAP battery: 83/83 (1360 assertions) — unchanged since last run; no SQL has
  changed since.

## 6. New finding: store build 8 failed — cause found and fixed (commit `4a841ee`)

EAS iOS build 8 (`c59b97a1`, the Xcode-26 rebuild) **errored**: Apple Clang 21
on the current EAS `latest` image (Xcode 26.4/26.5 — Apple's 2026 submission
toolchain) rejects the `fmt` 11.0.2 library React Native 0.76 pins ("call to
consteval function … is not a constant expression"). Upstream fixed this only on
RN ≥ 0.83.9; SDK 52's RN 0.76 line was never patched.

**Fix committed:** the `fmt` pod now compiles as C++17 (its consteval path is
skipped by fmt's own detection; runtime behaviour identical). Folded into the
existing `withNexpecNitroBuild` Podfile plugin so the C++20 pin can never
clobber it. Ruby validated (`ruby -c`).
**Not yet proven on EAS** — verifying it requires launching a production-profile
iOS build, which I've held at your gate (it would consume build number 9 and is
effectively the next store candidate). It's the first post-approval step.

## 7. What happens on "OWNER UI APPROVED — CONTINUE RELEASE"

1. EAS iOS build from HEAD `4a841ee` (proves the fmt fix; becomes build 9) +
   matching Android build so both stores ship the same corrected HEAD.
2. Verify toolchain stamps (DTSDKName ≥ iphoneos26) + codesign + sha256 → MANIFEST.
3. Final screenshot lock (corrected sign-in + Finance), framing, iPad set.
4. Store package refresh + submission closeout.

## 8. Inspect the corrected screens

Simulator screenshots of the corrected sign-in and Finance screens are in
`07-Owner-Review/screens/` (capture noted below). Web parity can be inspected
with `npm run dev` in `apps/web` → `/client/finance`; web production deploy is
held until after your approval.
