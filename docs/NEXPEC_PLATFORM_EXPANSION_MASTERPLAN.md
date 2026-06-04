# NEXPEC Platform Expansion — The Server-Driven Supremacy Architecture

**Three features. One substrate. Zero new screens.**

Engineering Tools · Supplier Ecosystem · LinkedIn SSO — designed to ship as **data and logic**, never as UI.

---

## 0. The One Idea

Every feature below collapses into a single meta-pattern your codebase already half-implements:

> **DECLARE → EXECUTE → PROJECT**, anchored to the **Trust Spine**.
>
> New capabilities ship as JSONB *manifests* interpreted by components you already own, run by deterministic RLS-guarded RPCs, and surfaced through SQL *projections* — every artifact canonical-JSON hashable into your existing seal chain. **A new tool is a row. A new account type is a row. A new auth provider is a config key.**

The four primitives — and the real anchors in your repo they map to:

| Layer | What it does | You already have |
|---|---|---|
| **DECLARE** | JSONB specs that render via generic components | `form_templates.fields[]` → `DynamicForm`; JSON-driven lists |
| **EXECUTE** | deterministic, audited Postgres RPCs / edge fns | `apply_onboarding_role`, `pi_record_*`, `generate-contract`, `generate-vca` |
| **PROJECT** | views + JSONB "card" specs feeding lists | `inspectors_directory` view + fetchers |
| **TRUST** | canonical-JSON SHA-256 seals + OTS anchors | `pi_canonical_json`, `pi_report_seals`, `model_artifacts` |

Because the rendering substrate (`DynamicForm`, JSON lists, the existing SSO button row, the onboarding role picker) is **already generic**, the entire expansion is achievable without authoring a screen, altering a layout, or changing navigation. The few unavoidable touch-points are *config/logic*, not design — and each is called out explicitly in the **Zero-UI-Change Ledger** (§5).

---

## 1. Feature I — The Engineering Tool Foundry

> *"A calculator is a row. Its result is a sealed artifact."*

### 1.1 The decomposition

Every tool in the competitor's grid (RT Exposure Time, Bolt Torque, Heat Input, Weld Consumable, Auto WPS, ITP Generator…) is the same three things:

1. an **input form** (label, type, unit, options, validation, defaults, conditional visibility),
2. a **deterministic transform** (math, table lookups, or a document assembler),
3. an **output** rendered as cards/rows.

You already render (1) and (3) generically. So a tool is pure data + one execution call.

### 1.2 Schema (the registry)

```sql
-- The tool catalogue. Each row is a complete, renderable, runnable tool.
create table public.engineering_tools (
  key            text primary key,                  -- 'rt_exposure_time'
  category       text not null,                     -- 'ndt'|'welding'|'mechanical'|'document'|'general'
  title          text not null,
  subtitle       text,
  icon_token     text,                              -- maps to an icon already in your set
  input_schema   jsonb  not null default '[]',      -- FormField[] — SAME shape as form_templates.fields
  output_schema  jsonb  not null default '{}',      -- how to project results into your JSON list
  engine         text   not null default 'dsl',     -- 'dsl'|'sql'|'lookup'|'edge'
  formula        jsonb  not null default '{}',      -- the DSL program (see §1.4) OR an sql fn name
  reference_key  text,                              -- → tool_reference_data
  standards_refs text[] default '{}',               -- 'ASME V Art.2','EN 1011-1' (citations)
  access_tier    text   not null default 'free',    -- 'free'|'pro'
  spec_version   int    not null default 1,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Versioned, citable lookup tables (HVL curves, K-factors, deposition rates, film classes…).
create table public.tool_reference_data (
  reference_key  text not null,
  payload        jsonb not null,                    -- arbitrary structured table
  source         text,                              -- 'ASME BPVC.V-2023 T-...'
  spec_version   int  not null default 1,
  primary key (reference_key, spec_version)
);

-- Every run, for analytics + the trust spine (see §1.6).
create table public.tool_runs (
  id           uuid primary key default gen_random_uuid(),
  tool_key     text not null references public.engineering_tools(key),
  tool_version int  not null,
  actor_id     uuid references public.profiles(id) on delete set null,  -- null = anon
  inputs       jsonb not null,
  outputs      jsonb not null,
  input_sha256 text  not null,                       -- canonical-JSON hash of inputs
  result_sha256 text not null,                       -- canonical-JSON hash of outputs
  created_at   timestamptz not null default now()
);
```

