# Google Play Data Safety — draft answers (verified against the shipped app)

## Overview
- Does the app collect or share user data? **Collects: yes. Shares: no** (no
  third-party data sharing; Sentry/Supabase act as service providers).
- Is all user data encrypted in transit? **Yes** (TLS everywhere;
  usesCleartextTraffic=false in the shipped manifest).
- Do you provide a way for users to request deletion? **Yes** — in-app
  (Profile → Security → Delete Account) and
  https://www.nexpecapp.com/account/delete

## Collected data types (all: Collected, Not shared, Required unless noted)

| Play category | Data | Purpose |
|---|---|---|
| Personal info | Name | Account management, app functionality |
| Personal info | Email address | Account management |
| Personal info | Phone number (optional) | App functionality (controlled disclosure) |
| Location | Precise location (optional) | App functionality (site check-in, maps) |
| Photos & videos | Photos | App functionality (inspection evidence) |
| Audio | Voice or sound recordings (optional) | App functionality (chat voice notes) |
| Files & docs | Files and docs | App functionality (CVs, certificates, reports) |
| Messages | In-app messages | App functionality |
| Financial info | Other financial info | App functionality (engagement amounts, manual-payment records; NO card numbers) |
| App info & performance | Crash logs | Analytics/diagnostics (Sentry) |
| App info & performance | Diagnostics | Analytics/diagnostics (Sentry) |
| App activity | Other user-generated content | App functionality (reports, findings) |
| Device or other IDs | User ID | Account management |

## Security practices
- Data encrypted in transit: **Yes**
- Deletion mechanism: **Yes**
- Independent security review: **No** (do not claim)

## Other Play declarations
- Ads: **No ads**
- Target audience: **18+** (professional/business app; not directed at children)
- News app: No · COVID app: No · Government app: No
- Financial features: **None to declare** — the app does not provide loans or
  regulated financial products; it records offline manual payments for
  real-world professional services. ⚠ OWNER/LEGAL: confirm this reading of the
  Play "Financial features" questionnaire before submitting.
- UGC declaration: **Yes** — users can communicate; in-app reporting +
  staffed moderation + admin room retirement exist (evidence: report control on
  every two-party conversation, audited moderation RPC).
