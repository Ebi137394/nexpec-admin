# First-submission rejection-risk audit — 2026-08-21 (final state)

| Risk | Status | Evidence |
|---|---|---|
| Broken reviewer login | ✅ clear | apple_tester login verified live twice (REST + simulator); demo job visible from that account |
| Payment dead ends | ✅ clear | every Stripe CTA flag-gated out of UI (`qa:payment-dead-ends` guard); server returns 403 if reached; full lifecycle proven WITHOUT any charge on live Production |
| TEST MODE visible | ✅ clear | unreachable: no CTA renders, no intent can be minted (flag false, fail-closed functions live since 2026-08-21 17:40Z) |
| Misleading metadata | ✅ clear | listings describe manual settlement; card payment described only as not-currently-offered; no claims of unavailable features |
| Placeholder/test content | ✅ clear | demo job is intentional reviewer content, hidden from public marketplace; no lorem/test screens in artifacts (bundle strings scanned) |
| Unfinished payment UX | ✅ clear | Finance is a real settlement dashboard (contract value / paid / outstanding; earnings due/paid) — coherent product, not a stub |
| UGC without moderation | ✅ clear | in-app report control on every two-party room → staffed support inbox + audit (pgTAP-proven); admin room retirement exists |
| Account deletion | ✅ clear | in-app (Profile→Security) + edge function ACTIVE on Production + public URL 200 |
| Sign in with Apple missing | ✅ clear | present alongside Google/LinkedIn (entitlement in IPA) |
| Permission strings | ✅ clear | 14 substantive NS*UsageDescription strings; contextual requests |
| Privacy declarations mismatch | ✅ clear | labels/data-safety drafted from shipped code (Sentry crash/diag, location, photos, audio, financial-info amounts, IDs) |
| Apple toolchain floor | ✅ VERIFIED | final IPA is build 9 (EAS 9972d5fc): DTXcode 2660 / DTSDKName iphoneos26.5 verified from the binary — meets the 2026 floor. (b7 was Xcode 16.2; b8 ERRORED on fmt/Clang 21, fixed by the C++17 fmt pin proven by b9.) |
| Play targetSdk floor | ✅ clear | v13 manifest targets 35 |
| Play 16 KB pages | ⚠ known open risk | 31/40 arm64 libs 4 KB-aligned (Expo SDK 52 prebuilts). Definitive answer comes from the Internal-testing pre-launch report; fix if blocked = SDK 53 upgrade next cycle. Not resolvable in-config; honestly documented |
| Staging/dev references in binaries | ✅ clear | 0 staging refs, 0 service-role JWTs, Production ref ×1 in both final bundles |
| OTA surprise during review | ✅ controlled | no EAS Update published this release; do not publish while in review |
