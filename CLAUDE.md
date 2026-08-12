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
- **Ultracode** — most demanding codebase-wide reasoning, final security red teams, major
  architecture reconciliation, release-critical investigations. **Session-scoped; cannot be
  activated from frontmatter.** Owner runs `/effort ultracode`, or relaunches with
  `claude --effort ultracode` (needs v2.1.203+; desktop runtime here is v2.1.227).

| Level | Mechanism | Switches automatically? |
|---|---|---|
| `medium` | `effort-routine` skill frontmatter | Yes |
| `high` | `effort-standard` skill frontmatter | Yes |
| `xhigh` | `effort-critical` skill + `deep-investigator` agent | Yes |
| `max` | `effort-max` skill frontmatter | Yes |
| `ultracode` | `/effort ultracode` or `--effort ultracode` | **No — session-level only** |

Rules:
- Prefer escalating over pushing through. If a routine edit grows a shared dependency, an
  unexpected test failure, or touches the critical surface, move up a tier mid-task.
- Never silently downgrade. `effort-routine` is only for work that is genuinely trivial.
- `max` is available automatically but is not the default for ordinary work — importance alone
  is `xhigh`; `max` is for problems that are genuinely *hard*.
- When a task warrants ultracode, say so and explain why, then continue at `max` unless the
  owner turns it on.

