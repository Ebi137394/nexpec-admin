# Runtime smoke checklist — release hardening 304000 → 316000

Run **after** `bash scripts/qa/final-release-validation.sh` reports
`ALL FINAL RELEASE VALIDATION PASSED`. Everything below needs a running app and
a human; the automated probes in step 8b only prove the relation and columns
exist, not that each screen renders.

The single failure mode to watch for: **a financial screen that silently renders
empty or zero instead of erroring.** Migration 312000 moved 25 pricing queries
from `public.jobs` to `public.jobs_secure_view`, whose row filter is
`client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin()`. If a screen
goes blank, the caller is almost certainly not one of those three.

| # | Surface | Sign in as | Expect | Would indicate |
|---|---|---|---|---|
| 1 | Client dashboard (`app/(client)/index.tsx`, `ClientDashboard.tsx`) | client | job counts and spend populated | blank ⇒ view row filter wrong for this client |
| 2 | Client job detail + applicants (`app/(client)/jobs/[id]/applicants.tsx`) | client | job price shown, applicants listed | price missing ⇒ redirect missed a query |
| 3 | Agency pricing (`app/(agency)/jobs/[id].tsx`) | agency | client price visible on their own job | blank ⇒ `agency_id` branch of the filter failing |
| 4 | Admin jobs list + financial (`app/(admin)/jobs/index.tsx`, `financial.tsx`, `live-radar.tsx`) | admin | every job, spread and margin visible | blank ⇒ `nx_is_admin()` not resolving inside the view |
| 5 | Inspector available jobs (`useJobs` step 1) | inspector | open jobs listed with **their** payout | error ⇒ a revoked column is still requested |
| 6 | Inspector active missions (`useJobs` step 3) | inspector | assigned jobs listed | empty ⇒ projection lost `contractor_id` |
| 7 | Inspector job detail (`app/(inspector)/jobs/[id]/index.tsx`) | inspector | job renders; **no** client price anywhere | any client price ⇒ blocker, stop |
| 8 | Meetings (`MeetingsPanel`, web + mobile) | admin, then inspector | admin can schedule; inspector sees no Schedule button and no "Invite Client" | inspector sees Schedule ⇒ 304000/`canSchedule` regressed |
| 9 | Direct assignment (admin job page) | admin | search finds a verified inspector; assign succeeds; client sees an ordinary application | any "admin assigned" wording client-side ⇒ blocker |
| 10 | Admin self-assignment | admin | admin appears with **You** chip; reason required (≥10 chars); assignment succeeds; admin can then open the job's inspector surfaces | admin gains inspector access to *other* jobs ⇒ blocker |

## Inspector price-blindness spot check (do this one manually)

Signed in as an inspector, in the browser console:

```js
// MUST fail with a permission error, not return data
await supabase.from('jobs').select('client_price_cents').limit(1);
await supabase.from('jobs').select('*').limit(1);
// MUST return zero rows
await supabase.from('jobs_secure_view').select('id').limit(1);
// MUST succeed — the inspector's own payout
await supabase.from('jobs').select('id, inspector_payout_cents').limit(1);
```

## Client-invisibility spot check

As the **client**, on a job that was directly assigned or self-assigned:

- the applications list shows one ordinary application
- the notification reads "New inspector application"
- no badge, label or wording anywhere mentions admin/direct/self assignment
- `await supabase.from('application_assignment_origin').select('*')` returns **zero rows**