`input_schema` is **deliberately the same `FormField[]` shape `form_templates.fields` already uses** — so `DynamicForm` renders a tool's inputs with no new component. `output_schema` describes rows your existing JSON-driven list already knows how to draw (label / value / unit / tone).

### 1.3 RLS & access

```sql
alter table public.engineering_tools enable row level security;
create policy tools_read   on public.engineering_tools for select using (is_active);   -- public, even anon
create policy tools_admin  on public.engineering_tools for all using (nx_is_admin()) with check (nx_is_admin());
-- tool_runs: insert via RPC only; read own + admin.
```

### 1.4 The masterstroke — a JSONB Formula DSL + one evaluator

To make tools shippable as *pure data* (no deploy, no screen), encode the math as a tiny, safe, deterministic expression tree evaluated by **one** PL/pgSQL function. Example — RT exposure time `t = t_ref · 2^((D − D_ref)/HVL) · (SFD/SFD_ref)²`:

```jsonc
// engineering_tools.formula for 'rt_exposure_time'
{
  "let": {
    "hvl":   { "lookup": ["rt_hvl", "$.source", "$.material"] },
    "ratio": { "pow": [2, { "div": [{ "sub": ["$.thickness_mm", "$.d_ref"] }, "$hvl"] }] },
    "sfd2":  { "pow": [{ "div": ["$.sfd_mm", "$.sfd_ref_mm"] }, 2] }
  },
  "return": { "mul": ["$.t_ref_min", "$ratio", "$sfd2"] }
}
```

One evaluator (`tool_eval(formula jsonb, inputs jsonb) returns jsonb`) implements a closed whitelist of operators (`add/sub/mul/div/pow/min/max/round/clamp/if/lookup/let`). **No `eval`, no dynamic SQL, no network** → deterministic, injection-proof, $0, and reproducible. Adding "Bolt Torque" = `INSERT … values('bolt_torque', …, formula:{…})`. That is the whole deploy.

> Tools that genuinely need procedural logic use `engine='sql'` (a named, reviewed PL/pgSQL fn) or `engine='edge'` (document generators, §1.6). The DSL covers the long tail of calculators with zero code.

### 1.5 One RPC to run anything

```sql
create or replace function public.tool_invoke(p_tool_key text, p_inputs jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tool public.engineering_tools; v_out jsonb; v_locked boolean;
begin
  select * into v_tool from engineering_tools where key=p_tool_key and is_active;
  if not found then raise exception 'unknown_tool'; end if;

  -- entitlement as a predicate, not a screen (§1.7)
  v_locked := v_tool.access_tier='pro' and not public.nx_has_entitlement(auth.uid(), 'tools_pro');
  if v_locked then
    return jsonb_build_object('locked', true, 'upsell',
      jsonb_build_object('tool', v_tool.key, 'tier','pro'));  -- generic list renders a "locked" card
  end if;

  perform public.validate_against_schema(v_tool.input_schema, p_inputs);  -- server-side validation
  v_out := case v_tool.engine
             when 'dsl'    then public.tool_eval(v_tool.formula, p_inputs)
             when 'lookup' then public.tool_lookup(v_tool.reference_key, p_inputs)
             when 'sql'    then public.tool_run_sql(v_tool.formula->>'fn', p_inputs)
             else jsonb_build_object('error','engine_not_runnable_here') end;

  insert into tool_runs(tool_key,tool_version,actor_id,inputs,outputs,input_sha256,result_sha256)
  values (v_tool.key, v_tool.spec_version, auth.uid(), p_inputs, v_out,
          encode(digest(pi_canonical_json(p_inputs),'sha256'),'hex'),
          encode(digest(pi_canonical_json(v_out),'sha256'),'hex'));

  return jsonb_build_object(
    'tool', v_tool.key, 'version', v_tool.spec_version,
    'result_cards', public.project_output(v_tool.output_schema, v_out),  -- → your JSON list
    'citations', v_tool.standards_refs, 'computed_at', now());
end $$;
```

**Data flow:** `DynamicForm(tool.input_schema)` → `tool_invoke(key, values)` → `result_cards` rendered by the existing JSON-driven list. No screen authored.

### 1.6 Document-class tools → the trust differentiator

