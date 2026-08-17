# QA Owner-Review Inventory

Staging project: `zmzvmgaeovleuvbvwxei` · Preview: see `RELEASE-QUALIFICATION-CHECKPOINT.md`
(anonymous access is SSO-protected; use your authenticated Vercel session).
QA accounts: `qa.client@` / `qa.inspector@` / `qa.talent@` / `qa.senior@nexpec.test`
(passwords are the standing QA credential you hold — never committed here).
No passwords, bypass secrets or tokens appear in this file.

All money is synthetic (`manual:QA-OWNER-…` references). Client price $1,000.00,
inspector payout $800.00, spread $200.00, 20/80 = $200/$800 on every fixture.

| Fixture | Job ID | State | Inspect as | Web route |
|---|---|---|---|---|
| **STRICT** | `6a1c1421-aa42-4b4e-a065-74293dc5034c` | report **delivered**, both tranches funded, payout **unpaid** | Client | `/client/jobs/6a1c1421-aa42-4b4e-a065-74293dc5034c/release` |
| **NET15 (overdue)** | `6ae29ef1-6f95-4685-8559-420b50043886` | delivered on credit; invoice due date is in the past | Client/Admin | `/client/jobs/6ae29ef1-6f95-4685-8559-420b50043886/release` + finance surfaces |
| **NET30** | `6c27e5d9-217d-4273-8431-2132c82a9e87` | delivered on credit, invoice open (due +30d) | Client/Admin | same pattern |
| **NET60** | `2eb718ec-7463-4b02-91bf-64b72cb991e2` | delivered on credit, invoice open (due +60d) | Client/Admin | same pattern |
| **DISPUTE** | `6bf4ce63-0045-42c0-9ba5-24779f52fbbb` | dispute filed by client, **resolved `completed`** by super_admin; resolver+timestamp+notes on the record | Admin/Owner | admin job view / disputes |
| **IDENTITY-PROTECTED** | `9bf34e94-f0cf-4aef-b800-c79c63865cab` | forwarded application, `identity_mode=protected` | Client | `/client/jobs/9bf34e94-f0cf-4aef-b800-c79c63865cab/applications` |
| **IDENTITY-PROFESSIONAL** | `6b668186-4bc7-4129-a9be-9325e20cf06f` | forwarded, `professional` | Client | same pattern |
| **IDENTITY-FULL** | `e9b281c4-edfc-46b0-bb27-445e6f775c6c` | forwarded, `full` | Client | same pattern |
| **COMPLIANCE** | `5481d15e-dbf1-4fef-9d9a-551ee0b5a500` | dispatched + started for **qa.talent**; API 510 template | qa.talent (mobile) | mobile: dashboard mission → capture wizard |

**Messaging room** (STRICT job): conversation `d9c35371-5cc2-4b63-afc6-146ccd422afb` —
3 messages: client → inspector → **NEXPEC admin mediation**. Admin view:
`/admin/communications/direct/d9c35371-5cc2-4b63-afc6-146ccd422afb`.

**Media** (STRICT report): `inspection-photos/…/owner-review/evidence.png`
(sha256 prefix `0a64b890a8453691`) and
`chat_attachments/…/owner-review/voice-note.wav`. Report carries an external
HTTPS link to the API 570 certification page.

## What to click and expect

1. **STRICT release page** (as Client): the delivered findings render
   ("OWNER-REVIEW: UT survey complete… CML-27…"), price shows **$1,000.00**,
   and neither $800 payout nor $200 spread appears anywhere.
2. **NET15**: finance shows the outstanding $800 with an overdue due date —
   and the delivered report REMAINS accessible.
3. **Identity trio** (as Client, applications page):
   * PROTECTED — NX handle only; no name/email/phone.
   * PROFESSIONAL — "QA Talent Candidate" + professional data; no email/phone.
   * FULL — name + email (+ phone when set on the profile).
4. **DISPUTE** (as Admin): resolved record shows resolver, timestamp,
   resolution notes; job is `completed`; a second resolution is refused.
5. **Mobile TFLite** (as qa.talent on the emulator/simulator): open today's
   mission (QA-OWNER-REVIEW-COMPLIANCE) → capture wizard → photo → the AI
   Co-Inspector panel analyses on-device.

## Identity note
Fixtures built after `qa.inspector` correctly hit the **daily application
limit (6/24h)** — a real guard, so the identity/compliance fixtures use
`qa.talent` (also inspector role) as applicant.

Cleanup is deferred until you reply: `OWNER REVIEW COMPLETE — CLEAN QA FIXTURES`.
