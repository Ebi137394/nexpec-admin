# Apple Privacy Nutrition Labels — draft answers (verified against the shipped app)

**Tracking:** NO data used to track users across apps/websites. No ads, no ad
SDKs, no AdSupport/ATT — do not declare tracking.

## Data types COLLECTED (all "Linked to you" — the app is account-based)

| Category | Type | Purpose | Notes (evidence) |
|---|---|---|---|
| Contact Info | Name | App functionality | profile full_name |
| Contact Info | Email address | App functionality | account identity; auth |
| Contact Info | Phone number | App functionality | optional profile field; disclosed to counterpart only in Full identity mode |
| User Content | Photos or videos | App functionality | inspection photos/evidence uploads |
| User Content | Audio data | App functionality | voice notes in chat (mic permission) |
| User Content | Other user content | App functionality | messages, reports, CVs/certifications |
| Identifiers | User ID | App functionality | Supabase auth UUID |
| Location | Precise location | App functionality | job-site map / on-site arrival; requested contextually |
| Financial Info | Other financial info | App functionality | engagement amounts & manual-payment records (no card numbers — card payments disabled) |
| Diagnostics | Crash data | Analytics (app functionality) | Sentry runtime crash reporting |
| Diagnostics | Performance data | Analytics (app functionality) | Sentry performance traces |

## NOT collected (do not declare)
Browsing history, search history outside the app, contacts, health, fitness,
sensitive info categories, purchases history (no IAP), advertising data.

## Privacy questions
- Data used for tracking: **No**
- Data linked to identity: **Yes** (all of the above — account-based app)
- Data used for third-party advertising: **No**

⚠ OWNER/LEGAL CONFIRMATION: these labels are drafted from the shipped code and
backend. Legal should confirm the Financial Info and Location rows match the
final privacy policy wording before submission.
