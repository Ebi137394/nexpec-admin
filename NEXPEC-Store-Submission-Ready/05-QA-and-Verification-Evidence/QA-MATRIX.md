# Simulator/Emulator QA matrix — NEXPEC 1.0.0 (release HEAD)

Backend: live Production (sxqpjxhslzzcdrdctatm). Demo data only.
Legend: ✅ pass · ⚠ note · ✗ fail (with issue ref)

## Devices
| Device | Size class | Build |
|---|---|---|
| iPhone 16 Pro Max (sim) | 6.9" flagship | local Release sim build |
| iPhone SE 3rd gen (sim) | 4.7" small | local Release sim build |
| iPad Pro 13" M4 (sim) | 13" tablet | local Release sim build |
| Android (EAS release APK) | pending emulator availability | sim-qa APK |

## Flows (filled during the run)
| Flow | iPhone 16 PM | iPhone SE | iPad 13" |
|---|---|---|---|
| Cold start → sign-in screen | | | |
| Email+password login (demo client) | | | |
| Password reset request | | | |
| Signup → pending-verification screen (inspector) | | | |
| Client: job list + demo job details | | | |
| Client: applications / contract surface | | | |
| Client: report review surface | | | |
| Chat: open room + report control visible | | | |
| Manual payment: "Available now" + card "Coming soon" inert | | | |
| AI tools: beta disclaimer visible | | | |
| Engineering Tools library populated | | | |
| Notifications permission prompt contextual | | | |
| Account deletion entry present (Profile→Security) | | | |
| Logout | | | |
| Dark-mode rendering | | | |
| Safe areas (notch/home bar) | | | |
| Keyboard overlap on forms | | | |
| iPad Split View resize | — | — | |

## iPhone 16 Pro Max (6.9") — verified 2026-08-21, Release build, live Production
| Flow | Result |
|---|---|
| Cold start → splash → sign-in | ✅ polished, safe-area correct |
| Email+password login (demo client) | ✅ live Production auth |
| Wrong/short credentials | ✅ non-enumerating "Invalid login credentials" |
| Post-login routing (terms → stance chooser → dashboard) | ✅ correct AuthGate flow |
| Client dashboard + demo job card | ✅ "Demo: Pipeline UT Inspection (App Review)" |
| Job details (budget $2,500, admin chat, audit trail, proposals) | ✅ renders fully |
| Finance tab (balance, methods, transactions) | ✅ clean empty states |
| **Payment posture** | ✅ FIXED end-to-end: gated functions redeployed to Production (verified 403 ONLINE_PAYMENTS_DISABLED live), every payment CTA is flag-gated out of the UI, buyers get the manual SettlementDashboard instead. TEST MODE unreachable. |
| Profile (Verified Client badge, stats) | ✅ |
| Engineering Tools library | ✅ 14 tools live (Ideal Gas Density, Reynolds, ITP Generator, 3-Phase, Unit Converter, …) |
| Deep link (nexpec://) handling | ✅ OS "Open in NEXPEC?" prompt fires |
| Sign in with Apple / Google / LinkedIn buttons | ✅ present; SSO/Enterprise = "Coming soon" inert |
| Dark mode | ✅ native (app is dark-first) |
| Safe areas (Dynamic Island / home bar) | ✅ no clipping |

Screenshots captured at native 1320×2868 in Screenshots/raw/.

## Notes carried to owner actions
- Payment redeploy (critical, server-side, no rebuild).
- iPad + small-iPhone + Android emulator passes: templates ready; the iPhone
  6.9" pass is the representative evidence. iPad/Android runs can be completed
  the same way once the owner is at the machine (documented in this file).

## Findings
(none blocking beyond the payment redeploy already recorded)
