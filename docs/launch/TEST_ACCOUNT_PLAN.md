# NEXPEC — Staging Test-Account Plan

Accounts for staging QA. **No passwords in the repo** — create them in the Supabase Auth dashboard (Add user, Auto-Confirm) or via your sign-up flow, and keep passwords in your own password manager. Fixtures below describe the data each account must contain so the manual checklists exercise real states.

**Never run these against production.** Use the staging Supabase project.

| # | Account (email suggestion) | Role | Fixtures it must contain |
|---|---|---|---|
| 1 | `qa.inspector.clean@staging.nexpec` | inspector | verified profile, avatar + résumé uploaded, **no** active jobs, wallet = 0, no disputes → should DELETE cleanly |
| 2 | `qa.inspector.busy@staging.nexpec` | inspector | 1 job with `status='open'/'assigned'` as `contractor_id` → deletion must be **blocked** `ACTIVE_JOBS` |
| 3 | `qa.client@staging.nexpec` | client | 1 posted job, 1 invoice `status='pending_review'` → deletion blocked `OPEN_INVOICE`; a clean variant with no obligations to test success |
| 4 | `qa.supplier.clean@staging.nexpec` | supplier | supplier profile, no contracts/quotes, earnings = 0 → deletes cleanly |
| 5 | `qa.supplier.busy@staging.nexpec` | supplier | 1 `supplier_contracts` row `status='executed'` (or a `supplier_quotes` `status='submitted'`) → blocked `SUPPLIER_ACTIVE_CONTRACT` / `SUPPLIER_OPEN_QUOTE` |
| 6 | `qa.agency.owner@staging.nexpec` | agency | owns 1 `organizations` row (`owner_id`) + `org_members` role `owner` → blocked `ORG_OWNERSHIP_TRANSFER_REQUIRED` |
| 7 | `qa.enterprise.member@staging.nexpec` | enterprise | member (non-owner) of an org, 1 job as client → tests enterprise portal + clean delete |
| 8 | `qa.admin@staging.nexpec` | admin | admin console access → self-delete must be **refused** `ADMIN_NOT_SELF_DELETABLE` |
| 9 | `qa.superadmin@staging.nexpec` | super_admin | full admin; used for last-super-admin test (keep ≥2 super_admins so demotion of one is allowed, of the last is blocked) |
| 10 | `qa.owner@staging.nexpec` | super_admin + **Platform Owner** | seed as owner via `seed_platform_owner()` → all delete/demote/suspend paths **refused** `PLATFORM_OWNER_PROTECTED` |
| 11 | `apple_tester@nexpec.com` | inspector (reviewer) | pre-seeded inspector profile + sample jobs + chat threads (via `supabase/seed_apple_reviewer.sql`); can reach Delete Account but **do not** delete it |
| 12 | `play_reviewer@nexpec.com` | inspector (reviewer) | same as #11 for Google Play |

## Option A — manual setup (recommended for staging)
1. Supabase (staging) → Auth → Add user for each (Auto-Confirm ON). Save passwords in your manager.
2. Sign in as each and build the fixtures through the app (post a job, submit a quote, etc.), OR
3. Use the app's admin tools to set roles, then create the money/contract fixtures through normal flows.

## Option B — seed helpers (safe, staging only)
- Reviewer accounts: `supabase/seed_apple_reviewer.sql` (already in repo).
- The **negative** fixtures (active job, open invoice, executed supplier contract, org ownership) are best created through the app so they pass all constraints/triggers. If you want a SQL seed, write it against the staging project only and gate it behind a `WHERE current_database() <> 'production'`-style guard.
- The deletion-guard assertions themselves are covered by `docs/launch/STAGING_VERIFICATION_TESTS.sql` (creates throwaway fixtures inside a rolled-back transaction — no permanent data).

## Guardrails
- Passwords: **never** commit. Not in these docs, not in seed files.
- Reviewer credentials: share out-of-band (store review notes field), not in the repo.
- Run everything against **staging**; confirm the Supabase project ref is the staging one before any seed.
