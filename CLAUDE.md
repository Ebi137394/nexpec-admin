## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Effort routing

Effort is routed automatically by skill. Do not ask the user to change effort levels manually.
The session runs Opus at `high`; the skills below override effort for the turn they are active.

- **`effort-routine`** (medium) — simple, low-risk, single-file edits where the fix is already known.
- **`effort-standard`** (high) — normal implementation, debugging, refactoring, tests. The default.
- **`effort-critical`** (xhigh) — invoke automatically and without being asked for: Supabase
  migrations and any `.sql`, RLS policies, auth/MFA/OAuth/session, Stripe payments, payouts,
  wallet and money math, secrets and security, race conditions and idempotency, architectural
  changes, and any high-regression-risk work. Also for hard debugging, or after two failed fixes.
- **`effort-max`** (max) — extremely complex investigations, critical security defects,
  cross-system migrations, payment *architecture*, and difficult integration failures. Also
  when `effort-critical` was already applied and the problem survived it.
- **`deep-investigator`** subagent (xhigh, isolated context) — for sustained investigation that
  would otherwise flood the main conversation. Returns findings, not edits.
- **`effort-ultracode`** (xhigh + workflow orchestration) — the top tier: codebase-wide
  reasoning, final security red teams, major architecture reconciliation, release-critical
  investigations. Also when `effort-max` was applied and the problem survived it.

### What actually switches automatically

Verified against the runtime executing this project
(`~/Library/Application Support/Claude/claude-code/2.1.227`). The frontmatter effort enum is
`low, medium, high, xhigh, max`, or an integer 1–1000. **`ultracode` is not a member of that
enum** — writing `effort: ultracode` in YAML is rejected, logged as invalid, and silently
dropped, leaving the turn at its inherited effort. Never write it.

| Tier | Mechanism | Automatic? |
|---|---|---|
| `medium` | `effort-routine` skill frontmatter | **Yes** — model-invoked |
| `high` | `effort-standard` skill frontmatter | **Yes** — model-invoked; also the session default |
| `xhigh` | `effort-critical` skill frontmatter + `paths:` globs + `deep-investigator` agent | **Yes** — model-invoked, and glob-triggered on the critical file surface |
| `max` | `effort-max` skill frontmatter | **Yes** — model-invoked |
| `ultracode` | `effort-ultracode` skill pins `xhigh` automatically; the **dynamic-workflow half is session-scoped** | **Partial** — depth yes, orchestration no |

**Ultracode, precisely.** Selecting it sets `effortValue: "xhigh"` *and* `ultracode: true`. Its
per-message effort is therefore `xhigh` — *lower* than `max`. What it adds is dynamic workflow
orchestration (Claude scripts and coordinates many subagents). It outranks `max` in breadth and
coordination, not in depth. The `effort-ultracode` skill delivers the `xhigh` half
automatically; only the owner can enable the orchestration half, via any of:

- the effort picker in the Claude Desktop UI — the practical path on this machine
- `/effort ultracode` in an interactive terminal session
- launching with `claude --effort ultracode`
- mentioning the keyword `ultracode` in the prompt, or asking for a dynamic workflow directly

Recommend the switch when the work warrants it, explain why, and keep working. Never claim to
have switched the session yourself — a skill cannot do it.

Rules:
- Prefer escalating over pushing through. If a routine edit grows a shared dependency, an
  unexpected test failure, or touches the critical surface, move up a tier mid-task.
- Never silently downgrade. `effort-routine` is only for work that is genuinely trivial.
- `max` and `effort-ultracode` are both available automatically and must stay available — but
  neither is the default for ordinary work. Importance alone is `xhigh`. Reach for `max` when a
  problem is genuinely *hard*, and `effort-ultracode` when it is genuinely *wide*.
- When a task warrants the ultracode session switch, say so and explain why, then keep working
  at `xhigh` unless the owner turns it on. Never claim to have switched it yourself.

