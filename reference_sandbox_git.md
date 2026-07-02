---
name: reference-sandbox-git
description: "Sandbox operational gotchas for committing, deleting, and type-checking in the NEXPEC mounted folder"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

Operating on the NEXPEC mount from the Linux sandbox:

- **Git identity isn't preset.** Before the first commit in a session, set repo-local identity to match history: `git config user.name "Ebi" && git config user.email "ebrahimfeyzi.ta@gmail.com"`.
- **File deletion is gated.** `rm` fails with "Operation not permitted" until the `allow_cowork_file_delete` tool is called for the NEXPEC folder (once per session unlocks it).
- A stale `.git/index.lock` can linger after an interrupted git call — safe to `rm -f .git/index.lock` (bash calls are independent and short-lived, so nothing is actually running).
- **Full-project `tsc --noEmit` exceeds the 45s bash window** and background jobs don't survive across independent bash calls. To verify a change, write a temp `tsconfig.check.json` that `extends ./tsconfig.json` and `include`s only the changed files, run `tsc -p` on it, then delete it.
- **COMMIT EDITS PROMPTLY — uncommitted working-tree changes can be LOST on session remount.** Burned once (2026-06): made ~18 files of lint cleanup + a11y fixes via Edit/sed, verified them, but did NOT commit; the session resumed with a fresh mount from the user's real disk and all uncommitted edits were gone (the user's re-run showed the old state). Committed work always survives (it's in git, which the user can push — Vercel built my commits). Rule: after a coherent batch of edits, `git add` + `git commit` immediately; don't leave verified work uncommitted across turns. The task list (TaskCreate/TaskUpdate) is also ephemeral and can reset on remount — don't rely on it persisting.
- **Bash (VM-mount) writes and Edit/Read-tool (Desktop-path) writes RACE on the same file.** They target the same logical file but sync with a lag. If I run a bash script that rewrites files (e.g. a codemod), then use the Edit tool on one of those files shortly after, the Edit tool can read a pre-script copy and write it back — silently reverting the script's other changes in that file. Burned 2026-06 on reports.tsx (codemod fixed 4 lines; a later Edit to line 231 reverted the other 3). RULE for bulk sweeps: do per-file touch-ups via bash too, OR run the bash codemod LAST so its write wins; don't interleave Edit-tool edits between a bash write and verification of the same file. Re-running an idempotent codemod at the end repairs any reverts.
- **`git stash push` chained with a slow command that hits the 45s timeout leaves the tree reverted + a dangling stash** (the `git stash pop` never runs). Burned 2026-06: `git stash push -- app src && <double tsc>` timed out before pop, reverting 400+ uncommitted lines. Run stash/pop in their own short bash calls, never chained with tsc.
- **Once the user runs `npm install`, the installed `node_modules/.bin` tools (eslint, etc.) ARE runnable in the sandbox** (the mount includes node_modules), so I can self-verify lint/build instead of guessing. Before that, the npm registry is network-blocked (lookups hang) so I can't install.
