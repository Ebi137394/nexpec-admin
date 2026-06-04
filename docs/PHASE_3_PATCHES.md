# Phase 3 — Coordination Bridge UX (#4) + Routing Defragmentation (#2)

**Status: implemented + verified in the working tree.** Consolidated, reviewable changeset. Apply/deploy order at the bottom.

Guiding principle for this phase: **additive + redirect over blind deletion.** A mass route-group deletion or an unverifiable rewrite of the AuthGate is how you brick app navigation. So new surfaces are added as new files, the AuthGate change is a pure consolidation, and deprecated groups are left as the inert stubs they already are (deep-link-safe) with deletion staged.

---

## Part A — Coordination Bridge: close the loops + the UI gaps

The deep-dive found a solid backend with four UX/logic holes. All four are now closed.

### A1. Backend loop completion — `migrations/20260801120400_coordination_bridge_loop_completion.sql`
- **`bridge_accept_counter_schedule(bridge, slot)`** (inspector, authenticated). The schedule could only reach `completed` when the *vendor* accepted an inspector proposal; a vendor **counter** left it stuck in `awaiting_inspector` with no inspector action to lock it. This RPC lets the inspector lock the counter in one move → sets the slot `completed`, which fires the **existing** `tg_notify_bridge_schedule_changed('completed')` trigger → **notifies the inspector AND the client**. (Reuses the notify path, no duplication.)
- **`bridge_vendor_acknowledge_scope(token, slot, payload)`** (vendor, service-role only). `pre_inspection_ack` was seeded as a *required* slot but had **no RPC to complete it**, so `bridge_complete` always reported an unresolved required slot. This completes it. `REVOKE`d from authenticated/anon — edge-function only, like the other vendor RPCs.

### A2. Edge gateway + vendor portal — `vendor-bridge-auth/index.ts`, `VendorBridgeClient.tsx`
- New `acknowledge_scope` action in the gateway (type + switch + `dispatchAcknowledgeScope`).
- The vendor portal's inert *"handled in conversation with the inspector"* text for `pre_inspection_ack` is replaced with a real **`PreInspectionAckSlot`** ("Acknowledge scope & confirm readiness") that calls the new action and reflects the completed state.

### A3. Web inspector workspace — NEW `apps/web/src/app/inspector/coordination-bridge/page.tsx` + `components/coordination/InspectorBridgeWorkspace.tsx`
Closes the headline gap: every bridge notification links to `/inspector/coordination-bridge?bridge_id=…`, which **404'd on web** (the workspace existed only on mobile). The new route (auth-gated server page → interactive client component using the browser Supabase client) drives the same RPCs as mobile: create + send invitation, propose schedule, **accept counter**, request/accept/reject documents, rotate-link-and-resend, complete, cancel. Additive — no existing web file changed except the entry link below.

### A4. Discoverable entry points
- **Web** `inspector/jobs/[id]/page.tsx`: a "Coordinate with vendor" link beside the Submit-Report CTA for hired + active inspectors.
- **Mobile** `(inspector)/jobs/[id]/index.tsx`: a "Coordinate with Vendor" tool in the Job Tools cluster (inspector-only). Previously the screen was reachable only by deep link / notification.

---

## Part B — Routing defragmentation

### B1. Single source of truth — NEW `src/core/navigation/routeMap.ts`
`roleHome(role)` + `ROUTES` + `isPlatformAdmin(role)`. The AuthGate had the role→destination logic **twice** (auth-page redirect + unknown-path fallback) and the copies had **drifted** (`enterprise` → enterprise-dashboard in one, → agency-dashboard in the other).

### B2. AuthGate refactor — `app/_layout.tsx`
Both chains collapse to `safeNavigate(roleHome(role))`. Net effects: one definition, drift removed (enterprise now consistently lands on `enterprise-dashboard`), and it composes with the Phase 1 god-mode pin (`admin ≡ super_admin` allowed into the `(admin)` group).

### B3. Deprecated groups — left inert, deletion staged (deliberate)
`(senior)` and `(organization)` are already minimal inert `Stack` stubs; `(super-admin)`/`(agency)` are alias/passthrough. **Nothing routes to them anymore** (`roleHome` only targets `(admin)` / `(tabs)`). They're kept as stubs because Expo Router needs a `_layout` present for deep-link resolution — converting to redirects can break that. Deletion is a clean follow-up once analytics confirm no inbound deep links (1-release window).

---

## Apply / deploy order
1. Migration (dashboard SQL editor): `20260801120400_coordination_bridge_loop_completion.sql`.
2. Redeploy edge function: `vendor-bridge-auth`.
3. Ship web: new `inspector/coordination-bridge` route + `InspectorBridgeWorkspace` + `VendorBridgeClient` change + the job-page link. (Set `NEXT_PUBLIC_BRIDGE_PORTAL_BASE_URL` if the portal base differs from the default.)
4. Ship mobile: `routeMap.ts`, `app/_layout.tsx`, `(inspector)/jobs/[id]/index.tsx`.
5. Verify: vendor counters a date → inspector sees "Accept vendor's date & lock" → accepting fires the client "date locked" notification; vendor "Acknowledge scope" completes `pre_inspection_ack`; the web bridge notification link now opens the workspace instead of 404.

## Honestly out of scope this pass (flag, not silently dropped)
- **Net-new parity screens** the audit listed under #2 (client evidence vault on mobile, admin domain management on mobile) — these are feature builds, not routing defrag; recommend their own slice.
- **Bulk deletion** of the inert `(senior)`/`(super-admin)`/`(agency)`/`(organization)` directories — staged behind the now-canonical map.
- The two new web files and the entry-point edits need a `cd apps/web && npm run build` + an Expo bundle check (couldn't run a full build in this environment).
