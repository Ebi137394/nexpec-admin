# Launch Hardening P1 — Frozen Contract (Lanes A–F)

Frozen by the Lead at HEAD `0813dd1`. No agent may alter this file. If a lane
believes the contract is wrong, it stops and reports; it does not redesign.

Classification is **targeted**, not a repo-wide audit. Every claim below is
backed by a grep or a read at this HEAD.

**Categories:** A genuinely missing · B live defect · C superseded/dead legacy ·
D optional, or already available via canonical architecture.

---

## Migration numbers — centrally allocated

Highest applied number is `20260801426000`. Free range begins `20260801428000`.

| Number | Lane | Scope | Required? |
|---|---|---|---|
| `20260801428000` | A | retire the dead `client_invoiced_at` | yes |
| `20260801430000` | B | report status history | yes |
| `20260801432000` | C | payout state clarity (read-only surfacing) | **probably not — see C** |
| `20260801434000` | D | credential authority reconciliation | yes |
| `20260801436000` | E | applications status casing | **probably not — see E** |
| `20260801438000` | F | ops queue | **no — see F** |

Forward-only. Never edit an applied migration. A lane that concludes it needs
no migration **returns its number unused** and says so — an unused number is a
success, not a failure.

---

## Lane A — Timestamps · **much smaller than assumed**

I checked every lifecycle timestamp for a canonical writer. Most have one.

| Column | Writer | Verdict |
|---|---|---|
| `jobs.started_at` | `inspector_start_job` — `started_at = COALESCE(started_at, now())` | ✅ fine |
| `jobs.contract_generated_at` | 1 writer | ✅ fine |
| `jobs.moderation_reviewed_at` | 3 writers | ✅ fine |
| `jobs.admin_confirmed_at` | 1 writer, 64 mentions | ✅ fine |
| `jobs.client_settled_at` | `settle_client_payment` + `nx_stripe_settle_job` | ✅ fine |
| `jobs.payout_paid_at` | 1 writer (manual mark-paid) | ✅ fine |
| `jobs.cancelled_at` | 5 writers | ✅ fine |
| `job_inspectors.assigned_at` | `NOT NULL DEFAULT now()` — 376000:50 | ✅ fine |
| **`jobs.client_invoiced_at`** | **none — zero assignments anywhere** | **C — dead** |

**The one real finding.** `client_invoiced_at` has exactly three occurrences in
the entire migration tree: its own column definition (baseline:3719), an entry
in an audit redaction list (294000:88), and a comment I wrote in 422000
explaining why the funding gate could not use it. Nothing has ever written it.
It is a column that looks like net-terms invoicing state and is not.

**Smallest fix:** do not add a writer — retire it. `COMMENT ON COLUMN` marking
it non-authoritative, and a self-test asserting no writer appears later. Do
**not** drop it (destructive; it may hold hand-written production data).

**The `jobs.assigned_at` question resolves to D, not A.** There is no
`jobs.assigned_at`, but `job_events.event_type` already includes
`contractor_assigned`, and `job_inspectors.assigned_at` covers teams. Dispatch
time is therefore already recoverable from canonical events. Per the standing
instruction — "do not duplicate data already reliably available in canonical
events" — Lane A must **not** add one.

**Migration:** yes, `428000`, comment + self-test only.
**Web/Mobile/Admin impact:** none.
**Security:** none. **Tests:** self-test in-migration.

---

## Lane B — Report status history · **A, genuinely missing**

`reports.status` = `In_Progress → Submitted → Approved | Rejected | Revision_Requested`.
There is **no** report status history table anywhere (`CREATE TABLE …report…
history|audit|event|status` returns nothing).

Partial attribution already exists and **must be preserved as-is**:
`technical_approved{,_at,_by}` and `financial_approved{,_at,_by}` — status-only
semantics, per standing instruction.

So the gap is precise: the *approval* transitions are attributable; every other
transition overwrites `reports.status` in place, losing who requested a revision,
when, and how many times. First-pass approval rate and revision rate are
therefore **not computable today** — which is exactly what pilot metric #3 needs.

**Smallest fix:** one append-only history table hung off the existing report,
written by a trigger on `reports` status change. No Reports v2, no state-machine
change, no new statuses.

