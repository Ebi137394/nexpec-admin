# Runbook — destructive operations on Production

**Rule: a failed backup aborts the operation. There is no "proceed anyway".**

## Why this rule exists

On 2026-09-03 an owner-authorised cleanup removed 19 stale job-match
notifications from Production. The scope was correct and fully characterised
beforehand (19 rows, all recipients failing `nx_inspector_can_discover_job()`),
and the post-delete verification was clean.

The **procedure** failed. The pre-flight export was written to a directory that
had been deleted earlier in the same session, so the export produced nothing —
and the `DELETE` ran anyway, because the two steps were independent commands in
one shell block. The rows were removed with no rollback copy.

The deletion was right. Discovering the missing backup *after* the fact was not.

## The rule

Whenever a destructive statement (`DELETE`, `UPDATE`, `DROP`, `TRUNCATE`) runs
against Production **and a backup is part of the plan**:

1. The export runs **first**.
2. The export is **verified**: file exists, is non-empty, contains no query
   error, and holds at least one row.
3. Only then may the destructive statement run.
4. If any of 1–3 fails, **the operation aborts** and the destructive statement
   is never issued.

Never create the backup directory as part of the destructive run — that hides
the very failure this rule catches.

## How to comply

```bash
scripts/ops/safe-destructive.sh <workdir> <select.sql> <destructive.sql> <backup.json>
```

The wrapper enforces steps 1–4 under `set -euo pipefail`. The destructive
statement is unreachable unless the backup is proven.

**The select and the destructive statement must share one predicate.** If they
can drift, the backup does not describe what was deleted.

## After any destructive Production change

Write an append-only `audit_events` row: `event_type`, `subject_table`,
`subject_id`, exact count, the scope predicate, what was deliberately
preserved, the verification results, and the backup status — including when a
backup was **not** captured. Never reconstruct deleted rows to make a record
look complete; record the gap honestly instead.

## Precedent

`audit_events` id `86e5f2a9-dd0b-43e0-8df9-d9178c232349`
(`notifications.stale_cleanup`, 2026-09-03) documents the incident above,
including `backup_status: NOT CAPTURED` and `rows_reconstructed: false`.
