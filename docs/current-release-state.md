# NEXPEC — Current Release State

**Updated at HEAD `a1fcd7e`** · branch `release/identity-replacement` · **PUSHED to origin**

> Push succeeded on retry: `95a9bcd..a1fcd7e`. The 8 commits below are on
> `origin/release/identity-replacement`. The §1 and §9 push rows below are kept as the
> historical record of the blockage; origin is current as of this line.

> Physical repository is the source of truth. Verify HEAD, status, migrations and
> origin divergence before editing. Do not trust this file blindly.

---

## 1. Git state

| Fact | Value |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `43cb911` |
| Behind origin | 0 |
| **Ahead of origin (unpushed)** | **7** |
| Tracked working tree | clean |
| Untracked | `.claude/settings.json`, `.claude/CLAUDE.md`, `.claude/skills/graphify/**` (all deliberate — see §6) |

### Commits this wave, oldest first

| Commit | Slice | Contents |
|---|---|---|
| `3e0d6c7` | pre-existing | frozen P1 contract addendum + graphify hygiene |
| `162fd53` | Lane 4 | canonical `cover_note`/`bid_amount_cents` writer fix (product code) |
| `f9bb0c5` | Lane D | `434000` credential authority + pgTAP (`plan(31)`→`plan(36)` corrected) |
| `a5ca759` | Lane B | `430000` append-only review history + TRUNCATE guard + self-test I4b |
| `d3e2c37` | config | five-tier effort routing (`.claude/` + `CLAUDE.md`) |
| `e03c8e8` | Lane 3 | **CRITICAL** anon RLS-bypass / privilege-escalation lockdown |
| `43cb911` | docs | evidence-backed phase inventory |

Product, migration, test and configuration slices are kept in separate commits.

---

## 2. SQL runtime — the final external blocker

**`PENDING MAC`.** `pg_isready` fails; no Docker daemon; no Supabase container.

Consequences, which must not be softened in any report:

- All **156 migrations** are **DB-side UNVERIFIED**. None is known to have been applied.
- Every in-migration `DO $selftest$` block is **UNEXECUTED**.
- All pgTAP suites are **UNEXECUTED**, including `434000`'s 36 assertions and Lane 3's 38.
- Static SQL guards are **not** runtime validation and must never be reported as such.

## 3. Tests actually executed at this HEAD

| Command | Exit | Note |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | 0 `error TS` lines. **This is the one that covers root/mobile code.** |
| `npm run typecheck` | 0 | ⚠️ `--workspaces` runs **only** `@nexpec/shared-core`; it does **not** cover the repo root |
| `npm run qa:db-refs` | 0 | 240 RPCs + 172 relations |
| `npm run qa:sql-schema` | 0 | 12 known baseline defects tracked in `known-sql-schema-defects.json` |
| `npm run qa:rls-admin` | 0 | 180 RLS tables · 153 admin-covered · 14 allowlisted |

Not re-run this wave (belong to earlier HEADs): `itpReplay` 19/19, `visitReplay` 22/22, ML 43/43.
Deno was unavailable — **no** Edge Function typecheck has been performed.

---

## 4. CLOSED P0 — payment contract violation — fixed by `20260801444000`

**`trg_credit_inspector_on_confirm`** — `baseline:27638`, was attached to `public.jobs`,
`AFTER UPDATE OF admin_confirmed_at`, executing `tg_credit_inspector_on_confirm()`
(`baseline:18896`, `SECURITY DEFINER`), which calls
`credit_inspector_earning_on_approval(NEW.id)`. **Detached by
`20260801444000_detach_credit_inspector_on_confirm.sql`.**

**The previously unverified body is now resolved.** `20260801140000:38` issues
`CREATE OR REPLACE` on `credit_inspector_earning_on_approval(uuid)`, superseding
`baseline:7519`. That is the **final** definition in the repository — no later migration
redefines it (`20260801374000` only names it in a comment) — and there is exactly one
signature, `(p_job_id uuid)`. No overloads. Effective ledger effect: credits
`wallets.available_balance` (prepay) or `wallets.pending_amount` (net terms), plus
`total_earned`, and inserts a `transactions` row of `type='earning'`. Idempotent per
(job, inspector). `SECURITY DEFINER`, `OWNER postgres`, `search_path` already pinned.

**A second, independent defect was found while verifying it.** `baseline:33358`
`GRANT ALL ON FUNCTION credit_inspector_earning_on_approval(uuid) TO anon` was still
live — the Lane 3 sweep (`20260801442000`) revoked anon **default privileges** on
FUNCTIONS, which does not touch grants already materialised on existing objects. The
in-function guard is fail-**open** for exactly that role:
`IF auth.uid() IS NOT NULL AND NOT nx_is_admin()` — anon has `auth.uid() IS NULL`, so
the guard is skipped entirely. The function was therefore reachable unauthenticated via
`POST /rest/v1/rpc/credit_inspector_earning_on_approval`. Constrained (needs a leaked job
UUID, `admin_confirmed_at` set, payout > 0, no prior earning row) but a genuine
unauthenticated money-movement path.

