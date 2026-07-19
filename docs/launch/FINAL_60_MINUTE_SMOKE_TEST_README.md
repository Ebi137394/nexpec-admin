# Final 60-Minute Pre-Build Smoke Test — how to use

A single self-contained interactive checklist for the last launch-critical verification before you produce iOS or Android release builds. It is **not** a deep QA audit — the platform has already been tested; this is the fast final gate.

## How to run it
1. **Open the HTML directly in a browser.** Double-click `docs/launch/FINAL_60_MINUTE_SMOKE_TEST.html` (or drag it into Chrome/Safari). No server, no npm, no internet, no build step — it runs fully offline.
2. **Use a fresh Preview deployment.** Test against the current Vercel Preview for the release branch, not production. Paste the Preview URL and the commit/build SHA into the header fields.
3. **Use only test accounts and test data.** Never run destructive checks (account deletion, job creation) against real users. Keep one reusable test account per role. On the "Delete Account page opens" checks, only confirm the page **opens** — do **not** delete the reusable test account.
4. **Complete the checklist before producing any iOS/Android release build.** Work top to bottom; the ~60-minute timer and per-section time budgets keep you on pace.
5. **Any critical failure means postpone the build.** If any item marked **CRITICAL** is set to Fail, the "Ready for mobile build" decision is automatically locked. Fix the issue, re-verify, then re-run this gate.

## What each item supports
- **Pass / Fail / N/A** (click again to clear) and a short **notes** field.
- Failed items are highlighted in red and collected into the final summary.
- Header fields (tester, date, Preview URL, SHA, browser/device) print into the report.

## Buttons
- **Expand all / Collapse all** — open or close every section.
- **Show failures only** — filter to just the failed items for a fast fix pass.
- **Copy failure summary** — copies a plain-text report (header + every Fail item + notes + decision) to your clipboard to paste back.
- **Print / Save as PDF** — opens the browser print dialog with a clean, print-styled report.
- **Reset checklist** — clears all items/notes/decision/header (timer untouched), after a confirm.

## Sections & time budget (~60 min total)
A Preview/build identity (3) · B Public & auth (7) · C Inspector (7) · D Client (8) · E Admin (8) · F End-to-end workflow (12) · G Supplier/Agency/Enterprise (5) · H Negative checks (5) · I Responsive (3) · J Final launch (2).

## Critical items (block the "Ready" decision if failed)
Sign in · Forgot Password · Privacy Policy (no draft) · Create Job · Inspector Apply · Admin approval · Assignment · Unauthorized route protection · Delete Account access · the full End-to-end workflow steps.

## Persistence & privacy
Everything you enter is saved automatically in this browser's **localStorage** (key `nexpec_smoke_v1`) — checkbox states, notes, header fields, decision, collapsed sections, and the timer. Nothing is transmitted anywhere; there is no backend. Reopening the file on the same browser restores your progress. Using a different browser/profile or clearing site data starts fresh.

## Guardrail
This file is documentation/tooling only. It does not touch the app, database, or any deployment. Do not commit, push, deploy, or run migrations as part of running it.
