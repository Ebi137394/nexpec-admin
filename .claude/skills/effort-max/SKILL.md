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

## Beyond this tier: Ultracode

Ultracode is **not** a frontmatter effort value and cannot be set from a skill or agent file.
Verified against the runtime: the valid frontmatter enum is
`low, medium, high, xhigh, max` (or an integer 1–1000). Writing `effort: ultracode` is
rejected by the parser, logged as an invalid effort, and **silently dropped** — the turn then
inherits whatever effort was already in force. Never write it in YAML.

**What ultracode actually is.** Selecting it sets two things on the session:
`effortValue: "xhigh"` and `ultracode: true`. So its per-message reasoning is `xhigh` —
*lower* than this skill's `max`. What it adds is **dynamic workflow orchestration**: Claude
writes a script that fans out and coordinates many subagents. Ultracode outranks `max` in
breadth and coordination, not in depth per message.

Use it for the most demanding codebase-wide reasoning, final security red teams, major
architecture reconciliation and release-critical investigations — work whose difficulty is
*scale and coordination* rather than a single hard chain of reasoning.

**Activation (session-scoped, owner-driven).** Any one of:

- the effort picker in the Claude Desktop UI — the practical path on this machine
- `/effort ultracode` in an interactive terminal session
- launching with `claude --effort ultracode`
- mentioning the keyword `ultracode` in the prompt, or asking for a dynamic workflow directly

When a task warrants ultracode, say so and explain why — then continue at `max` unless the
owner turns it on. Recommending it is correct; claiming you switched to it is not.
