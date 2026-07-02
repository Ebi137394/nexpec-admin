---
name: project-separator-polish
description: "App-wide removal of AI-style separators (em-dash / middot / en-dash) from NEXPEC UI copy, web + mobile"
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

ebi wants the UI to read like high-end enterprise software, not an "AI playground": NO em-dashes (—), middots (·), or spaced-hyphens used as decorative/sentence separators in user-facing copy. He flagged it after spotting "Steps auto-tick as you complete them — no need to come back here" on the client dashboard. Chosen scope: ALL text-symbol separators. Chosen method: automated codemod + full diff review.

What it is: the whole app was authored in a house style heavy with these separators — ~800-1,200 genuine user-facing instances across ~400 files (the procurement surface was just the tip).

Done (2026-06-05, committed; ebi must `git push`):
- Procurement/marketplace surface (earlier commit 33db5c6).
- Web `apps/web/src`: commit be95cc1, 216 files. `npm run typecheck` 0 + `next lint` clean.
- Mobile `app/` + `src/`: committed (160 files). No NEW tsc errors (the lone TS1015 in src/core/supabase/supabase.ts is pre-existing; ~186 TS2xxx are pre-existing schema/halalas types).
- Onboarding checklist (the flagged screen) + progress pill middot fixed.

Transform rules (the codemod): spaced ` — `/` · ` → comma; en-dash ` – ` → " to " (it's almost always a range); date/money ranges → "to"; decorative `— X —` null-option labels → clean text; brand chip "NEXPEC · Platform" → "NEXPEC Platform". EXCLUDED: comments (line/block/JSX `{/* */}`), legal text (`/legal/`, jobContracts.ts, compliance-notices), numeric ranges (1–2), and empty-value `'—'` placeholders (kept — they mean "no value").

Reusable tooling (scratchpad, may not persist): `codemod-separators.mjs` (per-LINE tokenizer so JSX apostrophes can't bleed; protects strings/comments; `/*` inside strings like `accept="image/*"` no longer fools it) and `scan-separators.mjs`. Codemod is idempotent — safe to re-run.

DONE — styled middot-separator ELEMENTS (commit c7cfafc, 2026-06-05): 23 `<Text style={s.dot}>·</Text>` metadata separators across 16 mobile screens (assignments, client/inspector disputes, admin+client vault, admin+super-admin financial + _shared, cci-applications, org-management, flash-reports, tabs/jobs, AssetVault, DocumentField, RealtimeIndicator, mobile onboarding pill). Per-component check first: every parent row already had flex `gap`, so the dot element was simply deleted (whitespace separates); only the onboarding `pill` lacked gap → added `gap: 4`. Verified 0 leftover `>·<`, 0 empty `<></>` fragments, 0 new TS1xxx in changed files. Earlier supplier-directory god-mode fix (fa74d1f) is separate, see [[project_public_anonymization]].

GOTCHA that bit this pass: the Edit tool's file-read state persists only ONE message forward — reads done 2+ messages before an Edit are rejected ("File has not been read yet"). In a multi-file edit batch, Read the files in the message immediately before the Edits. Also the bash-vs-Edit write-race (see [[reference-sandbox-git]]).
