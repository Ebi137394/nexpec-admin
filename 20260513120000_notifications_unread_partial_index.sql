-- ════════════════════════════════════════════════════════════════════════════
--  20260513120000_notifications_unread_partial_index.sql
--  NEXPEC — MISSING-INDEX-IS_READ-001
--
--  Adds a partial index on public.notifications that accelerates the
--  bell-badge / unread-count query path:
--
--      SELECT count(*) FROM notifications
--      WHERE user_id = auth.uid() AND read = false;
--
--  Why partial?
--  ────────────
--  Notifications-read rates trend to ~95-99% over time: once a user
--  opens the bell, every visible item flips read=true. A partial
--  index on `(user_id) WHERE read = false` indexes ONLY the small
--  hot subset (~1-5% of rows). Compared to a full B-tree on
--  (user_id, read), the partial index:
--    • is dramatically smaller on disk (only unread rows present),
--    • costs nothing to maintain on the much-more-common "mark as read"
--      UPDATE (the index entry is REMOVED, not updated),
--    • exactly fits the only access pattern the app uses (filtered to
--      unread).
--
--  Phase-3 audit context
--  ─────────────────────
--  Live call sites against the `notifications` table (column = `read`)
--  share the same WHERE-shape: `user_id = X AND read = false`. None
--  of the existing migrations creates an index covering this filter
--  (verified). Without this index, the unread-count query Seq-Scans a
--  growing notifications table on every render of the bell badge — a
--  clear performance cliff as notifications volume scales.
--
--  Heads-up: the Phase-3 audit register tagged this as "is_read"
--  because a sibling `helpdesk_messages` table genuinely uses that
--  name. The strike-ID stays the same for traceability; the live
--  column on `notifications` is `read`.
--
--  Concurrency (revised — see history note)
--  ────────────────────────────────────────
--  Originally drafted with CREATE INDEX CONCURRENTLY to avoid the
--  ACCESS EXCLUSIVE table lock. Supabase's SQL Editor wraps every
--  query in an implicit BEGIN/COMMIT, and CONCURRENTLY rejects
--  transactional contexts — so the editor reported:
--
--      ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a
--                    transaction block
--
--  Re-cut as a plain CREATE INDEX. The build IS blocking, but the
--  index is partial (only the ~1-5% of rows where read=false)
--  so the work is fast — typically milliseconds to a few seconds
--  even on a million-row notifications table. Acceptable downtime
--  during off-hours; near-imperceptible during normal traffic.
--
--  If the table ever grows large enough that the brief lock starts
--  to matter, switch to the CONCURRENTLY version and run it via
--  `psql` or `supabase db execute` (both bypass the editor's tx
--  wrapper). The CONCURRENTLY version is preserved as a commented
--  alternative in the UP section.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  Pre-flight: confirm the target table exists and the column shape
--  matches expectations. Run these manually before applying if you're
--  unsure of the live schema.
--
--  SELECT column_name, data_type
--  FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'notifications';
--  -- Expected: includes user_id (uuid) and read (boolean).
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
--  UP — Blocking CREATE INDEX (Supabase SQL Editor compatible)
-- ────────────────────────────────────────────────────────────────────────────
-- Takes a brief ACCESS EXCLUSIVE lock on `notifications` during the
-- index build. On a partial index over only the unread rows this is
-- typically milliseconds; even on a million-row table it's a few
-- seconds at most. Safe to run during normal traffic on a healthy
-- platform; for the largest tables under high write load, prefer
-- the CONCURRENTLY variant below run via psql.

BEGIN;

-- ★ Column drift correction (SQL Editor returned 42703 on the original
--   draft): live schema uses `notifications.read`, NOT `is_read`. The
--   sibling chat schema `helpdesk_messages` uses `is_read`, which is
--   what the Phase-3 grep originally caught and mislabelled. Two
--   distinct tables, two distinct column conventions. The index is
--   named "_unread_" (semantic) rather than "_is_read_" (literal) so
--   it survives a future column rename without misleading anyone.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id)
  WHERE read = false;

COMMENT ON INDEX public.notifications_user_unread_idx IS
  'MISSING-INDEX-IS_READ-001: Partial index accelerating the unread-count query (user_id, read=false). Indexes only the ~1-5% of rows where read=false; tiny on disk and zero-cost when a row flips to read=true (the entry is removed, not updated). Despite the strike id, the live column is `read` not `is_read` — the id is preserved for cross-reference with the Phase-3 register.';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
--  ALTERNATIVE: CONCURRENTLY (run via psql / supabase db execute)
-- ────────────────────────────────────────────────────────────────────────────
-- If you ever need the no-lock variant, run the following OUTSIDE the
-- Supabase SQL Editor (it rejects CONCURRENTLY because it wraps queries
-- in an implicit transaction). Single statement, no BEGIN/COMMIT.
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_unread_idx
--     ON public.notifications (user_id)
--     WHERE read = false;
--
-- A failed CONCURRENTLY build leaves an INVALID index; verify with the
-- indisvalid query in section A of the smoke tests below. If invalid:
--   DROP INDEX CONCURRENTLY IF EXISTS public.notifications_user_unread_idx;
-- then retry.


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Index exists and is VALID
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname  = 'notifications_user_unread_idx';
-- -- Expected: one row with the CREATE INDEX definition shown.
--
-- SELECT relname, indisvalid
-- FROM pg_class c
-- JOIN pg_index i ON i.indexrelid = c.oid
-- WHERE c.relname = 'notifications_user_unread_idx';
-- -- Expected: indisvalid = true.

-- B. Planner uses the index for the bell-badge query shape
-- EXPLAIN ANALYZE
-- SELECT count(*) FROM public.notifications
-- WHERE user_id = '<your-uid>' AND read = false;
-- -- Expected: "Index Only Scan using notifications_user_unread_idx"
-- --           OR  "Index Scan using notifications_user_unread_idx"
-- --   (depending on visibility-map state for the partial index).
-- --
-- -- Anti-expected: "Seq Scan on notifications" — if you see this,
-- -- run ANALYZE public.notifications; the planner needs fresh stats
-- -- to choose the index.

-- C. Index is small
-- SELECT pg_size_pretty(pg_relation_size('public.notifications_user_unread_idx'));
-- -- Expected: a few KB to low MB even on large tables, because only
-- -- unread rows are indexed (typically <5% of total).


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback)
-- ────────────────────────────────────────────────────────────────────────────
--  Either form works in the SQL Editor (DROP INDEX is fast and lock-light):
--
--    BEGIN;
--      DROP INDEX IF EXISTS public.notifications_user_unread_idx;
--    COMMIT;
--
--  If you previously created the index with CONCURRENTLY via psql and
--  want a symmetric drop:
--
--    DROP INDEX CONCURRENTLY IF EXISTS public.notifications_user_unread_idx;
--    -- must run OUTSIDE the Supabase SQL Editor for the same reason
--    -- CREATE INDEX CONCURRENTLY does.
