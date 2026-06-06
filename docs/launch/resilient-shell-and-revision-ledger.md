# NEXPEC Resilient Shell + Commercial Revision Ledger — Release Runbook

Two changes ship together here:

1. **Resilient portal shells** — root-causes the intermittent full-screen `500` on
   authenticated routes (first reported on `/client/jobs/[id]`).
2. **Commercial Revision Ledger** — migration `20260801129000`, the formal
   admin-arbitrated price-revision flow on the brokered-deal agreements spine.

**Safety profile:** the web change is additive (one new helper module + guarded
reads in four layouts). The migration is **additive + idempotent** — no
`DROP TABLE` / `TRUNCATE` / `DELETE` / `DROP COLUMN`; the only `DROP`s are
`TRIGGER` / `POLICY` / `FUNCTION` immediately recreated. Money stays a **ledger**.

---

## 1. The web fix — why the shell was 500-ing

The authenticated portal layouts (`admin`, `client`, `inspector`, `(marketplace)`)
`await` Supabase reads on every render — `auth.getUser()`, the `profiles` role
lookup, and (client) the org-switcher fetch. Their inline guards only inspected
the result's `{ error }` field. A genuine **promise rejection** (cold connection
pool, TLS reset, dropped fetch) propagated uncaught and `500`'d the whole layout.

Because **a throw in a layout escapes every child `error.tsx`**, it landed on the
global `500` page — which is why the contained error boundary alone never caught
it. Signature: "renders fine, then 500s, retry clears it."

**Fix:** `apps/web/src/lib/supabase/resilient.ts` adds `runWithRetry` (retry a
rejected read with short linear backoff, *without* touching the `{ error }`
field — query errors stay the caller's concern) and `runSafe`. Both layouts'
`getUser` + `profiles` reads are wrapped; persistent failure **degrades
gracefully** (auth → sign-in redirect; profile → owner-by-email allow-list)
instead of crashing. `fetchActiveOrgInfo` was hardened the same way, and a
contained `app/client/jobs/error.tsx` boundary surfaces the real error + a
one-click retry for anything thrown *below* the layout.

| Commit | What it lands |
| --- | --- |
| `75aab93` | `app/client/jobs/error.tsx` — contained error boundary (shows the real error + retry) |
| `e0d2dd9` | harden `fetchActiveOrgInfo` against transient rejects |
| `2536e64` | `resilient.ts` + retry-wrap `client` & `admin` layouts |
| `1f02d4e` | extend the same hardening to `inspector` & `(marketplace)` layouts |

Verified clean: `tsc -p apps/web/tsconfig.json` (no new errors) + `next lint` on
all touched files. Vercel auto-builds on push to `main`.

---

## 2. The migration — `20260801129000_commercial_revision_flow`

Lands the Commercial Revision Ledger: `deal_revisions` (the case) +
`deal_revision_events` (immutable sealed timeline) + RLS keyed to
`counterparty_id = auth.uid() OR nx_is_admin()`, and the RPCs
`request_price_revision` / `admin_counter_revision` / `admin_decide_revision` /
`respond_to_counter` / `withdraw_revision`, plus the internal `_apply_revision`
that supersedes the leg at the agreed figure (reusing the spine's
version/`supersedes_id`). Price-blindness preserved: a client case lives entirely
in client-price domain, a supplier case in supplier-cost domain.

**Prerequisites (already on prod):** `deals`, `agreements`,
`agreement_signatures`, `deal_payment_schedule`, `deal_money_legs`, the
`_brokered_*_md` templates, `notify_safe` (6-arg), `nx_is_admin`,
`extensions.digest` — all from `127000`–`128000`.

**Pre-flight notes:**

- Transactional (`BEGIN`/`COMMIT`); idempotent (`CREATE TABLE/INDEX IF NOT
  EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` on triggers/policies).
- Every `GRANT`/`REVOKE` arg-type list matches its function definition. In
  particular `_revision_log` is granted on the **7-arg** signature
  `(uuid,uuid,text,text,bigint,text,text)` — the 6-vs-7 mismatch that aborted an
  earlier attempt is corrected (`c10c7ab`).
- All functions are single-arity `CREATE OR REPLACE` → no overload-ambiguity risk.
- Section 9 self-tests assert the two tables, six functions (by exact signature),
  and a price-blindness column guard. A failed invariant `RAISE EXCEPTION`s and
  **aborts the transaction** — so a recorded migration *is* proof the self-tests
  passed and the objects exist.

---

## 3. Deploy steps

### 3a. Codebase → GitHub → Vercel

```bash
cd ~/Desktop/nexpec
git push origin main          # no-op if the host already synced
git ls-remote origin main     # should print 1f02d4e… (confirms GitHub has it)
```

Then confirm Vercel shows a deployment built from `1f02d4e`.

### 3b. Database → Supabase prod (run from a machine with the CLI + linked project)

```bash
cd ~/Desktop/nexpec
supabase migration list       # confirm 129000 is the only pending (or already applied)
supabase db push              # transactional; self-tests gate success
```

`brokerage_setup.sql` is skipped by design (non-timestamped helper, not a
migration).

**Success looks like** either the apply notice
`Commercial Revision Ledger OK: …` on first apply, **or**
`Remote database is up to date.` if `129000` is already recorded — both confirm
the ledger is live.

---

## 4. Rollback

The migration is atomic — any failed self-test rolls the whole transaction back
(no partial state), leaving `129000` unrecorded so a re-run is safe. The web
change is a forward-only safety improvement; to revert, `git revert` commits
`1f02d4e 2536e64 e0d2dd9 75aab93` and redeploy.

---

## 5. Deploy record

- **2026-06-06** — commits `75aab93 e0d2dd9 2536e64 1f02d4e` confirmed in
  `origin/main`; Vercel auto-build triggered.
- **2026-06-06** — `supabase db push` reported **"Remote database is up to
  date"** → migration `20260801129000` recorded as applied on prod. DB +
  codebase in sync.
