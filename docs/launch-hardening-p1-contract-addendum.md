# P1 Contract — Addendum B (parallel waves)

Frozen by the Lead at HEAD `95a9bcd`. Supplements `launch-hardening-p1-contract.md`.
No agent may alter either file. If the contract looks wrong, STOP and report.

## Central migration allocation — do not deviate

Used: `420000 422000 424000 426000 428000 430000(WIP) 432000 434000(WIP) 436000`

| Number | Owner | Scope |
|---|---|---|
| `430000` | Lane B | report review history — REVISE the existing WIP file in place |
| `434000` | Lane D | credential authority — REVISE the existing WIP file in place |
| `438000` | Lane D | only if the reconciliation genuinely needs a second migration |
| `440000` | Lane B | Senior Review state machine |
| `442000` | Lane 3 | anon-grant lockdown |
| `444000` | Lane 4 | cover-letter pipeline, only if a DB change is truly required |
| `446000` | Lane 5 | staged funding 20/80 |

A lane needing no migration **returns its number unused** and says so. That is a success.

`430000` and `434000` are WIP and **not known to have been applied anywhere**
(DB status UNVERIFIED — no Postgres available). They may be revised in place for
that reason only. Before any production apply: verify migration history and take
a database backup.

## Frozen: report review state

Review state lives at **report level**, never on `jobs.status`. `jobs_status_check`
permits exactly: `pending_approval, open, assigned, in_progress, completed, paid,
cancelled, disputed`. Do **not** widen it. `request_senior_review` currently writes
`status = 'senior_review'`, which is not in that list, so it raises 23514 on every
call — that is the defect to fix, not a precedent to follow.

## Frozen: the brokered Senior Review sequence

```
Inspector submits report
  → Admin routes to an authorized Senior Inspector
  → Senior Inspector approves OR returns with comments
  → Admin performs final delivery to Client
```

A Senior Inspector must **never** deliver to the Client directly. Admin brokerage is
preserved end to end. Senior Review is a **capability/assignment**, not a new global
role. Reuse `technical_approved` / `financial_approved` status-only semantics —
do not repurpose them.

## Frozen: staged funding (supersedes 50/50)

Owner decision — canonical commercial default, **configurable**, not hard-coded:

- **20%** funded before inspector assignment / work authorization
- **80%** after report review completes, **before** the final signed report reaches the Client
- Settlement and inspector payout remain **manually controlled by Admin**
- **Zero** automatic payout, refund, report-triggered, visit-triggered, or ITP/QCP-triggered settlement

The existing 30% deals path (`20260801156000`: "HYBRID FUNDING: hold the 30%
mobilization deposit now") is to be **reconciled into one configurable spine**, not
duplicated and not deleted. No Payment v2. No second ledger.

Privacy: Client sees its own funding schedule. Inspector sees only authorized payout
terms. Platform margin/spread is never exposed to either.

## Frozen: standing constraints (all lanes)

- No V2 of anything. Extend, or stop and explain why you cannot.
- No payment automation. Payout is manual.
- No price leakage: `client_price_cents` / `inspector_payout_cents` /
  `platform_spread_cents` / `base_price_cents` never cross to the wrong party.
- Every `SECURITY DEFINER` sets `search_path = public, pg_temp`; `REVOKE ALL FROM PUBLIC, anon`.
- RLS on for any new table; no INSERT/UPDATE/DELETE grant to `authenticated` on evidence/history tables.
- pgTAP house style: `gen_random_uuid()` only, never a hard-coded UUID, never
  `ON CONFLICT DO NOTHING`; a `profiles` insert after `auth.users` MUST use
  `ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`.
  Assert your own cleanup.
- **No agent commits.** No `git commit/add/push/checkout`. The Lead integrates.
- SQL is unexecutable here (no Postgres, no Docker). Mark every suite
  `SQL RUNTIME VALIDATION = PENDING MAC`. Never report a SQL test as passing.
- Node 18 is default and too old; use `export PATH="/opt/homebrew/opt/node@26/bin:$PATH"`.

## Disjoint file ownership

| Lane | Owns (writes ONLY these) |
|---|---|
| D credentials | `migrations/20260801434000_*`, `migrations/20260801438000_*`, `tests/*credential*`, `rollback/2026080143{4,8}000_*` |
| B report+senior | `migrations/2026080143{0,40}000_*`, `tests/*report_review*`, `tests/*senior*`, `rollback/2026080144?000_*` |
| 3 anon grants | `migrations/20260801442000_*`, `tests/*anon*`, `rollback/20260801442000_*` |
| 4 cover letter | `migrations/20260801444000_*`, `lib/data/jobApplications.ts`, `lib/data/dispatchQueue.ts`, mobile `src/core/hooks/useJobs.ts` |
| 5 funding | `migrations/20260801446000_*`, `tests/*funding*`, `rollback/20260801446000_*` |
| 7 phase inventory | READ-ONLY — writes nothing |
| 8 test/migration review | READ-ONLY — writes nothing |

`inspection_reports`: Lane 3 owns its **grants**; Lane B owns its **triggers and
review logic**. Different statements, no overlap. Neither touches the other's.