What `20260801444000` does: detaches the trigger; revokes anon + PUBLIC on both functions
while retaining `authenticated` and `service_role`; re-pins `search_path`; replaces the
wrapper so it no longer swallows exceptions and raises if ever re-attached (preserved, not
dropped); adds a fail-closed anon-role rejection inside the money function; and installs a
**behavioural** regression guard that walks each attached trigger's call closure for money
DML rather than matching a literal name list. The name-based guards in `20260801372000`
and `20260801432000` could not have caught this — the name was on neither list — and a
body-only scan could not either, because the attached wrapper contains no money DML of its
own, only a call to the function that does.

**Runtime status.** The migration was executed end-to-end on a real PostgreSQL 18.4 during
authoring, against a stub schema reproducing the pre-fix state exactly (baseline body, live
anon grant, attached trigger): applied with `ON_ERROR_STOP=1`, exit 0, in-migration selftest
block passing, idempotent on re-apply, and all 11 assertion predicates from
`supabase/tests/credit_inspector_detach_test.sql` evaluating true afterwards. The guard was
separately shown to flag the real defect shape and clear once detached, with no false
positive on an inert trigger. **This is not full-chain validation** — the 157-migration
chain and pgTAP still require a real Supabase; SQL runtime remains **PENDING MAC**.

Lane 5 staged funding may now build on a surface with no automatic Inspector credit.

### Also open, from Lane 3's reported-not-fixed section
- `consent_receipt_status` returns **every** user's consent records to every caller
  (needs a view redefinition, not a grant change)
- `get_or_create_wallet(uuid)` — definer, no pinned `search_path`, anon EXECUTE, takes
  a user id as an **unchecked parameter**
- 31 anon-reachable definer functions without pinned `search_path`, **7 mutating**,
  including `approve_job_and_pay` and `process_withdrawal`
- Possible **prepay deadlock**: `create-payment-intent/index.ts:192` refuses a
  PaymentIntent without `admin_confirmed_at`; `20260801422000:145-149` refuses dispatch
  without `client_settled_at`, deliberately without a service_role exemption. Static
  reading only — needs real Postgres to confirm or dismiss.
- **Lane B has no pgTAP suite.** `addendum:87` contracts `tests/*report_review*`; `430000`
  ships none. Lane D correctly shipped its own.

---

## 5. Migration allocation (central — do not self-allocate)

| Number | Lane | State |
|---|---|---|
| `430000` | B | committed `a5ca759` |
| `434000` | D | committed `f9bb0c5` |
| `436000` | — | pre-existing `inspector_certifications` lockdown |
| `442000` | 3 | committed `e03c8e8` |
| `438000`, `440000`, `444000` | — | **free** (444000 never needed — `cover_note` exists in baseline) |
| `446000` | 5 | **reserved, unused — Lane 5 never started** |

**Next free block for new lanes: `448000` onward.**

---

## 6. Deliberate tracking decisions — do not "fix" these

- `.claude/settings.json` — **untracked on purpose**; its hooks change collaborator behaviour
- `.claude/skills/graphify/**` — untracked; regenerable via `graphify install`
- `.claude/settings.local.json` — already tracked (pre-existing)
- `graphify-out/` — gitignored build output; `.graphifyignore` + `CLAUDE.md` are tracked source
- Six worktrees under `~/.cursor/worktrees/NEXPEC/` are **stale Cursor leftovers** at
  `57c6c41` ("Initial Commit", 532 commits behind), all clean. **Not agents.** Leave alone.

---

## 7. Effort routing (config, `d3e2c37`)

| Level | Mechanism | Automatic? |
|---|---|---|
| `medium` | `effort-routine` skill | Yes |
| `high` | `effort-standard` skill | Yes |
| `xhigh` | `effort-critical` skill + `deep-investigator` agent | Yes |
| `max` | `effort-max` skill | Yes |
| `ultracode` | `/effort ultracode` or `--effort ultracode` | **No — session-level only** |

Desktop runtime is claude-code **v2.1.227**; the npm CLI at 2.1.170 is a stale side-install.

---

## 8. Next steps, in order

1. **Payment-trigger audit** — detach `trg_credit_inspector_on_confirm` via a forward
   migration; audit by *behaviour*, not name; add a behavioural guard that fails on any
   future automatic-money trigger. Commit separately.
2. **Lane B pgTAP suite** — the contracted `tests/*report_review*`.
3. **Lane 5** — configurable 20/80 staged funding, on migration `446000`, only after (1).
4. Wave 2 parity / red team, then phases 7–14 per the roadmap.

## 9. Blocked on owner (permission-gated, not technical)

- **`git push`** — denied by the permission classifier on every attempt. 7 commits waiting.
- **Agent launches** — denied for Lane 5.
- **`git`/`grep` via Bash** — intermittently denied, interrupting verification mid-flight.

Bash permission rules for `git` and `grep` would clear all three. Per owner directive,
permissions were **not** altered to evade the classifier.

## 10. Production

**Not deployed. Not authorized.** Requires, in order: explicit owner authorization →
Production DB backup → verified migration history → SQL runtime green → Golden Paths →
rollback review.
