---
name: effort-ultracode
description: "Use PROACTIVELY for the very top of the nexpec effort hierarchy, above effort-max. Trigger on: codebase-wide reasoning that must hold many subsystems in view at once; final security red teams before a release; major architecture reconciliation where several designs must be merged into one; and release-critical investigations gating a launch. Also use when effort-max has already been applied and the problem is still open, or when the work needs many parallel investigations coordinated rather than one deep chain of reasoning. This skill pins xhigh effort automatically and tells you when to ask the owner to switch the session into ultracode for dynamic workflow orchestration. Do NOT use for ordinary migrations, RLS, auth or payment changes — effort-critical covers those — or for a single hard problem, which is effort-max."
effort: xhigh
---

# Ultracode tier

The highest rung of the nexpec hierarchy. Reserve it for work whose difficulty is **scale and
coordination**, not a single deep chain of reasoning.

## What this skill can and cannot do

Read this carefully — the distinction is real and must not be blurred in what you tell the owner.

- **Automatic:** this skill pins reasoning effort to `xhigh`. That is *exactly* the per-message
  effort ultracode itself runs at, so invoking this skill already gives you ultracode's depth.
- **Not automatic:** ultracode's other half — **dynamic workflow orchestration**, where Claude
  writes a script that fans out and coordinates many subagents — is session-scoped. It cannot be
  enabled from skill or agent frontmatter, and this skill does not enable it.

Verified against the runtime: selecting ultracode sets `effortValue: "xhigh"` **and**
`ultracode: true`. The frontmatter effort enum is `low, medium, high, xhigh, max` (or an
integer 1–1000); `ultracode` is **not** a member. Writing `effort: ultracode` in YAML is
rejected, logged as invalid, and silently dropped — leaving the turn at whatever effort was
already in force. Never write it.

Note the consequence: ultracode's per-message effort (`xhigh`) is **lower** than `effort-max`'s
`max`. Ultracode outranks `max` in breadth and coordination, not in depth per message. If the
problem is one genuinely hard chain of reasoning, `effort-max` is the better tool.

## When this tier is correct

- **Codebase-wide reasoning** — the answer depends on web, mobile, Supabase schema, RPCs, edge
  functions and Stripe together, and no single subsystem contains it
- **Final security red team** — a systematic adversarial pass before release, not one defect
- **Major architecture reconciliation** — competing designs merged into one coherent model
- **Release-critical investigation** — a launch gate depends on the answer
- **Escalation** — `effort-max` was applied and the problem survived it
- **Fan-out shape** — the work decomposes into many independent investigations to coordinate

## Asking for the session switch

When the work genuinely needs orchestration, tell the owner plainly: what you are doing at
`xhigh` now, what the workflow layer would add, and that it is their switch to flip. Then
**continue working** — do not stall waiting for it.

Activation is any one of:

- the effort picker in the Claude Desktop UI — the practical path on this machine
- `/effort ultracode` in an interactive terminal session
- launching with `claude --effort ultracode`
- mentioning the keyword `ultracode` in the prompt, or asking for a dynamic workflow directly

Recommending the switch is correct. Claiming you performed it is not — you cannot.

## Method at this tier

1. **Decompose before investigating.** Name the independent questions and what evidence settles
   each. This is the step that makes the tier worth its cost.
2. **Fan out where it is safe** — the `deep-investigator` agent runs isolated at `xhigh` and
   returns findings rather than edits. Use it for separable questions.
3. **Reconcile actively.** Subagents return conflicting claims; resolve conflicts against source
   rather than averaging them.
4. **Verify load-bearing claims yourself.** Distinguish what you read from what an agent reported
   and from what you inferred. A subagent's confident wrong answer is still wrong.
5. **State residual uncertainty** explicitly instead of closing it to look finished.

## Cost discipline

This tier is expensive and slow. Importance alone does not justify it — that is
`effort-critical`. A single hard problem is `effort-max`. Come here when the work is *wide*.
If the answer resolves early, stop and act.
