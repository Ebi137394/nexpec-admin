---
name: reference_account_roles
description: "NEXPEC has SIX account roles → four web portals; \"all accounts\" work must cover all six (esp. agency + enterprise)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

NEXPEC account roles (ebi confirmed 2026-06-05): **Admin, Client, Agency, Enterprise (aka "Organization"), Inspector, Supplier.** Plus `super_admin` ≡ `admin` (god-mode, [[feedback_god_mode_admin]]).

**Web → 4 portals** (`destinationForUser` in `apps/web/src/lib/auth/actions.ts` ~L70):
- `admin` / `super_admin` → `/admin`
- `inspector` → `/inspector`
- `client` + `agency` + `enterprise` → **all share `/client`** (UI-identical buyer portal; data isolation by `client_id = auth.uid()`)
- `supplier` → `/suppliers`
`PUBLIC_SIGNUP_ROLES = client, inspector, agency, enterprise`; supplier onboards separately. `onboardingActions.ts` ROLES = client/inspector/agency/enterprise/supplier.

**Mobile → 6 distinct dashboards:** `app/(tabs)/{supplier-dashboard, agency-dashboard, enterprise-dashboard, inspector-dashboard}.tsx`, `app/(admin)/dashboard.tsx`, and the client dashboard. Chat is unified for everyone at `app/inbox/[id].tsx`.

**How to apply — "all accounts" = all SIX.** The trap I hit: I kept treating it as 4 (admin/client/inspector/supplier) and forgot **agency + enterprise**. On web they ride the client portal (so client-portal changes auto-cover them), but on **mobile they have their own dashboards** that each need wiring. Example: enterprise-dashboard was missing a chat entry point entirely — added a Messages icon → `/inbox` (2026-06-05). Always sweep agency + enterprise mobile dashboards too. See [[feedback_support_chat_copy_and_composer]], [[project_cross_platform_parity]].
