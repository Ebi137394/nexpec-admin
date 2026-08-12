---
name: effort-routine
description: "Use PROACTIVELY for simple, low-risk, self-contained edits where the correct change is obvious and the blast radius is one file. Examples: copy and string changes, comments, formatting, import sorting, renaming a local variable, adding a log line, styling and spacing tweaks, updating a doc or README, bumping a constant. Do NOT use for anything touching SQL, migrations, RLS, auth, Stripe, payments, wallet, security, concurrency, or shared/exported code — those must use effort-critical instead."
effort: medium
---

# Routine edits (medium effort)

Reasoning effort is lowered to `medium` to save tokens on work that does not need deep
analysis. This applies to the current turn only.

## Only applies when ALL of these hold

- The change is confined to a single file, or a few files in a purely mechanical way
- No behavioural change to shared, exported, or cross-module logic
- Nothing in the critical set: SQL/migrations, RLS, auth, Stripe/payments/wallet,
  security, tokens/secrets, concurrency, architecture
- You already know the fix — no investigation is required
- Getting it wrong is cheap and immediately visible

## Bail-out rule

If, while working, any of these appear — an unexpected dependency, a shared type, a
test failure you did not predict, or anything in the critical set — **stop applying this
skill**. Re-approach the task under `effort-standard`, or `effort-critical` if it touches
the high-risk surface. Do not push a low-effort change through a problem that grew.
