# src/roles/organization/components/

**Status:** Greenfield. Established in **Lane B — Phase 5.3** as the canonical
home for Enterprise / Organization-seat-specific UI components.

## Empty by design

Per **ORG-AGR-001 §1**, Organization users are *enterprise Clients* — every
Job posted under an Organization Seat operates under CLI-AGR-001 in full,
plus the ORG-AGR-001 enterprise terms. So most Organization screens today
route through `app/(client)/*` and reuse the Client component tree in
`src/roles/client/components/*`.

## When to add files here

Add a file under `src/roles/organization/components/` only when it is:

1. **Strictly Enterprise-only** — Order Form review, Seat admin panel,
   DPA-acceptance ledger UI, audit-log exports, custom-Order-Form
   surfaces, etc.
2. **Not part of the Client experience** — anything a non-Enterprise
   Client would never see.

For everything else, use `src/roles/client/components/*`.

## Surrounding structure (Lane A target tree)

```
src/roles/organization/
├── components/    (this folder — Enterprise-only UI)
├── hooks/         (Enterprise-only hooks; e.g., useOrderForm, useSeatAdmin)
└── services/      (Enterprise-only API wrappers)
```

## Cross-refs

- **Legal stack:** `src/legal/registry.ts` resolves ORG-AGR-001 + DPA-001
  + ORDER-FORM-001 for Organization users via `useResolvedLegalStack()`.
- **Route group:** `app/(organization)/_layout.tsx` is the scaffolded
  route group for Organization-specific screens.