Auto WPS, ITP Generator, Bilingual Docs, CV Template Transfer are `engine='edge'`: `tool_invoke` enqueues to your existing worker/edge pattern (mirror `generate-contract`/`generate-vca`), which assembles a structured JSONB document, **canonical-JSON hashes it, folds it into the seal chain**, and renders a PDF through the pipeline you already ship. Result: *the first inspection marketplace where a generated WPS or ITP carries a verifiable provenance hash.* No competitor can copy that without your seal spine.

Even pure calculators benefit: because every `tool_run` is hashed, an inspector can **attach a sealed RT-exposure calculation to a report** — engineering math with chain-of-custody. This is the out-of-the-box move: *tools aren't a feature, they're new leaves on your trust tree.*

### 1.7 Monetization with zero UI

`access_tier='pro'` + `nx_has_entitlement()`; a locked tool returns a `locked` card the **existing list** renders as an upsell. The 🔒 badges in the competitor grid are literally just `access_tier` in your data. No paywall screen.

### 1.8 Offline & determinism (free upside)

Because DSL tools are pure functions over JSONB, the *same* `formula` can be evaluated client-side by a tiny interpreter for offline use, and re-verified server-side on reconnect through your **outbox** — identical hash both sides. Determinism is the gift that keeps giving.

---

## 2. Feature II — The Supplier Ecosystem

> *Don't add a silo. Generalize the actor.*

### 2.1 Insight

Inspector, agency, client, supplier are not four codebases — they are one **Actor** with a `kind` and a JSONB **capability/attribute** document. "Find Professionals / Agencies / Suppliers" are one list with one filter. Matching is one scoring function. Adding "labs" or "trainers" tomorrow is then *free*.

### 2.2 Role wiring (config/logic, not design)

`role` is a `text` + CHECK column (not a pg enum), so onboarding a new type is a constraint widen — no enum migration:

```sql
-- widen the two CHECKs in baseline + the apply_onboarding_role whitelist
... role = ANY (ARRAY['inspector','client','agency','enterprise','supplier','admin','super_admin'])
```

Plus three **config** entries (not UI): `roleHome('supplier') → '/(tabs)'` (an existing generic, list-driven dashboard), `'(supplier)'`/reused group in the AuthGate allow-list (the bounce-prevention pattern we already fixed), and `'supplier'` added to the onboarding role list rendered by the **existing** role picker. Zero new screens.

### 2.3 Supplier identity = a `form_template`, rendered by `DynamicForm`

```sql
create table public.supplier_profiles (
  id            uuid primary key references public.profiles(id) on delete cascade,
  legal_name    text,
  capabilities  jsonb not null default '[]',   -- ['equipment_rental','calibration_lab','materials','ndt_lab']
  attributes    jsonb not null default '{}',   -- { standards:['ASME','EN'], regions:['AE','SA'], lead_time_days:7, certs:[...], capacity:{...} }
  geo           geography(point),              -- reuse your existing geo + Global Talent Map
  verification  jsonb not null default '{}',   -- sealable (cert docs hashed into the spine)
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now()
);
create index supplier_caps_gin on public.supplier_profiles using gin (capabilities jsonb_path_ops);
create index supplier_attr_gin on public.supplier_profiles using gin (attributes  jsonb_path_ops);
```

Onboarding renders from a `form_templates` row (`supplier_onboarding`) through `DynamicForm`; the submit handler is `apply_onboarding_role('supplier', …)` extended to upsert `supplier_profiles`. **The onboarding "screen" is data.**

### 2.4 The capability graph + matching RPC

A two-sided match between **needs** (a client/job requirement vector) and **capabilities** (supplier vector), scored on tag overlap, geo distance (you already compute it for jobs), certification/standard fit, rating, and availability:

```sql
create or replace function public.supplier_match(p_need jsonb, p_limit int default 20)
returns table(supplier_id uuid, score numeric, why jsonb)
language sql stable as $$
  select s.id,
         (0.45*tag_overlap(s.capabilities, p_need->'capabilities')
        + 0.20*standards_fit(s.attributes->'standards', p_need->'standards')
        + 0.20*geo_score(s.geo, p_need->'geo')
        + 0.10*coalesce((p->>'rating_avg')::numeric/5,0)
        + 0.05*availability(s.attributes->'capacity')) as score,
         jsonb_build_object('matched_caps', …, 'distance_km', …) as why
  from supplier_profiles s join profiles p on p.id=s.id
  where s.is_active and s.capabilities ?| akeys(p_need->'capabilities')
  order by score desc limit p_limit;
$$;
```

