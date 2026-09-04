# NEXPEC 1.0.0 — Store Submission Package (FINAL, owner-approved)

Updated 2026-08-22 · approved HEAD `02d5e62` · UI approved by owner
("OWNER UI APPROVED — CONTINUE RELEASE", 2026-08-22)

Everything in this folder is built from, and verified against, the same
approved commit. The only remaining steps are the console actions that
require your Apple/Google accounts — they are written out step-by-step in
`06-Owner-Only-Actions/OWNER-ACTIONS.md`. Start there.

## What's inside

| Folder | Contents |
|---|---|
| 01-Release-Artifacts | FINAL verified binaries: iOS build 11 IPA + Android versionCode 16 AAB, sha256s and binary-level verification in MANIFEST.txt |
| 02-Apple-App-Store | Field-by-field App Store Connect answers, privacy questionnaire, review notes + demo account, framed 6.9" screenshots (`Screenshots/framed/`), iPad 13" set (`Screenshots/ipad-raw/`) |
| 03-Google-Play | Play Console answers, Data Safety, phone screenshots (`Screenshots/phone/`) |
| 04-Website-and-Policies | Public policy/deletion URLs used by both stores |
| 05-QA-and-Verification-Evidence | Rejection-risk audit, QA matrix, artifact verification, the one open Play risk (16 KB finding) |
| 06-Owner-Only-Actions | **YOUR checklist** — upload/submit steps, one optional SQL cleanup, Stripe re-activation for later |
| 07-Owner-Review | The correction-cycle reports + rendered evidence screenshots you approved |

## Release posture (what ships)
- Manual settlement is the payment experience: buyers see settlement status,
  progress and history; providers see earned/due/paid; admins record every
  movement (audited). No card payments, no TEST MODE, no dead ends.
- The LIVE Stripe integration stays configured but dormant behind
  `online_payments_enabled=false`; activation later is flag-flip only.
- SSO + Enterprise sign-in are live buttons wired to the real flow, with an
  honest message for unprovisioned domains.
