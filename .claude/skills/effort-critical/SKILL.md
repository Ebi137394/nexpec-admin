---
name: effort-critical
description: "Use PROACTIVELY and AUTOMATICALLY before any high-risk change in nexpec. Trigger on: Supabase migrations or any .sql file; RLS policies and grants; authentication, MFA, OAuth, biometric or session handling; Stripe payments, payouts, Connect, wallet, refunds or money math; security, secrets, tokens and key handling; race conditions, concurrency, idempotency and retry logic; architectural or schema changes; and any change with high regression risk or that touches production data. Also use when debugging is difficult, a bug is intermittent or non-reproducible, or two or more prior fix attempts have failed."
effort: xhigh
paths:
  - "supabase/migrations/**"
  - "supabase/functions/**"
  - "supabase/**"
  - "sql/**"
  - "**/*.sql"
  - "app/(auth)/**"
  - "**/auth/**"
  - "**/*auth*"
  - "**/wallet/**"
  - "**/*payment*"
  - "**/*stripe*"
  - "**/*payout*"
  - "**/money.ts"
---

# Critical-path work (xhigh effort)

This skill raises reasoning effort to `xhigh` because the work in scope can lose money,
leak data, or corrupt production state. Slow down. Correctness beats speed here.

## Scope

Use this for:

- **Database**: migrations, schema changes, RLS policies, grants, RPCs, indexes, triggers
- **Auth**: sign-in/up, MFA, OAuth callbacks, biometric, session/token lifecycle, role checks
- **Money**: Stripe intents, Connect, payouts, wallet top-ups/withdrawals, refunds, fee math
- **Security**: secrets, API keys, service-role usage, input validation, injection surfaces
- **Concurrency**: race conditions, idempotency, retries, webhook replay, ordering
- **Architecture**: cross-cutting refactors, data-model changes, contract changes
- **Hard debugging**: intermittent failures, or anything where 2+ fixes already failed

## Required checks before proposing a change

1. **Read the current state first.** For SQL, read neighbouring migrations in
   `supabase/migrations/` — there are 150+ and ordering matters. Never assume schema.
2. **RLS**: state explicitly which role each policy applies to and confirm the change
   cannot widen access. Anything using the service-role key bypasses RLS — call that out.
3. **Money**: confirm idempotency (Stripe webhooks retry). Check integer/minor-unit
   handling against `lib/money.ts` rather than introducing float math.
4. **Migrations are forward-only in production.** Check whether `supabase/rollback/`
   needs a matching entry. Never edit an already-applied migration in place.
5. **Name the blast radius** before editing: what breaks if this is wrong, and who notices.

## Output expectations

- State assumptions you could not verify from the source.
- Prefer the reversible change; if the change is irreversible, say so before making it.
- If the safest path needs a decision only the user can make, stop and ask.

## Escalating above this tier

`xhigh` is the right level for ordinary critical-path work. Escalate further when the task
is genuinely harder than "this is high-risk":

- **`effort-max`** — invoke it for extremely complex investigations, critical security
  defects, cross-system migrations, payment *architecture* (as opposed to a payment change),
  and difficult integration failures. It is a skill, so it activates automatically.
- **Ultracode** — for the most demanding codebase-wide reasoning, final security red teams,
  major architecture reconciliation and release-critical investigations. It **cannot** be
  activated from frontmatter; it is session-scoped. Ask the owner to run `/effort ultracode`
  (or relaunch with `claude --effort ultracode`), and say why the task needs it.

Do not select these for ordinary critical-path work — `xhigh` already covers migrations,
RLS, auth and payments in the normal case.