Returns ranked **cards** → the existing JSON list. Precompute hot edges into a materialized projection (`marketplace_match_edges`) refreshed on a schedule for the "Global Talent Map" / "dynamic matching" feed.

### 2.5 One directory, three kinds (the projection)

```sql
create view public.marketplace_directory as
  select id, 'inspector' as kind, nx_handle(id) as handle, card_for_inspector(id) as card, geo from inspectors_directory
  union all select id,'agency',   …, card_for_agency(id),   geo from agencies …
  union all select id,'supplier', legal_name, card_for_supplier(id), geo from supplier_profiles where is_active;
```

"Find Suppliers" = the same generic list with `kind='supplier'`. Anti-poaching/price-blindness rules (your golden rules) are honored by emitting **pseudonymous cards** from the view — the directory never leaks PII, exactly as `inspectors_directory` already does.

### 2.6 Engagement = RFQ, reusing the spine

```sql
create table public.supplier_rfqs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null, supplier_id uuid not null,
  spec jsonb not null,                 -- need details (DynamicForm-authored)
  status text not null default 'open', -- open|quoted|accepted|declined|closed
  broker_mode text not null default 'admin', -- 'admin' (golden-rule brokered) | 'direct'
  created_at timestamptz default now()
);
create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid references supplier_rfqs(id), supplier_id uuid not null,
  quote jsonb not null, status text default 'submitted', created_at timestamptz default now()
);
```

RFQ ↔ quote reuses your **chat (siloed rooms), contracts, escrow, notifications** spine. `broker_mode='admin'` keeps suppliers inside the **admin-brokered, price-blind, siloed-chat** golden rules; `'direct'` is an opt-in lane for commodity supply where brokering adds no value — your call per category, enforced in RLS + the RPCs, not the UI.

---

## 3. Feature III — LinkedIn SSO + Professional Hydration

> *The provider is a config key. The magic is the claims→schema pipeline.*

### 3.1 Provider (config, not UI)

Enable Supabase's `linkedin_oidc` provider (OIDC, PKCE). The "Continue with LinkedIn" button is the **same generic SSO button row** that already renders Google/Apple — you add one entry to its provider list (`signInWithOAuth({ provider:'linkedin_oidc' })`). No screen, no layout.

### 3.2 Hydration as a pipeline, not a provider (the future-proofing)

LinkedIn's OIDC userinfo realistically yields `sub, email, email_verified, name, given_name, family_name, picture, locale`. Richer *positions/skills/certifications* require partner scopes that LinkedIn restricts. **So don't couple your value to LinkedIn's API.** Design one hydration sink fed by interchangeable **enrichment sources**:

```sql
create table public.identity_links (
  actor_id  uuid references public.profiles(id) on delete cascade,
  provider  text not null,                 -- 'linkedin_oidc'|'google'|'apple'|'cv_import'|'manual'
  subject   text not null,                 -- provider 'sub'
  claims    jsonb not null default '{}',   -- raw claims, kept for re-hydration
  primary key (provider, subject)
);

create or replace function public.hydrate_identity(p_provider text, p_claims jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- idempotent map: claims → profiles (+ actor_facets), filling only blanks (never clobber user edits)
  update public.profiles p set
     full_name  = coalesce(nullif(p.full_name,''), p_claims->>'name'),
     avatar_url = coalesce(p.avatar_url, p_claims->>'picture')
   where p.id = auth.uid();
  insert into identity_links(actor_id,provider,subject,claims)
  values (auth.uid(), p_provider, p_claims->>'sub', p_claims)
  on conflict (provider,subject) do update set claims = excluded.claims;
end $$;
```

Called from your existing **`handle_new_user_role`** trigger / a post-sign-in hook (Supabase Custom Access Token Hook or first-login RPC). The same `hydrate_identity` is what the competitor's **"CV Template Transfer"** would call after parsing an uploaded résumé — *LinkedIn and CV import become the same pipe.* When LinkedIn loosens scopes later, you widen the claim map; nothing else changes.

### 3.3 Account type at signup

