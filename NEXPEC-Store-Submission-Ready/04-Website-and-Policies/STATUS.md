# Website & policies — live status (verified 2026-08-21)

| URL | Status | Used as |
|---|---|---|
| https://www.nexpecapp.com | 200 | Marketing URL |
| https://www.nexpecapp.com/legal/privacy | 200 | Privacy Policy URL (both stores) |
| https://www.nexpecapp.com/legal/terms | 200 | Terms URL |
| https://www.nexpecapp.com/legal/compliance-notices | 200 | Compliance notices |
| https://www.nexpecapp.com/account/delete | 200 | Play account-deletion URL |
| https://www.nexpecapp.com/contact | 200 | Support URL |

Deployment: Vercel project `nexpec-main-platform`, aliased to www.nexpecapp.com,
built from the release branch at the promoted HEAD, embedding the Production
Supabase project only (verified in the served JS bundle). The server round-trips
to Production GoTrue (verified via /auth/callback probe).
