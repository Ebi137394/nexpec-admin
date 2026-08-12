---
name: effort-standard
description: "Use PROACTIVELY for normal day-to-day engineering in nexpec: implementing a feature or screen, ordinary debugging, refactoring, writing or fixing tests, wiring React Query hooks, component and navigation work, and general TypeScript changes. This is the default working mode. Use it to return to normal effort after a routine low-effort edit, or when a task that looked trivial turns out to need real reasoning. Do NOT use for migrations, RLS, auth, payments, security, concurrency or architectural changes — those must use effort-critical."
effort: high
---

# Standard engineering (high effort)

Pins reasoning effort to `high`, which is also the session default. Its job is to be the
explicit middle rung: it **restores** normal effort when a turn would otherwise inherit a
lowered level, and it gives Claude a target to escalate to from `effort-routine`.

## Scope

- Feature and screen implementation (Expo Router, React Native components)
- Ordinary debugging with a reproducible failure
- Refactoring within a module, and test writing/repair
- Data fetching, React Query, context/provider wiring
- Type changes that stay inside a module boundary

## Working expectations

- Read before editing; match the file's existing idiom and naming.
- Run the relevant test or typecheck rather than declaring success by inspection.
- Report failures honestly with the actual output.

## Escalate to `effort-critical` when the task turns out to involve

migrations or SQL, RLS, auth/session/MFA, Stripe/wallet/payout/money math, secrets,
race conditions or idempotency, cross-cutting architecture, or a bug that survived two
fix attempts. Escalation is expected — take it rather than pushing through at this level.
