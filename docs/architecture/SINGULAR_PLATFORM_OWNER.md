# Singular Platform Owner Doctrine

**Architectural invariant · canonical reference**

Status: **Active and enforced** · Last reviewed: May 31, 2026

---

## The invariant

NEXPEC has **exactly one** absolute platform authority. That authority is a singular, named human identity — the **NEXPEC Platform Owner**. There is no tier of platform-level administrators. There is no group. There is no plural "super admins."

The literal database token used to mark this identity is `public.profiles.role = 'super_admin'`. The token is an *internal schema identifier*, not a permission tier. Exactly one row in `public.profiles` carries this value in any healthy production state.

---

## What this rules out

- **No "team of super_admins."** If two people both need platform-wide authority, that is a governance change — not a role-permission change — and must be deliberated explicitly before any code follows.
- **No future migration that grants `super_admin` to multiple operators by default.** Any such migration must be vetted at the doctrine level first.
- **No customer-facing UI that exposes the literal token `super_admin`.** Customer surfaces refer to the Platform Owner's actions as **"NEXPEC Admin"** or **"NEXPEC System"**.

## What this allows

- Internal operations staff carry `role = 'admin'`. This is a *multi-user* tier with permission-scoped moderation duties. It is distinct from the Platform Owner and never confused with it.
- Tenant-scoped Enterprise Admins (`org_members.role IN ('owner', 'procurement_admin')`) govern their *own* organization. They are arbitrarily multiple per tenant and never have platform-wide authority.

---

## Terminology contract

The single source of truth for how to refer to the Platform Owner in any context:

| Audience | Use this term |
|---|---|
| Customers (clients, inspectors, agencies — any non-internal surface) | **"NEXPEC Admin"** or **"NEXPEC System"** |
| Investors / VCs / due-diligence prose | **"NEXPEC Platform Owner"** (capitalized, singular) |
| Internal architecture docs and design discussions | **"the sole platform authority"** or **"the Platform Owner identity"** |
| Database / code references to the literal schema token | `role = 'super_admin'` — always paired with a clarifying note that this is *the single Platform Owner identity stored as `super_admin` in the schema* |

---

## How to write new code that respects the invariant

When designing a new authorization predicate:

```ts
// ✅ Correct — implies singular authority
if (isNexpecPlatformOwner(userRole) || hasTenantPermission(...)) { ... }

// ❌ Wrong — implies a tier of platform admins
if (isAnyPlatformAdmin(userRole) || ...) { ... }
```

When writing a new RPC's authorization gate:

```sql
-- ✅ Correct (matches existing pattern)
IF NOT EXISTS (
  SELECT 1 FROM public.profiles
   WHERE id = auth.uid() AND role = 'super_admin'
) THEN ...

-- ❌ Wrong — implies a permission tier
IF NOT (auth.uid() IN (SELECT id FROM public.platform_admins)) THEN ...
```

When writing a new customer-facing audit summary or notification:

```ts
// ✅ Correct — what the customer sees
summary: 'Reassigned by NEXPEC Admin · cost-center correction'

// ❌ Wrong — leaks the schema token
summary: `Reassigned by ${event.actor_role} · cost-center correction`
```

When adding a new client-portal banner or label that references the Platform Owner:

```tsx
// ✅ Correct
<span>You're viewing this as the NEXPEC Platform Owner.</span>

// ❌ Wrong (and would have failed the May 2026 audit)
<span>You're viewing this as super_admin.</span>
```

---

## How to flag a violation

1. If you spot a customer-facing surface that surfaces the literal token `super_admin` — open a fix immediately. Cite this document.
2. If you find a code path that assumes multiple platform-level operators — pause and consult the Platform Owner before proceeding. This is governance, not refactoring.
3. If you see a new role being added to `profiles.role` with platform-wide authority — same: pause.

---

## Why this doctrine exists

A platform with a single named owner has a single audit lens, a single line of accountability, and a single point of escalation for security incidents. Investors and enterprise customers reading NEXPEC's security posture understand exactly who can reach their data at the platform tier — one person. That clarity is a feature, not a limitation, and the doctrine preserves it through every future change.

---

## Cross-references

- `NEXPEC_Capabilities_Matrix.md` §0, §4, §4.5 — the customer-facing terminology audit and full governance prose
- `apps/web/src/components/messaging/MessageThread.tsx` — the "NEXPEC Admin" badge that surfaces the Platform Owner's chat messages to customers
- `apps/web/src/app/client/structure/page.tsx` — banner copy that refers to "the NEXPEC Platform Owner" rather than the schema token
- Every `can_manage_org_structure(p_org_id, p_user_id)` call site — the canonical authorization predicate uniting the Platform Owner with tenant-scoped Enterprise Admins under one helper