**Migration:** yes, `430000`.
**Impact:** Admin read surface later; no UI required for the lane to land.
**Security:** RLS on; no write grant to `authenticated`; history is evidence.
**Tests:** pgTAP (unexecutable here — PENDING MAC).

---

## Lane C — Payout timing · **likely D, verify before building**

`payout_status` (`unpaid|processing|paid|disputed`) exists with 38 references,
plus `payout_paid_at`, `payout_reference`, `payout_notes`, `payout_marked_by`.
The distinct states the brief asks Treasury to tell apart already have carriers:

- funded → `client_settled_at` (prepay) / credit limit (net_terms)
- settled → `client_settled_at`
- approved → `admin_confirmed_at`
- paid → `payout_status='paid'` + `payout_paid_at`
- **payable** → *no carrier* — 8 mentions of the word, no column

**This lane is READ-ONLY clarity, not a new state.** It must not add automation.
Verify first whether a derived read (funded ∧ approved ∧ ¬paid) is sufficient
before proposing any column. Expected answer: no migration needed.

**Migration:** allocate `432000`, expect it returned unused.
**Security:** must not expose buyer price or platform spread to the inspector.
**Hard prohibition:** no auto payout, no completion-trigger, no report-trigger.

---

## Lane D — Credential reconciliation · **B, live inconsistency**

Four overlapping tables, with app-reference counts:

| Table | app refs | Read |
|---|---|---|
| `certifications` | 56 | the live one |
| `inspector_credentials` | 16 | CCI system, proper enum + `credential_decision_consistency` CHECK |
| `inspector_certifications` | 4 | thin |
| `contractor_certifications` | 1 | near-dead |

Plus a live defect *inside* one table: `certifications` carries **both**
`is_verified` and `verified` booleans. Two columns, one fact, no constraint
tying them — nothing guarantees they agree, and Admin verification authority
reads one of them.

**Smallest fix, and the only one authorised now:** do **not** merge tables. Name
the canonical authority in `COMMENT ON TABLE`, and add a CHECK or trigger
reconciling `is_verified`/`verified` so they cannot diverge. Expiry automation
is explicitly **out of scope until this lands** — four reminder systems on four
tables is the failure mode to avoid.

**Migration:** yes, `434000`. **Security:** preserve Admin verification authority.

---

## Lane E — Applications · **mostly C/D; one cosmetic B**

Canonical `applications` exists. Legacy `job_applications` does **not** exist
and must not return. Status CHECK:

```
'pending','shortlisted','offered','CLIENT_SELECTED','hired','rejected','withdrawn','accepted'
```

`CLIENT_SELECTED` is the only uppercase value, and `admin_dispatch_job` gates on
it literally (`v_app.status <> 'CLIENT_SELECTED'`). Renaming it is a **breaking
change to a live dispatch gate** for a cosmetic win.

**Verdict: do not rename.** Document the casing as deliberate-and-load-bearing.
The duplicate column pairs (`bid_amount_cents`/`proposed_price_cents`,
`cover_note`/`cover_letter`) need a reader/writer map before any change — that
mapping is the lane's whole deliverable. **No schema change this pass.**

**Migration:** allocate `436000`, expect it returned unused.

---

## Lane F — Ops queue · **D, reuse; no new subsystem**

Admin already has 27 surfaces and a real queue RPC: `nx_admin_report_review_queue`,
plus `nx_admin_review_inspection_report` and four `admin_*_view`s. The dashboard
(297 lines) already renders disputes, moderation and payouts.

**No Ops v2. No migration.** The lane is a read-composition over existing data
answering one question — *where is a job stuck* — using `jobs.status`,
`payout_status`, `client_settled_at`, `reports.status`, and `job_events`.

**Verdict: UI/data-layer only.** Return `438000` unused.

---

## Standing constraints for every lane

- No second architecture. Extend or explain why you cannot.
- No payment automation of any kind. Payout stays manual.
- No price leakage: buyer price and platform spread never reach an inspector surface; inspector payout never reaches a buyer surface.
- Identity/brokerage and offline replay semantics unchanged.
- Every `SECURITY DEFINER` sets `search_path`; no grants to `anon`/`PUBLIC`.
- Agents do **not** commit. The Lead integrates.
- SQL is unexecutable here. Write pgTAP; mark it `SQL RUNTIME VALIDATION = PENDING MAC`. Never report it green.
