# NEXPEC Brokered Deal & Agreement Spine — Architectural Blueprint

**Status:** DESIGN ONLY (v0.1, 2026-06-05). No application code or migrations are created by this document. It is the spec to review and sign off before implementation. It deliberately *reuses and generalizes* the two contract subsystems already shipped (`job_contracts`, `supplier_contracts`) rather than adding a third.

It closes two intertwined gaps found in turnkey E2E:
1. The turnkey RFQ award spawns an inspection job but generates **no contracts** (Client↔NEXPEC, NEXPEC↔Supplier, NEXPEC↔Inspector).
2. The Client has **no transparency** into the assigned inspector's credentials (the A–F trust framework).

Both are solved by one primitive: **NEXPEC as the legal hub of a per-deal contract graph.**

---

## 0. Goals & non-negotiables

- **Hub-and-spoke privity.** NEXPEC is a party to *every* agreement. There is no contract edge Client↔Supplier or Client↔Inspector. This is what makes price-blindness and anti-poaching *structural*, not cosmetic.
- **Contract-before-money.** No escrow may be released on any leg whose governing agreement is not `executed`. (Generalizes today's `release_supplier_contract` gate.)
- **Price-blindness (Golden Rule 2).** Client sees only the marked-up client price; Supplier only its cost; Inspector only its payout; spread is admin-only. Enforced at the data layer (views + RLS), never UI-only.
- **Anti-poaching.** Inspector identity is anonymized to the client (NX- handle + dossier); real identity is escrowed and admin-gated (`nx_is_admin()`), per the inspector/supplier directory doctrine.
- **One engine, many shapes.** Direct inspection, turnkey procurement+inspection, and procurement-only are the *same* engine with different sub-graphs.
- **Everything sealed.** Each agreement and credential artifact carries `content_sha256` + OpenTimestamps (two-phase: pending → bitcoin_confirmed), verifiable at `/passport/<sealId>`.

---

## 1. Domain model

```
Deal (1) ──< Agreement (N)        Agreement.kind ∈ {client_supply, supplier_supply, inspector_engagement}
  │                                Every Agreement: NEXPEC on one side, the counterparty on the other.
  ├── client_supply        Client ↔ NEXPEC   (marked-up price; outcome-based; carries the legal armor)
  ├── supplier_supply      NEXPEC ↔ Supplier (cost price; existing supplier_contracts, release-gated)
  └── inspector_engagement NEXPEC ↔ Inspector(blind payout; host of A–F trust artifacts)
```

**Topology by deal type** (same tables, different legs):

| Deal type | client_supply | supplier_supply | inspector_engagement |
|---|---|---|---|
| Direct inspection | optional | — | ✓ |
| Turnkey (procurement + source/FAT) | ✓ | ✓ (1..n) | ✓ |
| Procurement-only | ✓ | ✓ (1..n) | — |

The **Deal** binds 1:1 to an RFQ award (turnkey) or a job (direct). It is the unit of escrow, audit, and lifecycle.

---

## 2. Enums

```sql
agreement_kind   : 'client_supply' | 'supplier_supply' | 'inspector_engagement'
agreement_status : 'draft' | 'presented' | 'signed' | 'countersigned' | 'executed' | 'amended' | 'voided'
party_role       : 'client' | 'supplier' | 'inspector' | 'nexpec'
deal_status      : 'forming' | 'awaiting_client_signature' | 'funded' | 'dispatched' | 'in_delivery' | 'closed' | 'cancelled'
money_leg_kind   : 'client_escrow_in' | 'supplier_payout' | 'inspector_payout'
money_leg_status : 'pending' | 'held' | 'released' | 'refunded'
transparency_tier: 'standard' | 'enterprise' | 'named'        -- A–F option E
object_reason    : 'scope_mismatch' | 'certification_concern' | 'conflict_of_interest' | 'prior_issue' | 'other'
```

---

## 3. Schema (DDL sketches)

> All tables `public`, RLS-enabled, admin via `nx_is_admin()`. `*_cents` are integers. Times are `timestamptz`.

### 3.1 `deals` — the aggregate root

```sql
create table public.deals (
  id                uuid primary key default gen_random_uuid(),
  rfq_id            uuid references public.rfqs(id),          -- turnkey origin (nullable for direct)
  job_id            uuid references public.jobs(id),          -- inspection job (nullable until spawned)
  client_id         uuid not null references public.profiles(id),
  status            text not null default 'forming',          -- deal_status
  -- frozen price snapshot (protects the markup from drift). Client price only here.
  client_price_cents integer not null,
  currency          text not null default 'USD',
  transparency_tier text not null default 'standard',
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  cancelled_at      timestamptz
);
```

### 3.2 `agreements` — the polymorphic contract spine

```sql
create table public.agreements (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references public.deals(id) on delete restrict,
  kind              text not null,                            -- agreement_kind
  status            text not null default 'draft',            -- agreement_status
  version           integer not null default 1,
  supersedes_id     uuid references public.agreements(id),    -- amendment chain (immutable history)
  counterparty_id   uuid not null references public.profiles(id),  -- the non-NEXPEC party
  -- pricing: ONE money figure per leg, never the spread (price-blindness lives here)
  amount_cents      integer not null,                         -- client_price | supplier_cost | inspector_payout
  -- rendered + sealed content
  body_md           text not null,                            -- generated from the kind's template (legal armor)
  content_sha256    text not null,
  ots_proof         jsonb,                                    -- OpenTimestamps (pending → bitcoin_confirmed)
  ots_status        text not null default 'unsubmitted',
  seal_id           uuid,                                     -- → /passport/<seal_id>
  -- lifecycle stamps
  presented_at      timestamptz,
  signed_at         timestamptz,                              -- counterparty signature
  countersigned_at  timestamptz,                              -- NEXPEC signature
  executed_at       timestamptz,
  voided_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (deal_id, kind, version)
);
```

> `job_contracts` and `supplier_contracts` collapse into this table (migration = adopt + backfill, not rebuild). `release_supplier_contract`'s `status='executed'` gate becomes the generic per-leg gate in §7.

### 3.3 `agreement_signatures` — non-repudiation audit

```sql
create table public.agreement_signatures (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references public.agreements(id),
  signer_id     uuid not null references public.profiles(id),
  party_role    text not null,                                -- party_role
  signed_sha256 text not null,                                -- hash of the exact version signed
  signed_at     timestamptz not null default now(),
  ip            inet,
  user_agent    text
);
```

### 3.4 `inspector_engagements` — the A–F host (1:1 with the inspector leg)

```sql
create table public.inspector_engagements (
  id                 uuid primary key default gen_random_uuid(),
  agreement_id       uuid not null references public.agreements(id),
  deal_id            uuid not null references public.deals(id),
  job_id             uuid not null references public.jobs(id),
  inspector_id       uuid not null references public.profiles(id),  -- (= jobs.contractor_id) — escrowed identity (F)
  -- A/B/C artifacts are derived + sealed (see §8); cached refs here:
  dossier_seal_id    uuid,
  certificate_seal_id uuid,
  independence_seal_id uuid,
  -- D: client review gate
  client_review      text default 'pending',                  -- 'pending'|'approved'|'objected'|'auto_approved'
  object_reason      text,
  review_deadline    timestamptz,                              -- auto-approve after this
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
```

### 3.5 `deal_money_legs` — escrow choreography (or map onto existing wallet/escrow)

```sql
create table public.deal_money_legs (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals(id),
  agreement_id uuid references public.agreements(id),         -- the agreement that GATES this leg
  kind         text not null,                                 -- money_leg_kind
  amount_cents integer not null,
  status       text not null default 'pending',               -- money_leg_status
  released_at  timestamptz
);
```

---

## 4. Projected views + RLS (the enforcement layer)

Each party reads a **view that emits only its leg and its own money figure**. The spread never appears in any non-admin projection. Pattern mirrors `rfq_client_offers_view` + the admin-gated supplier directory (`CASE WHEN nx_is_admin()`).

```sql
-- CLIENT: own deals; own price; NEVER cost/payout/spread; inspector identity anonymized.
create view public.client_deal_view with (security_barrier=true) as
  select d.id, d.status, d.client_price_cents, d.currency, d.transparency_tier,
         a_client.id as client_agreement_id, a_client.status as client_agreement_status,
         a_client.seal_id as client_agreement_seal_id
  from public.deals d
  join public.agreements a_client
       on a_client.deal_id = d.id and a_client.kind = 'client_supply'
  where d.client_id = auth.uid() or public.nx_is_admin();

-- CLIENT view of the assigned inspector = A/B/C only (anonymized).  Identity is NULL unless admin.
create view public.client_assigned_inspector_view with (security_barrier=true) as
  select e.deal_id,
         public.nx_handle(e.inspector_id)                     as handle,        -- NX- pseudonym
         e.dossier_seal_id, e.certificate_seal_id, e.independence_seal_id,
         e.client_review, e.review_deadline,
         case when public.nx_is_admin() then p.full_name else null end as legal_name -- god-mode only
  from public.inspector_engagements e
  join public.profiles p on p.id = e.inspector_id
  join public.deals d on d.id = e.deal_id
  where d.client_id = auth.uid() or public.nx_is_admin();

-- SUPPLIER: only its own supplier_supply leg + its cost price.
create view public.supplier_deal_view with (security_barrier=true) as
  select a.deal_id, a.id as agreement_id, a.status, a.amount_cents as cost_cents, a.seal_id
  from public.agreements a
  where a.kind = 'supplier_supply'
    and (a.counterparty_id = auth.uid() or public.nx_is_admin());

-- INSPECTOR: only its engagement + its payout (blind to client price & spread).
create view public.inspector_deal_view with (security_barrier=true) as
  select a.deal_id, a.id as agreement_id, a.status, a.amount_cents as payout_cents, a.seal_id, e.job_id
  from public.agreements a
  join public.inspector_engagements e on e.agreement_id = a.id
  where a.kind = 'inspector_engagement'
    and (a.counterparty_id = auth.uid() or public.nx_is_admin());
```

RLS on base tables: `client_id = auth.uid()` (client), `counterparty_id = auth.uid()` (supplier/inspector on their own agreement rows), `nx_is_admin()` for full access. Views are owner-run with column-level gating (same trick as the supplier directory).

---

## 5. Lifecycle state machines

**Agreement:** `draft → presented → signed → countersigned → executed`; `executed → amended` (creates v+1, old row immutable); any pre-executed state `→ voided`.

**Deal:** `forming → awaiting_client_signature → funded → dispatched → in_delivery → closed`; any `→ cancelled` (compensating refund).

**Money leg:** `pending → held (on escrow fund) → released (gate satisfied)`; `held → refunded` (cancellation/dispute).

Transition table (who can drive what):

| Transition | Actor | Guard |
|---|---|---|
| agreement draft→presented | admin/system | template rendered + sealed |
| presented→signed | counterparty | signature row + matching sha |
| signed→countersigned | NEXPEC (admin) | — |
| countersigned→executed | system | both signatures present |
| money leg →released | system | **gating agreement.status = 'executed'** (+ leg-specific predicate, §7) |
| inspector_engagement executable | system | `client_review ∈ {approved, auto_approved}` (D) |

---

## 6. Orchestration RPCs (pseudo-SQL, security definer)

### 6.1 `award_and_dispatch(p_rfq_id)` — the saga

```
1. assert caller is the RFQ's client; assert a 'presented' priced offer exists (reuse award_quote gate).
2. INSERT deals (client_price_cents := frozen from rfq_client_offers_view; status 'awaiting_client_signature').
3. generate client_supply agreement (kind=client_supply, amount=client_price, body from template incl.
   liability cap + indemnity + E&O + escrow + inspection scope + credential standard + non-circumvention);
   seal (sha256 + OTS submit); status 'presented'.
4. RETURN {deal_id, client_agreement_id}  -- UI now shows "Review & sign your supply agreement"
```

> Steps 5+ are triggered by `sign_agreement` on the client leg, not here — money must follow signature.

### 6.2 `sign_agreement(p_agreement_id, p_ip, p_ua)`

```
- assert caller = counterparty; status='presented'; write agreement_signatures; status→'signed'.
- IF kind='client_supply':
    countersign (NEXPEC) → 'executed';
    deals.status → 'funded';  create deal_money_legs(client_escrow_in, held);   -- ESCROW IN (contract-before-money holds: signed first)
    spawn inspection job (jobs.contractor_id null) → set deals.job_id;
    create inspector_engagement-agreement (draft) + supplier_supply agreement(s) (draft);
    deals.status → 'dispatched'.
- IF kind='supplier_supply' or 'inspector_engagement':
    on countersign → 'executed' (may enable a payout leg later).
```

### 6.3 `admin_assign_inspector(p_engagement_id, p_inspector_id, p_payout_cents)`

```
- admin-only; set inspector_engagements.inspector_id (= jobs.contractor_id), agreement.amount=payout;
- GENERATE + seal A/B/C artifacts (§8) → store *_seal_id;
- set client_review='pending', review_deadline = now() + interval (tier-based);
- present inspector_engagement agreement to the inspector to sign.
```

### 6.4 `client_review_inspector(p_engagement_id, p_decision, p_reason)`

```
- client-only; p_decision ∈ {approved, objected}; record + reviewed_at.
- objected → notify admin; admin re-runs admin_assign_inspector (swaps ONLY the inspector leg;
  client_supply untouched → no client re-signature → no breach).
- (cron) auto-approve engagements past review_deadline → client_review='auto_approved'.
```

### 6.5 `release_deal_leg(p_money_leg_id)` — the generalized gate (§7)

### 6.6 `amend_agreement(p_agreement_id, ...)` → supersede (v+1), re-seal, re-sign. Old version immutable.

### 6.7 `cancel_deal(p_deal_id, reason)` → void non-executed agreements, refund held legs, deal→cancelled.

---

## 7. The contract-before-money invariant

A single guard, enforced in SQL (not app code), generalizing `release_supplier_contract`:

```sql
create or replace function public.release_deal_leg(p_leg uuid) returns void as $$
declare v record;
begin
  select l.*, a.status as agr_status, a.kind into v
  from public.deal_money_legs l
  join public.agreements a on a.id = l.agreement_id
  where l.id = p_leg for update;

  if not public.nx_is_admin() then raise exception 'admin only'; end if;
  if v.agr_status <> 'executed' then
    raise exception 'CONTRACT-BEFORE-MONEY: agreement % not executed (%).', v.agreement_id, v.agr_status;
  end if;

  -- leg-specific predicate:
  if v.kind = 'supplier_supply'      and not public.goods_accepted(v.deal_id) then raise exception 'goods not accepted'; end if;
  if v.kind = 'inspector_engagement' and not public.report_admin_confirmed(v.deal_id) then raise exception 'report not admin-confirmed'; end if;

  update public.deal_money_legs set status='released', released_at=now() where id=p_leg;
end; $$ language plpgsql security definer;
```

Belt-and-suspenders: a `BEFORE UPDATE` trigger on `deal_money_legs` that rejects any `status→'released'` whose gating agreement is not `executed`, so even a bad direct write can't move money.

---

## 8. A–F artifact payloads

All sealed (sha256 + OTS), verifiable at `/passport/<seal_id>`. Cert **types/levels/validity** only — never serial/licence numbers or anything that deanonymizes.

**A — Credential Dossier** (anonymous, on the job for the client)
```json
{ "kind":"credential_dossier","handle":"NX-7Q2A","deal_id":"…","scope_ref":"API 570 piping",
  "competencies":["NEXPEC-Verified: API 570","UT Level II"],
  "experience_years":8,"nexpec_inspections_in_scope":47,"rating_avg":4.9,
  "sealed_at":"…","seal_id":"…" }
```
**B — Credential Certificate** (auditor-grade, downloadable)
```json
{ "kind":"credential_certificate","deal_id":"…","statement":"NEXPEC certifies the assigned inspector holds [API 570, UT II, 8 yrs] matching scope [X], independent of supplier [Z], covered by E&O policy ref …",
  "eo_policy_ref":"…","verify_url":"/passport/…","content_sha256":"…","ots_status":"bitcoin_confirmed" }
```
**C — Independence Attestation**
```json
{ "kind":"independence_attestation","deal_id":"…","supplier_handle":"NX-S31K",
  "statement":"No financial/employment relationship with supplier; assigned by blind match.","seal_id":"…" }
```
**D — Client Review** (gate object) → `inspector_engagements.client_review` + `object_reason` + `review_deadline`.

**E — Transparency Tier** (`deals.transparency_tier`): `standard` = A only; `enterprise` = A+B+C+D; `named` = + redacted named CV / mediated interview, **only** when a non-circumvention clause is signed in `client_supply` (liquidated damages + escrow leverage).

**F — Identity Escrow:** real identity lives in `inspector_engagements.inspector_id`; the client projection (`client_assigned_inspector_view`) returns `legal_name` only under `nx_is_admin()`. Reveal to others only on dispute/post-window triggers, logged.

---

## 9. Edge cases (absorbed by the model)

| Case | Handling |
|---|---|
| Procurement-only RFQ | Deal with client_supply + supplier_supply; no engagement leg |
| Direct inspection | Deal with (optional client_supply) + inspector_engagement |
| Multi-supplier split award | Multiple supplier_supply legs under one Deal |
| Change order | `amend_agreement` → v+1 supersedes; old version immutable |
| Client objects after signing | Swap inspector leg only; client_supply unaffected → no breach, no re-sign |
| Cancellation pre-execution | Void non-executed agreements; refund held legs; deal→cancelled |

---

## 10. Reuse map (existing → new)

| Existing | Becomes |
|---|---|
| `job_contracts` (+ client/inspector projected views, legal armor) | `agreements` kind=`inspector_engagement` + `inspector_deal_view` |
| `supplier_contracts` (two-party e-sign) | `agreements` kind=`supplier_supply` + `supplier_deal_view` |
| `release_supplier_contract` (executed gate) | `release_deal_leg` (generic gate, §7) |
| `rfq_client_offers_view` (price-blind) | source of the frozen `deals.client_price_cents` |
| `nx_handle` / TrustSigil / `/passport` seal | A/B/C dossier, certificate, attestation |
| supplier-directory `CASE WHEN nx_is_admin()` | identity escrow projection (F) |

The **only genuinely new** thing is `client_supply` (Client↔NEXPEC) + the Deal aggregate + the saga. Everything else is consolidation.

---

## 11. Phased execution

- **P0 — Spine:** `deals` + `agreements` + signatures + views; adopt `job_contracts`/`supplier_contracts` into it (+ backfill); unify seal/verify. *Verify:* pgTAP on lifecycle + projections; web `tsc`/`lint`; mobile scoped `tsc`.
- **P1 — Missing leg + saga:** `client_supply` template (armor) + `award_and_dispatch` + `sign_agreement` + escrow-on-signature + contract-before-money trigger.
- **P2 — Wire legs + money gates:** attach supplier + inspector legs; `release_deal_leg`; per-leg payout predicates.
- **P3 — A/B/C + D:** dossier + certificate + independence artifacts on assign; `client_review_inspector` + auto-approve cron.
- **P4 — E + F + amendments:** transparency tiers; named-tier non-circumvention gate; identity-escrow reveal triggers; change-order versioning.

P0–P2 close the legal gap; P3–P4 deliver the trust spectrum — on the same primitive.

---

## 12. Invariants to lock with tests (pgTAP)

1. No `deal_money_legs.status='released'` exists whose gating agreement ≠ `executed`.
2. No non-admin projection exposes more than one money figure (no spread, no cross-leg price).
3. `client_assigned_inspector_view.legal_name` is NULL for every non-admin caller.
4. Swapping an inspector leaves `client_supply.status='executed'` and requires no new client signature.
5. Every `executed` agreement has ≥1 counterparty signature with a `signed_sha256` matching its `content_sha256`.

---

## 13. Open decisions for ebi

1. **Escrow rail:** fund on client signature (recommended) vs. on dispatch?
2. **Auto-approve window (D)** per tier — e.g. standard 24h, enterprise 48h, named = manual only?
3. **Named tier (E):** redacted CV vs. NEXPEC-mediated credential interview — which do we offer first?
4. **`deals` vs. extend `jobs`:** new aggregate (recommended for procurement-only + multi-supplier) vs. overloading jobs.
5. **Identity-escrow reveal triggers (F):** dispute-only, or also post-non-solicit-window?