Default new LinkedIn users to `technical_professional` (your inspector role — the screenshot's default), then let the **existing** onboarding role step (`apply_onboarding_role`) override. Identity is captured instantly; role stays user-chosen.

### 3.4 Security (non-negotiable)

PKCE + `state`; **only** auto-link identities to an existing account when `email_verified=true` *and* the email already belongs to a verified user (else create fresh — never merge on an unverified email, the classic account-takeover hole); store raw claims but treat them as untrusted input to `hydrate_identity` (no privilege escalation — role is never set from claims).

---

## 4. The Unifying Spine

What makes this a *system*, not three features:

- **One registry pattern** (`engineering_tools`, `supplier_profiles`/facets, `identity_links` all = "spec + JSONB").
- **One execution pattern** (`tool_invoke`, `supplier_match`, `hydrate_identity` = validated, RLS-guarded, logged RPCs).
- **One projection pattern** (`marketplace_directory`, `result_cards`, match edges = views/JSON cards → generic lists).
- **One trust anchor** — `pi_canonical_json` + SHA-256: sealed tool runs, sealed generated docs, sealed supplier verifications. Your moat (provable provenance) now extends across *all three* features.
- **Versioned everything** (`spec_version`) → reproducibility and audit-grade compliance.
- **God-mode + golden rules** enforced in RLS/RPCs (admin ≡ super_admin; admin-brokering; price-blindness; siloed chat; anti-poaching pseudonymous projections) — identically across inspectors and suppliers.

And the self-referential elegance: **tool input schemas and supplier onboarding are themselves `form_templates`** — you author new tools and account types through the very DynamicForm engine they ride on. The platform extends itself.

---

## 5. Zero-UI-Change Ledger (honest accounting)

Everything renders through components you own. The only edits that are **not** UI/UX design — and are required — are config/logic:

| Touch-point | Type | Why it's not a "design change" |
|---|---|---|
| `role` CHECK + onboarding whitelist += `'supplier'` | SQL constraint | data/logic |
| `roleHome` map + AuthGate allow-list += supplier/`(client)`-style entry | TS config object | navigation *config*, no new route/layout |
| SSO button provider list += `linkedin_oidc` | config array | reuses the existing button row |
| Auth provider enabled in Supabase dashboard | platform config | not code at all |
| New `form_templates` rows (tools, supplier onboarding) | data | rendered by existing `DynamicForm` |

No new `*.tsx` screens, no layout files, no style changes. If even the config entries are off-limits, the tools + SSO still work unchanged; only the supplier *role landing* needs that one-line `roleHome` entry.

---

## 6. Phased rollout (data-first)

1. **Foundry core** — `engineering_tools` + `tool_eval` + `tool_invoke` + 6 free DSL calculators (Bolt Torque, Heat Input, Unit Converter, RT Exposure, Weld Consumable, Film Size). Pure data after the one evaluator ships.
2. **Foundry docs + monetization** — `engine='edge'` WPS/ITP via the seal spine; `access_tier`/entitlement lock cards.
3. **Supplier identity** — role widen, `supplier_profiles`, onboarding `form_template`, directory projection.
4. **Supplier matching + RFQ** — `supplier_match`, match-edge materialization, RFQ/quote on the existing chat/contract/escrow spine.
5. **LinkedIn SSO** — provider config, `identity_links`, `hydrate_identity` wired to `handle_new_user_role`; later, CV-import enrichment on the same pipe.

Each phase is independently shippable and reversible (additive migrations, idempotent, sealable).

---

## 7. Honest constraints & risks

- **LinkedIn scopes**: assume basic OIDC claims only; the enrichment-pipeline design (§3.2) is what de-risks this. Don't market "imports your full LinkedIn history" until partner scopes are approved.
- **DSL safety**: the evaluator must be a strict operator whitelist with depth/così limits — no recursion bombs, no SQL, no I/O. Treat it like a sandbox (it is one).
- **Determinism vs. reference drift**: pin `tool_reference_data.spec_version` per run so a sealed calculation is reproducible even after a standard is updated.
- **Supplier ↔ golden rules**: decide per supplier category whether `broker_mode` is `admin` (default, safest) or `direct`; enforce in RLS, never trust the client.
- **Matching quality**: start with transparent weighted scoring (explainable `why`), not a black box — buyers trust math they can see, which is on-brand for you.

---

### The thesis, once more

You don't have three features to build. You have **one server-driven platform** to finish — and you've already built its hardest pieces (DynamicForm, the seal spine, the brokered marketplace, the auth hooks). Tools, suppliers, and LinkedIn are just the first three things you pour through it. The next ten won't need this document.
