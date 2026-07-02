---
name: feedback_patch_delivery_workflow
description: "ALWAYS hand ebi explicit File/OLD_STR/NEW_STR patches for every code change — don't rely on workspace tool-edits reaching his deployed repo"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

CORRECTED MODEL (verified 2026-06-05): the mounted workspace `/Users/ebrahimfeyzi/Desktop/nexpec` **IS the live `github.com/Ebi137394/nexpec-admin` git repo, branch `main`** (the Vercel deploy source). So my Read/Edit/`git commit` land in his real repo — they are NOT throwaway. BUT: **`git push` from the sandbox FAILS — `fatal: unable to access … HTTP code 403 from proxy after CONNECT`.** The sandbox has no GitHub egress/auth. So a change is only deployed once it is committed AND **ebi runs `git push origin main` himself**.

**Why the ESLint fix "kept failing":** I edited the working tree but didn't commit; the Vercel log he pasted (55641e0) predated the fix commit (8406c85). Once committed+pushed it was fine. The lesson is NOT "edits don't reach him" — it's "edits must be committed and pushed; I can do the commit, he must do the push."

**How to apply going forward:** (1) make the edit, (2) verify (tsc/lint), (3) `git commit` it with a clear conventional message (set identity inline: `git -c user.email=ebrahimfeyzi.ta@gmail.com -c user.name=ebi commit`), (4) tell ebi the exact `git push origin main` to run (and how many commits he's ahead). He also sometimes prefers explicit File/OLD_STR/NEW_STR patches — provide those when he asks for that format. Relates to [[reference_web_build_typecheck_gated]] (degraded ESLint config: never add `@typescript-eslint/*` or `@next/next/*` disable directives) and [[reference_sandbox_git]].