---
name: effort-max
description: "Use PROACTIVELY for the hardest work in nexpec, above the normal critical tier. Trigger on: extremely complex investigations; critical security defects and suspected exploitable holes; cross-system migrations that span schema, RPCs, edge functions and clients together; payment ARCHITECTURE work such as the staged-funding spine, escrow/ledger reconciliation or settlement-model changes; and difficult integration failures where subsystems interact and the failure is not localized. Also use when xhigh-effort work has already failed to resolve the problem, or when a defect spans several lanes at once. Do NOT use for ordinary migrations, RLS or payment changes — effort-critical covers those."
effort: max
---

# Maximum-effort work (max effort)

Raises reasoning effort to `max` — the deepest per-message reasoning available from
frontmatter. Reserve it for problems where `xhigh` is genuinely not enough.

## When this tier is correct

- **Extremely complex investigations** — the cause spans modules, or the evidence conflicts
- **Critical security defects** — suspected exploitable exposure, privilege escalation,
  anonymous-grant holes, forged identity or authorization bypass
- **Cross-system migrations** — schema + RPC + edge function + web + mobile moving together
- **Payment architecture** — the staged-funding spine, escrow/hold/ledger reconciliation,
  settlement model changes. (A single payment *change* is `effort-critical`; redesigning how
  funding is *structured* is this tier.)
- **Difficult integration failures** — subsystems interact, no single owner, not localized
- **Escalation** — `effort-critical` was already applied and the problem survived it

## Cost discipline

`max` can show diminishing returns and is prone to overthinking. It is not a badge for
"important" work — importance alone is `effort-critical`. Use this tier when the problem is
genuinely *hard*, not merely high-stakes. If the answer becomes clear early, stop and act;
do not manufacture depth to justify the level.

## Method at this tier

1. State the question and what evidence would actually settle it.
2. Build competing hypotheses before committing to one, and try to falsify the leading one.
3. Verify load-bearing claims against source. Distinguish what you read from what you inferred.
4. Name the blast radius and the reversible path before changing anything.
5. Report unresolved uncertainty explicitly rather than closing it prematurely.

## Above this tier: Ultracode

Ultracode is **not** a frontmatter effort value and cannot be activated automatically — it is
a session-scoped Claude Code setting that sends `xhigh` per message *and* orchestrates dynamic
workflows. Use it for the most demanding codebase-wide reasoning, final security red teams,
major architecture reconciliation and release-critical investigations.

To activate, the owner runs one of:

```
/effort ultracode
```

or relaunches the session with `claude --effort ultracode` (requires Claude Code v2.1.203+;
this machine's desktop runtime is v2.1.227, so both paths are available).

When a task warrants ultracode, say so and explain why — then continue at `max` unless the
owner turns it on.
